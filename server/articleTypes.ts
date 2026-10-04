/**
 * Article Types (PHASE R, Spec v2.0 §9.3: "The list must remain editable and
 * expandable").
 *
 * The list lives in the ArticleType table. Article.articleType stores the
 * type's `name` and is a foreign key (ON UPDATE/DELETE RESTRICT), so:
 *   - a type that articles use can be deactivated (hidden from new content)
 *     but never renamed or deleted — existing articles keep their exact type;
 *   - seeded specification types (isSystem) can never be deleted.
 * "How to Watch" and "Sports Viewing Guide" are two separate system types
 * with the same "viewing" SEO profile.
 *
 *   GET    /api/article-types        all types + usage counts     Admin, Editor, Author
 *   POST   /api/article-types        create                       Admin
 *   PUT    /api/article-types/:id    edit / activate / reorder    Admin
 *   DELETE /api/article-types/:id    delete an unused custom type Admin
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from './db';
import { requireRole, type AuthLookup } from './auth';
import { recordAudit } from './audit';
import { ARTICLE_TYPES, ARTICLE_SCHEMA_TYPES, ARTICLE_TYPE_SEO_PROFILES, type ArticleTypeDefinition, type ArticleSchemaType, type ArticleTypeSeoProfile } from '../src/types';

type Cache = { at: number; value: ArticleTypeDefinition[] } | null;
const holder = (globalThis as unknown as { __sportingspyArticleTypes?: { cache: Cache } }).__sportingspyArticleTypes ??= { cache: null };
const TTL_MS = 30_000;

const toDefinition = (row: { id: string; name: string; slug: string; description: string; sortOrder: number; isActive: boolean; isSystem: boolean; schemaType: string; seoProfile: string }): ArticleTypeDefinition => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  description: row.description,
  sortOrder: row.sortOrder,
  isActive: row.isActive,
  isSystem: row.isSystem,
  schemaType: (ARTICLE_SCHEMA_TYPES as readonly string[]).includes(row.schemaType) ? (row.schemaType as ArticleSchemaType) : 'Article',
  seoProfile: (ARTICLE_TYPE_SEO_PROFILES as readonly string[]).includes(row.seoProfile) ? (row.seoProfile as ArticleTypeSeoProfile) : 'general',
});

/** Fallback when the table cannot be read: the seeded specification list. */
const FALLBACK: ArticleTypeDefinition[] = ARTICLE_TYPES.map((name, i) => ({
  id: `type-${name}`, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''), description: '', sortOrder: i * 10,
  isActive: true, isSystem: true, schemaType: ['Results', 'Preview', 'Update', 'News'].includes(name) ? 'NewsArticle' : 'Article',
  seoProfile: name === 'How to Watch' || name === 'Sports Viewing Guide' ? 'viewing' : 'general',
}));

/** Every type (active and inactive), ordered for display. Cached briefly. */
export async function allArticleTypes(): Promise<ArticleTypeDefinition[]> {
  if (holder.cache && Date.now() - holder.cache.at < TTL_MS) return holder.cache.value;
  try {
    const rows = await prisma.articleType.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    const value = rows.map(toDefinition);
    holder.cache = { at: Date.now(), value };
    return value;
  } catch {
    return FALLBACK;
  }
}

export async function activeArticleTypes(): Promise<ArticleTypeDefinition[]> {
  return (await allArticleTypes()).filter((t) => t.isActive);
}

export function forgetArticleTypes() {
  holder.cache = null;
}

/** name → definition (any status). */
export async function articleTypeMap(): Promise<Map<string, ArticleTypeDefinition>> {
  return new Map((await allArticleTypes()).map((t) => [t.name, t]));
}

/**
 * Validates the articleType of an article write. New content must use an
 * ACTIVE type; an existing article may keep its current (even inactive) type.
 */
