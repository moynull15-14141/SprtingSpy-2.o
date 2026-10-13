/**
 * Sport groups: a named group directly under ONE sport (Athletics → Running).
 * People see the word "Group"; the model, table, API path and fields keep
 * the earlier name "discipline" so nothing stored or linked has to change.
 * Two levels only: a group has a sport and nothing below it.
 *
 *   GET    /api/disciplines[?sport=slug]   staff: list (all, or one sport's)
 *   POST   /api/disciplines                Admin: create under an existing sport
 *   PUT    /api/disciplines/:id            Admin: rename, re-slug, reorder, hide, retire
 *   DELETE /api/disciplines/:id            Admin: only while no event or article uses it
 *
 * A discipline is not a sport and adds no level to Sport → Event → Edition →
 * Article. Events and Articles keep their required sport and may name at most
 * one discipline of that sport (`disciplineSlug`); the database refuses a
 * discipline of another sport through a composite foreign key, and
 * `disciplineAssignmentError` gives the readable answer first.
 *
 * Its future public page is /{sport}/{discipline}/, an address already shared
 * by events and event-less articles, so the slug rules of server/urlStability
 * cover all three. A slug change moves the page and writes a 301.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import type { Prisma } from './generated/prisma/client';
import { prisma } from './db';
import { requireRole, type AuthLookup } from './auth';
import { recordAudit } from './audit';
import { firstError, validateSafeUrl, validateSeo, validateSlug, validateText, type ValidationResult } from './validation';
import { assertDisciplineSlugFree, disciplineUrlSnapshot, redirectChangedUrls, UrlConflict } from './urlStability';
import { releasePath, RedirectConflict } from './redirects';
import { disciplinePath } from '../src/lib/paths';

type Db = Prisma.TransactionClient | typeof prisma;

const DISCIPLINE_AUDIT_FIELDS = ['sportSlug', 'slug', 'name', 'tagline', 'description', 'order', 'isVisible', 'isActive', 'icon', 'heroImage', 'heroMediaId', 'featuredEventIds', 'seo'] as const;
const EDITABLE = ['slug', 'name', 'tagline', 'description', 'order', 'isVisible', 'isActive', 'icon', 'heroImage', 'featuredEventIds', 'seo'] as const;

/** The Sport editor's own rules for an icon and a Media Library image, passed in so both forms share them. */
export interface SportFormRules {
  validateIcon: (icon: unknown) => ValidationResult;
  imageIsManaged: (value: unknown) => Promise<boolean>;
  mediaIdForUrl: (url: string | null | undefined) => Promise<string | null>;
}

const flag = (value: unknown, name: string) => (value === undefined || typeof value === 'boolean' ? { valid: true } : { valid: false, error: `${name} must be true or false.` });

function payloadError(body: Record<string, unknown>, creating: boolean, rules: SportFormRules): string | null {
  return firstError(
    creating || 'name' in body ? validateText(body.name, 'name', 120) : { valid: true },
    creating || body.slug !== undefined ? validateSlug(body.slug, 'slug') : { valid: true },
    validateText(body.tagline, 'tagline', 300, false),
    validateText(body.description, 'description', 5000, false),
    validateSafeUrl(body.heroImage, 'heroImage', { required: false }),
    rules.validateIcon(body.icon),
    body.featuredEventIds === undefined || (Array.isArray(body.featuredEventIds) && body.featuredEventIds.length <= 12 && body.featuredEventIds.every((id: unknown) => typeof id === 'string' && id.length <= 200) && new Set(body.featuredEventIds).size === body.featuredEventIds.length)
      ? { valid: true } : { valid: false, error: 'featuredEventIds must be a list of at most 12 unique Event ids.' },
    body.order === undefined || (Number.isInteger(body.order) && (body.order as number) >= 0 && (body.order as number) <= 10000) ? { valid: true } : { valid: false, error: 'order must be a whole number from 0 to 10000.' },
    flag(body.isVisible, 'isVisible'),
    flag(body.isActive, 'isActive'),
    validateSeo(body.seo),
  );
}

/**
 * Whether an Event or Article of `sportSlug` may carry `disciplineSlug`.
 * `null` clears it and is always allowed. A retired discipline stays on the
 * records that already have it (`current`) but cannot be newly assigned.
 */
export async function disciplineAssignmentError(db: Db, sportSlug: string, disciplineSlug: unknown, current?: string | null): Promise<string | null> {
  if (disciplineSlug === null || disciplineSlug === undefined) return null;
  const slugError = validateSlug(disciplineSlug, 'disciplineSlug');
  if (!slugError.valid) return slugError.error ?? 'disciplineSlug is invalid.';
  const discipline = await db.discipline.findUnique({ where: { sportSlug_slug: { sportSlug, slug: disciplineSlug as string } }, select: { name: true, isActive: true } });
  if (!discipline) return `disciplineSlug must identify a group of the sport "${sportSlug}".`;
  if (!discipline.isActive && disciplineSlug !== current) return `The group "${discipline.name}" is retired and cannot be assigned to more content.`;
  return null;
}

