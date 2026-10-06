/**
 * CMS Pages API (PHASE PAGES). Mounted at /api/pages behind the global
 * security, CORS, CSRF and cache-invalidation middleware.
 *
 *   GET    /api/pages?status=&q=        list (no bodies)                     Admin, Editor
 *   GET    /api/pages/:id               one page with its body               Admin, Editor
 *   POST   /api/pages                   create (always a draft)              Admin, Editor
 *   PUT    /api/pages/:id               edit fields (live at once if published) Admin, Editor
 *   POST   /api/pages/:id/publish       publish                              Admin, Editor
 *   POST   /api/pages/:id/unpublish     back to draft (public URL → 404)     Admin, Editor
 *   DELETE /api/pages/:id               permanent delete of an unpublished,
 *                                       non-system page                      Admin
 *
 * Authors have no access: pages are site-level documents and the Phase I
 * workflow never lets Authors publish. Bodies go through the same allow-list
 * as article bodies (prepareRichBody), so no HTML is ever stored.
 *
 * URL rules: a page lives at /{slug}/. The slug may not be a reserved site
 * path or a sport slug (sports own /{slug}/ too); a published page whose slug
 * changes leaves a 301 from the old URL. System pages (About, Contact, Privacy
 * Policy, Terms, DMCA) keep their slug and stay published. A page linked from
 * the live header/footer cannot be unpublished or deleted until the link is
 * removed, so the site never links to a 404.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from './db';
import { requireRole, type AuthLookup } from './auth';
import { recordAudit } from './audit';
import { prepareRichBody, usableMedia } from './articleContent';
import { RESERVED_SPORT_SLUGS } from './urlStability';
import { normalizeSource, releasePath, saveRedirect, RedirectConflict } from './redirects';
import type { Page, Prisma } from './generated/prisma/client';
import { PAGE_LIMITS, PAGE_SLUG_PATTERN, PAGE_STATUSES, pagePath, type AdminPage } from '../src/lib/pages';
import type { RichDoc } from '../src/lib/richText';

const AUDIT_FIELDS = ['slug', 'title', 'shortTitle', 'summary', 'content', 'status', 'seoTitle', 'seoDescription', 'noIndex', 'ogMediaId', 'publishedAt'] as const;
const WRITABLE = ['title', 'slug', 'shortTitle', 'summary', 'body', 'seoTitle', 'seoDescription', 'noIndex', 'ogMediaId'] as const;
// Plain text: printable characters only (newlines are not part of these one-line fields).
const CONTROL = /[\u0000-\u001F\u007F]/;

export class PageError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const fail = (status: number, message: string): never => { throw new PageError(status, message); };

export function toAdminPage(p: Page): AdminPage {
  return {
    id: p.id, slug: p.slug, title: p.title, shortTitle: p.shortTitle, summary: p.summary, body: p.body as unknown as RichDoc, content: p.content,
    template: p.template as AdminPage['template'], status: p.status as AdminPage['status'], system: p.system,
    seoTitle: p.seoTitle, seoDescription: p.seoDescription, noIndex: p.noIndex, ogMediaId: p.ogMediaId,
    createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(), publishedAt: p.publishedAt?.toISOString() ?? null,
    createdBy: p.createdBy, updatedBy: p.updatedBy,
  };
}

/** Slug format, reserved site paths and the sport namespace (both serve /{slug}/). */
export async function assertPageSlugAllowed(db: Prisma.TransactionClient | typeof prisma, slug: unknown, selfId?: string): Promise<string> {
  if (typeof slug !== 'string' || !slug) fail(400, 'Slug is required.');
  const s = slug as string;
  if (s.length > PAGE_LIMITS.slug || !PAGE_SLUG_PATTERN.test(s)) fail(400, 'Slug must be lower-case letters, numbers and single hyphens (for example editorial-policy).');
  if (RESERVED_SPORT_SLUGS.includes(s)) fail(400, `"${s}" is a reserved site path (/${s}/).`);
  const sport = await db.sport.findUnique({ where: { slug: s }, select: { name: true } });
  if (sport) fail(409, `/${s}/ is the URL of the sport "${sport.name}". Choose a different slug.`);
  const other = await db.page.findUnique({ where: { slug: s }, select: { id: true, title: true } });
  if (other && other.id !== selfId) fail(409, `/${s}/ is already used by the page "${other.title}".`);
  return s;
}