export async function validateArticleTypeForWrite(value: unknown, current?: string | null): Promise<string | null> {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !value.trim()) return 'articleType must be an Article Type name.';
  const types = await articleTypeMap();
  const def = types.get(value);
  if (!def) return `articleType "${value}" is not a known Article Type.`;
  if (!def.isActive && value !== current) return `Article Type "${value}" is inactive. Choose an active type.`;
  return null;
}

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} &'’/().,-]{0,58}[\p{L}\p{N})]$/u;
const slugify = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);

type Body = { name?: unknown; description?: unknown; sortOrder?: unknown; isActive?: unknown; schemaType?: unknown; seoProfile?: unknown };
const FIELDS = ['name', 'description', 'sortOrder', 'isActive', 'schemaType', 'seoProfile'];

function parse(body: unknown, partial: boolean): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Send the Article Type as an object.' };
  const raw = body as Body & Record<string, unknown>;
  const unknownKey = Object.keys(raw).find((k) => !FIELDS.includes(k));
  if (unknownKey) return { ok: false, error: `${unknownKey} is not an Article Type field.` };
  const value: Record<string, unknown> = {};
  if (raw.name !== undefined || !partial) {
    if (typeof raw.name !== 'string' || !NAME_RE.test(raw.name.trim())) return { ok: false, error: 'name must be 2–60 characters (letters, numbers, spaces and & \' / ( ) . , -).' };
    value.name = raw.name.trim().replace(/\s+/g, ' ');
  }
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string' || raw.description.length > 300) return { ok: false, error: 'description must be text of at most 300 characters.' };
    value.description = raw.description.trim();
  }
  if (raw.sortOrder !== undefined) {
    if (typeof raw.sortOrder !== 'number' || !Number.isInteger(raw.sortOrder) || raw.sortOrder < 0 || raw.sortOrder > 100000) return { ok: false, error: 'sortOrder must be a whole number from 0 to 100000.' };
    value.sortOrder = raw.sortOrder;
  }
  if (raw.isActive !== undefined) {
    if (typeof raw.isActive !== 'boolean') return { ok: false, error: 'isActive must be true or false.' };
    value.isActive = raw.isActive;
  }
  if (raw.schemaType !== undefined) {
    if (!(ARTICLE_SCHEMA_TYPES as readonly unknown[]).includes(raw.schemaType)) return { ok: false, error: `schemaType must be one of: ${ARTICLE_SCHEMA_TYPES.join(', ')}.` };
    value.schemaType = raw.schemaType;
  }
  if (raw.seoProfile !== undefined) {
    if (!(ARTICLE_TYPE_SEO_PROFILES as readonly unknown[]).includes(raw.seoProfile)) return { ok: false, error: `seoProfile must be one of: ${ARTICLE_TYPE_SEO_PROFILES.join(', ')}.` };
    value.seoProfile = raw.seoProfile;
  }
  return { ok: true, value };
}