/**
 * An article inside an event follows the event's discipline. Its own field
 * may stay empty (the usual case) or name the same discipline, never a
 * different one. Articles without an event, or inside an event that has no
 * discipline, choose freely.
 */
export async function articleEventDisciplineError(db: Db, a: { sportSlug: string; eventSlug?: string | null; disciplineSlug?: string | null }): Promise<string | null> {
  if (!a.eventSlug || !a.disciplineSlug) return null;
  const event = await db.sportEvent.findUnique({ where: { sportSlug_slug: { sportSlug: a.sportSlug, slug: a.eventSlug } }, select: { name: true, disciplineSlug: true } });
  if (!event?.disciplineSlug || event.disciplineSlug === a.disciplineSlug) return null;
  return `This article belongs to the event "${event.name}", whose group is "${event.disciplineSlug}". Leave the article's group empty (it follows the event) or choose the same one.`;
}

/** Articles of an event whose own discipline differs from the one the event is about to get. */
export async function eventArticlesWithOtherDiscipline(db: Db, event: { sportSlug: string; slug: string }, disciplineSlug: string): Promise<number> {
  return db.article.count({ where: { sportSlug: event.sportSlug, eventSlug: event.slug, AND: [{ disciplineSlug: { not: null } }, { disciplineSlug: { not: disciplineSlug } }] } });
}

/** Events and articles that still name this discipline. */
async function usage(db: Db, d: { sportSlug: string; slug: string }) {
  const where = { sportSlug: d.sportSlug, disciplineSlug: d.slug };
  const [events, articles] = await Promise.all([db.sportEvent.count({ where }), db.article.count({ where })]);
  return { events, articles };
}