/** Live header/footer links (published and scheduled Site Experience) pointing at a path. */
export async function liveSiteLinksTo(path: string): Promise<string[]> {
  const target = normalizeSource(path);
  const rows = await prisma.siteExperience.findMany({ select: { area: true, published: true, scheduled: true } });
  const found: string[] = [];
  const walk = (area: string, value: unknown) => {
    if (Array.isArray(value)) return value.forEach((v) => walk(area, v));
    if (!value || typeof value !== 'object') return;
    const o = value as Record<string, unknown>;
    if (typeof o.href === 'string' && o.href.startsWith('/') && o.enabled !== false) {
      const href = o.href.replace(/[?#].*$/, '');
      if (normalizeSource(href) === target) found.push(`${area}: "${typeof o.label === 'string' ? o.label : typeof o.text === 'string' ? o.text : o.href}"`);
    }
    Object.values(o).forEach((v) => walk(area, v));
  };
  for (const r of rows) { walk(r.area, r.published); walk(r.area, r.scheduled); }
  return [...new Set(found)];
}

function text(raw: Record<string, unknown>, key: string, label: string, max: number, required: boolean): string | null | undefined {
  const v = raw[key];
  if (v === undefined) return required ? fail(400, `${label} is required.`) : undefined;
  if (v === null || (typeof v === 'string' && !v.trim())) return required ? fail(400, `${label} is required.`) : null;
  if (typeof v !== 'string') fail(400, `${label} must be text.`);
  const trimmed = (v as string).trim().replace(/\s+/g, ' ');
  if (trimmed.length > max) fail(400, `${label} must be at most ${max} characters.`);
  if (CONTROL.test(trimmed)) fail(400, `${label} contains unsupported control characters.`);
  return trimmed;
}

/** Validates a create (title/slug/body required) or partial update body into Prisma data. */
async function parsePageInput(body: unknown, existing: Page | null): Promise<Record<string, unknown>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Send the page as an object.');
  const raw = body as Record<string, unknown>;
  const unknown = Object.keys(raw).find((k) => !(WRITABLE as readonly string[]).includes(k));
  if (unknown) fail(400, unknown === 'status' ? 'Use the publish or unpublish action to change the status.' : `${unknown} is not a page field.`);
  const create = !existing;
  const data: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => { if (value !== undefined) data[key] = value; };
  set('title', text(raw, 'title', 'Title', PAGE_LIMITS.title, create));
  set('shortTitle', text(raw, 'shortTitle', 'Short title', PAGE_LIMITS.shortTitle, false));
  set('summary', text(raw, 'summary', 'Subtitle', PAGE_LIMITS.summary, false));
  set('seoTitle', text(raw, 'seoTitle', 'SEO title', PAGE_LIMITS.seoTitle, false));
  set('seoDescription', text(raw, 'seoDescription', 'SEO description', PAGE_LIMITS.seoDescription, false));
  if (raw.noIndex !== undefined) {
    if (typeof raw.noIndex !== 'boolean') fail(400, 'noIndex must be true or false.');
    data.noIndex = raw.noIndex;
  }
  if (raw.slug !== undefined && raw.slug !== existing?.slug) {
    if (existing?.system) fail(400, `The URL of "${existing.title}" is fixed (${pagePath(existing.slug)}): other parts of the site and search engines rely on it.`);
    data.slug = await assertPageSlugAllowed(prisma, raw.slug, existing?.id);
  } else if (create) fail(400, 'Slug is required.');
  if (raw.body !== undefined || create) {
    // A template page (the contact form, the privacy disclosures) has content without body text.
    const prepared = await prepareRichBody(raw.body, 'The page body has no text.', !!existing && existing.template !== 'standard');
    if ('error' in prepared) fail(400, prepared.error);
    const p = prepared as Exclude<typeof prepared, { error: string }>;
    data.body = p.doc as unknown as object;
    data.content = p.text;
    data.mediaIds = p.mediaIds;
  }
  if (raw.ogMediaId !== undefined) {
    if (raw.ogMediaId === null || raw.ogMediaId === '') data.ogMediaId = null;
    else if (typeof raw.ogMediaId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(raw.ogMediaId)) fail(400, 'ogMediaId must be a Media Library item id.');
    else {
      const media = await usableMedia([raw.ogMediaId as string]);
      if ('error' in media) fail(400, media.error!);
      data.ogMediaId = raw.ogMediaId;
    }
  }
  return data;
}

export function pagesRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  const staff = requireRole(getLookup, ['Admin', 'Editor']);
  const admin = requireRole(getLookup, ['Admin']);
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((err) => {
      if (err instanceof PageError || err instanceof RedirectConflict) return res.status(err.status).json({ error: err.message });
      if ((err as { code?: string })?.code === 'P2002') return res.status(409).json({ error: 'That URL is already used by another page.' });
      next(err);
    });
  };
  const actor = (req: Request) => ({ userId: req.authContext!.userId, userName: req.authContext!.userName });
  const audit = (db: Prisma.TransactionClient | typeof prisma, req: Request, action: string, page: Page, details: string, before: Page | null, after: Page | null) =>
    recordAudit(db, { ...actor(req), action, entityType: 'Page', entityId: page.id, details, before: before as unknown as Record<string, unknown> | null, after: after as unknown as Record<string, unknown> | null, fields: AUDIT_FIELDS });
  const load = async (id: string) => (await prisma.page.findUnique({ where: { id } })) ?? fail(404, 'Page not found.');

  router.get('/', staff, wrap(async (req, res) => {
    const status = typeof req.query.status === 'string' && (PAGE_STATUSES as readonly string[]).includes(req.query.status) ? req.query.status : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const rows = await prisma.page.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }, { content: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ system: 'desc' }, { title: 'asc' }],
    });
    // Lists never carry bodies.
    return res.json({ pages: rows.map((r) => { const { body: _b, content: _c, ...rest } = toAdminPage(r); return rest; }) });
  }));

  router.get('/:id', staff, wrap(async (req, res) => res.json(toAdminPage(await load(req.params.id)))));

  router.post('/', staff, wrap(async (req, res) => {
    const data = await parsePageInput(req.body, null);
    const { userName } = actor(req);
    const created = await prisma.$transaction(async (tx) => {
      const page = await tx.page.create({ data: { id: `page-${crypto.randomUUID()}`, ...(data as Prisma.PageUncheckedCreateInput), status: 'draft', template: 'standard', system: false, createdBy: userName, updatedBy: userName } });
      await audit(tx, req, 'Created Page', page, `${userName} created the draft page "${page.title}" (${pagePath(page.slug)}).`, null, page);
      return page;
    });
    return res.status(201).json(toAdminPage(created));
  }));

  router.put('/:id', staff, wrap(async (req, res) => {
    const existing = await load(req.params.id);
    const data = await parsePageInput(req.body, existing);
    if (!Object.keys(data).length) fail(400, 'Nothing to update.');
    const { userName } = actor(req);
    const slugChanged = typeof data.slug === 'string' && data.slug !== existing.slug;
    const updated = await prisma.$transaction(async (tx) => {
      const page = await tx.page.update({ where: { id: existing.id }, data: { ...data, updatedBy: userName } });
      if (slugChanged && existing.status === 'published') {
        // URL stability: the old public URL keeps working as a 301 to the new one.
        await releasePath(tx, pagePath(page.slug), `Deactivated ${new Date().toISOString()}: page ${page.id} now lives here.`);
        await saveRedirect(tx, { sourceUrl: pagePath(existing.slug), targetUrl: pagePath(page.slug), statusCode: 301, origin: 'page-slug', notes: `Automatic: page ${page.id} moved from ${pagePath(existing.slug)} to ${pagePath(page.slug)}.` }, 'upsert');
      }
      await audit(tx, req, 'Updated Page', page, `${userName} updated the ${existing.status} page "${page.title}"${slugChanged ? ` (URL ${pagePath(existing.slug)} → ${pagePath(page.slug)})` : ''}.`, existing, page);
      return page;
    });
    return res.json(toAdminPage(updated));
  }));

  router.post('/:id/publish', staff, wrap(async (req, res) => {
    const existing = await load(req.params.id);
    if (existing.status === 'published') return res.json(toAdminPage(existing));
    // The slug may have become unavailable since the draft was saved (a sport took it).
    await assertPageSlugAllowed(prisma, existing.slug, existing.id).catch((err) => { if (!(existing.system && err instanceof PageError && err.status === 400)) throw err; });
    const { userName } = actor(req);
    const published = await prisma.$transaction(async (tx) => {
      const page = await tx.page.update({ where: { id: existing.id }, data: { status: 'published', publishedAt: existing.publishedAt ?? new Date(), updatedBy: userName } });
      // An old redirect from this URL would hide the page.
      await releasePath(tx, pagePath(page.slug), `Deactivated ${new Date().toISOString()}: page ${page.id} was published here.`);
      await audit(tx, req, 'Published Page', page, `${userName} published "${page.title}" at ${pagePath(page.slug)}.`, existing, page);
      return page;
    });
    return res.json(toAdminPage(published));
  }));

  router.post('/:id/unpublish', staff, wrap(async (req, res) => {
    const existing = await load(req.params.id);
    if (existing.system) fail(400, `"${existing.title}" is a required site page and stays published. Edit its content instead.`);
    if (existing.status !== 'published') return res.json(toAdminPage(existing));
    const links = await liveSiteLinksTo(pagePath(existing.slug));
    if (links.length) fail(409, `This page is linked from the live site (${links.join('; ')}). Remove or change that link in Site Experience first.`);
    const { userName } = actor(req);
    const page = await prisma.$transaction(async (tx) => {
      const p = await tx.page.update({ where: { id: existing.id }, data: { status: 'draft', updatedBy: userName } });
      await audit(tx, req, 'Unpublished Page', p, `${userName} unpublished "${p.title}"; ${pagePath(p.slug)} now returns 404.`, existing, p);
      return p;
    });
    return res.json(toAdminPage(page));
  }));

  router.delete('/:id', admin, wrap(async (req, res) => {
    const existing = await load(req.params.id);
    if (existing.system) fail(400, `"${existing.title}" is a required site page and cannot be deleted.`);
    if (existing.status === 'published') fail(409, 'Unpublish the page before deleting it.');
    const links = await liveSiteLinksTo(pagePath(existing.slug));
    if (links.length) fail(409, `This page is linked from the live site (${links.join('; ')}). Remove that link in Site Experience first.`);
    await prisma.$transaction(async (tx) => {
      await tx.page.delete({ where: { id: existing.id } });
      await audit(tx, req, 'Deleted Page', existing, `${actor(req).userName} permanently deleted the page "${existing.title}" (${pagePath(existing.slug)}).`, existing, null);
    });
    return res.json({ success: true, id: existing.id });
  }));

  return router;
}