export function articleTypesRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
  const admin = requireRole(getLookup, ['Admin']);
  const AUDIT_FIELDS = ['name', 'description', 'sortOrder', 'isActive', 'schemaType', 'seoProfile'] as const;

  router.get('/', requireRole(getLookup, ['Admin', 'Editor', 'Author']), wrap(async (_req, res) => {
    const [rows, counts] = await Promise.all([
      prisma.articleType.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.article.groupBy({ by: ['articleType'], _count: { _all: true } }),
    ]);
    const used = new Map(counts.map((c) => [c.articleType, c._count._all]));
    res.json(rows.map((r) => ({ ...toDefinition(r), articleCount: used.get(r.name) || 0 })));
  }));

  router.post('/', admin, wrap(async (req, res) => {
    const parsed = parse(req.body, false);
    if (!parsed.ok) return res.status(400).json({ error: (parsed as { error: string }).error });
    const name = parsed.value.name as string;
    const slug = slugify(name);
    if (!slug) return res.status(400).json({ error: 'name must contain letters or numbers.' });
    const clash = await prisma.articleType.findFirst({ where: { OR: [{ name: { equals: name, mode: 'insensitive' } }, { slug }] } });
    if (clash) return res.status(409).json({ error: `An Article Type named "${clash.name}" already exists.` });
    const max = await prisma.articleType.aggregate({ _max: { sortOrder: true } });
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.articleType.create({
        data: {
          id: `type-${crypto.randomUUID()}`,
          name,
          slug,
          description: (parsed.value.description as string) ?? '',
          sortOrder: (parsed.value.sortOrder as number) ?? (max._max.sortOrder ?? 0) + 10,
          isActive: (parsed.value.isActive as boolean) ?? true,
          isSystem: false,
          schemaType: (parsed.value.schemaType as string) ?? 'Article',
          seoProfile: (parsed.value.seoProfile as string) ?? 'general',
        },
      });
      await recordAudit(tx, { userId: req.authContext!.userId, userName: req.authContext!.userName, action: 'Created Article Type', entityType: 'ArticleType', entityId: row.id, details: `${req.authContext!.userName} created Article Type "${row.name}".`, before: null, after: row, fields: AUDIT_FIELDS });
      return row;
    });
    forgetArticleTypes();
    return res.status(201).json({ ...toDefinition(created), articleCount: 0 });
  }));

  router.put('/:id', admin, wrap(async (req, res) => {
    const existing = await prisma.articleType.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Article Type not found.' });
    const parsed = parse(req.body, true);
    if (!parsed.ok) return res.status(400).json({ error: (parsed as { error: string }).error });
    if (!Object.keys(parsed.value).length) return res.status(400).json({ error: 'Nothing to update.' });
    const data = { ...parsed.value } as Record<string, unknown>;
    if (data.name !== undefined && data.name !== existing.name) {
      // The name is the identity articles store: renaming would silently change
      // the type of existing content, so only unused custom types may be renamed.
      if (existing.isSystem) return res.status(400).json({ error: 'Specification types cannot be renamed. Create a new type instead.' });
      const inUse = await prisma.article.count({ where: { articleType: existing.name } });
      if (inUse) return res.status(400).json({ error: `"${existing.name}" is used by ${inUse} article(s) and cannot be renamed. Create a new type instead.` });
      const slug = slugify(data.name as string);
      const clash = await prisma.articleType.findFirst({ where: { id: { not: existing.id }, OR: [{ name: { equals: data.name as string, mode: 'insensitive' } }, { slug }] } });
      if (clash) return res.status(409).json({ error: `An Article Type named "${clash.name}" already exists.` });
      data.slug = slug;
    } else {
      delete data.name;
    }
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.articleType.update({ where: { id: existing.id }, data });
      await recordAudit(tx, { userId: req.authContext!.userId, userName: req.authContext!.userName, action: 'Updated Article Type', entityType: 'ArticleType', entityId: row.id, details: `${req.authContext!.userName} updated Article Type "${row.name}".`, before: existing, after: row, fields: AUDIT_FIELDS });
      return row;
    });
    forgetArticleTypes();
    const articleCount = await prisma.article.count({ where: { articleType: updated.name } });
    return res.json({ ...toDefinition(updated), articleCount });
  }));

  router.delete('/:id', admin, wrap(async (req, res) => {
    const existing = await prisma.articleType.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Article Type not found.' });
    if (existing.isSystem) return res.status(400).json({ error: 'Specification types cannot be deleted. Deactivate it instead.' });
    const inUse = await prisma.article.count({ where: { articleType: existing.name } });
    if (inUse) return res.status(400).json({ error: `"${existing.name}" is used by ${inUse} article(s). Deactivate it instead.` });
    await prisma.$transaction(async (tx) => {
      await tx.articleType.delete({ where: { id: existing.id } });
      await recordAudit(tx, { userId: req.authContext!.userId, userName: req.authContext!.userName, action: 'Deleted Article Type', entityType: 'ArticleType', entityId: existing.id, details: `${req.authContext!.userName} deleted unused Article Type "${existing.name}".`, before: existing, after: null, fields: AUDIT_FIELDS });
    });
    forgetArticleTypes();
    return res.json({ success: true, id: existing.id });
  }));

  return router;
}