export function disciplineRouter(getLookup: () => AuthLookup, rules: SportFormRules) {
  const heroOf = async (value: unknown) => { const heroImage = typeof value === 'string' && value.trim() ? value.trim() : null; return { heroImage, heroMediaId: await rules.mediaIdForUrl(heroImage) }; };
  const router = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
  const conflict = (res: Response, err: unknown) => { if (err instanceof UrlConflict) return res.status(err.status).json({ error: err.message }); throw err; };

  router.get('/', requireRole(getLookup, ['Admin', 'Editor', 'Author']), wrap(async (req, res) => {
    const sport = typeof req.query.sport === 'string' ? req.query.sport : undefined;
    if (sport !== undefined && !validateSlug(sport, 'sport').valid) return res.status(400).json({ error: 'sport must be a sport slug.' });
    return res.json(await prisma.discipline.findMany({ where: sport ? { sportSlug: sport } : undefined, orderBy: [{ sportSlug: 'asc' }, { order: 'asc' }, { name: 'asc' }] }));
  }));

  router.post('/', requireRole(getLookup, ['Admin']), wrap(async (req, res) => {
    const { userId, userName } = req.authContext!;
    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}) as Record<string, any>;
    if (Object.keys(body).some((key) => key !== 'sportSlug' && !(EDITABLE as readonly string[]).includes(key))) return res.status(400).json({ error: 'Unsupported group field.' });
    const error = firstError(validateSlug(body.sportSlug, 'sportSlug')) || payloadError(body, true, rules);
    if (error) return res.status(400).json({ error });
    if (Array.isArray(body.featuredEventIds) && body.featuredEventIds.length) return res.status(400).json({ error: 'Create the group first, then choose its featured events.' });
    if (!(await rules.imageIsManaged(body.heroImage))) return res.status(400).json({ error: 'heroImage must reference a Media Library item.' });
    const sport = await prisma.sport.findUnique({ where: { slug: body.sportSlug }, select: { slug: true, name: true } });
    if (!sport) return res.status(400).json({ error: 'sportSlug must identify an existing sport.' });
    if (await prisma.discipline.findUnique({ where: { sportSlug_slug: { sportSlug: sport.slug, slug: body.slug } }, select: { id: true } })) {
      return res.status(409).json({ error: `The group '${body.slug}' already exists under sport '${sport.slug}'.` });
    }
    try { await assertDisciplineSlugFree(prisma, { sportSlug: sport.slug, slug: body.slug }); } catch (err) { return conflict(res, err); }
    const created = await prisma.$transaction(async (tx) => {
      const made = await tx.discipline.create({ data: {
        id: `discipline-${crypto.randomUUID()}`,
        sportSlug: sport.slug,
        slug: body.slug,
        name: body.name.trim(),
        tagline: typeof body.tagline === 'string' ? body.tagline.trim() : '',
        icon: body.icon || null,
        ...(await heroOf(body.heroImage)),
        description: typeof body.description === 'string' ? body.description.trim() : '',
        order: body.order ?? (await tx.discipline.count({ where: { sportSlug: sport.slug } })) + 1,
        isVisible: body.isVisible !== false,
        isActive: body.isActive !== false,
        seo: body.seo || {},
      } });
      // The discipline's page lives at this address now: an old redirect from it must not hide the page.
      await releasePath(tx, disciplinePath(made.sportSlug, made.slug), `Deactivated ${new Date().toISOString()}: the group ${made.id} now lives here.`);
      await recordAudit(tx, { userId, userName, action: 'Created Group', entityType: 'Sport', entityId: made.id, details: `Admin ${userName} created the group ${made.name} under ${sport.name}.`, before: null, after: made as unknown as Record<string, unknown>, fields: DISCIPLINE_AUDIT_FIELDS });
      return made;
    });
    return res.status(201).json(created);
  }));

  router.put('/:id', requireRole(getLookup, ['Admin']), wrap(async (req, res) => {
    const { userId, userName } = req.authContext!;
    const existing = await prisma.discipline.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Group not found.' });
    const updates = req.body as Record<string, any>;
    const error = payloadError(updates, false, rules);
    if (error) return res.status(400).json({ error });
    const data: Record<string, unknown> = {};
    for (const key of EDITABLE) if (key in updates) data[key] = updates[key];
    if (typeof data.name === 'string') data.name = data.name.trim();
    if ('tagline' in data) data.tagline = typeof data.tagline === 'string' ? data.tagline.trim() : '';
    if ('icon' in data && !data.icon) data.icon = null;
    // The image must be a Media Library item, so its rights, alt text and sizes are tracked (as for a sport).
    if ('heroImage' in updates) {
      if (!(await rules.imageIsManaged(updates.heroImage))) return res.status(400).json({ error: 'heroImage must reference a Media Library item.' });
      Object.assign(data, await heroOf(updates.heroImage));
    }
    // Featured events are events of this group (so of its sport), never of a sibling or another sport.
    if (Array.isArray(updates.featuredEventIds) && updates.featuredEventIds.length) {
      const found = await prisma.sportEvent.count({ where: { id: { in: updates.featuredEventIds }, sportSlug: existing.sportSlug, disciplineSlug: existing.slug } });
      if (found !== updates.featuredEventIds.length) return res.status(400).json({ error: 'featuredEventIds must be Events of this group.' });
    }
    if ('description' in data) data.description = typeof data.description === 'string' ? data.description.trim() : '';
    // SEO metadata is merged, as for sports: a partial save never wipes the other fields.
    if ('seo' in updates) data.seo = { ...((existing.seo as Record<string, unknown>) || {}), ...(updates.seo || {}) };
    if (typeof data.slug === 'string' && data.slug !== existing.slug) {
      if (await prisma.discipline.findUnique({ where: { sportSlug_slug: { sportSlug: existing.sportSlug, slug: data.slug } }, select: { id: true } })) {
        return res.status(409).json({ error: `The group '${data.slug}' already exists under sport '${existing.sportSlug}'.` });
      }
      try { await assertDisciplineSlugFree(prisma, { sportSlug: existing.sportSlug, slug: data.slug }); } catch (err) { return conflict(res, err); }
    }
    let moved = 0;
    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
      // A slug change reaches the events and articles that use it through ON UPDATE CASCADE.
      const saved = await tx.discipline.update({ where: { id: existing.id }, data });
      // Its landing page moves too: old URL → 301 → new URL (existing rules that pointed at the old URL are re-targeted).
      if (saved.slug !== existing.slug) moved = (await redirectChangedUrls(tx, disciplineUrlSnapshot(existing), `group ${existing.sportSlug}/${existing.slug} → ${saved.sportSlug}/${saved.slug}`)).length;
      await recordAudit(tx, { userId, userName, action: 'Updated Group', entityType: 'Sport', entityId: existing.id, details: `Admin ${userName} updated the group ${saved.name} (${saved.sportSlug}).${moved ? ' Its page URL changed and the old one redirects (301).' : ''}`, before: existing as unknown as Record<string, unknown>, after: saved as unknown as Record<string, unknown>, fields: DISCIPLINE_AUDIT_FIELDS });
      return saved;
      });
    } catch (err) {
      if (err instanceof RedirectConflict) return res.status(409).json({ error: `Slug change blocked: ${err.message}` });
      throw err;
    }
    return res.json({ ...updated, movedUrls: moved });
  }));

  router.delete('/:id', requireRole(getLookup, ['Admin']), wrap(async (req, res) => {
    const { userId, userName } = req.authContext!;
    const existing = await prisma.discipline.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Group not found.' });
    const used = await usage(prisma, existing);
    if (used.events || used.articles) {
      return res.status(409).json({ error: `The group '${existing.name}' is used by ${used.events} event(s) and ${used.articles} article(s). Retire it instead (isActive: false), or clear those assignments first.` });
    }
    await prisma.$transaction(async (tx) => {
      await tx.discipline.delete({ where: { id: existing.id } });
      await recordAudit(tx, { userId, userName, action: 'Deleted Group', entityType: 'Sport', entityId: existing.id, details: `Admin ${userName} deleted the group ${existing.name} (${existing.sportSlug}).`, before: existing as unknown as Record<string, unknown>, after: null, fields: DISCIPLINE_AUDIT_FIELDS });
    });
    return res.json({ success: true, id: existing.id });
  }));

  return router;
}
