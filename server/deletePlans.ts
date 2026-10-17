/**
 * Guided deletion (the CMS "Delete" dialog) of an Event, an Edition, a Sport
 * or a Group.
 *
 *   GET  /api/{events|editions|sports|disciplines}/:id/delete-plan
 *   POST /api/{events|editions|sports|disciplines}/:id/delete
 *        { expect, publishedActions, moveTo? }
 *
 * The plan lists everything linked to the item. Private articles (draft,
 * preview, archived) are never deleted:
 *   - event   → they lose the event (and edition): general articles of the sport
 *   - edition → they lose the edition: articles of the event
 *   - sport   → they move to another sport (`moveTo`), losing event, edition and group
 *   - group   → they lose the group (their URL does not change)
 * Published and scheduled articles need a choice when their URL changes:
 * "unpublish" (kept as a draft, as above) or "delete". Events, editions,
 * groups and FAQ entries that belong to the deleted item go with it and are
 * listed first. Everything runs in one serializable transaction and is
 * refused when the linked content changed after the dialog opened, or when a
 * kept article would take a URL that is already used.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Prisma } from './generated/prisma/client';
import { prisma } from './db';
import { requireRole, type AuthLookup } from './auth';
import { recordAudit } from './audit';
import { assertArticleSlugFree, UrlConflict } from './urlStability';
import { articlePath, disciplinePath, editionPath, eventPath, sportPath } from '../src/lib/paths';

type Db = Prisma.TransactionClient | typeof prisma;
export type Kind = 'event' | 'edition' | 'sport' | 'group';
export type PublishedAction = 'unpublish' | 'delete';
const PUBLIC_STATUSES = ['published', 'scheduled'];
const LABEL: Record<Kind, string> = { event: 'event', edition: 'edition', sport: 'sport', group: 'group' };

class PlanError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface PlanArticle { id: string; title: string; status: string; slug: string; editionYear: number | null; path: string; newPath: string | null; needsChoice: boolean; faqCount: number }
export interface DeletePlan {
  kind: Kind;
  id: string;
  name: string;
  path: string;
  /** Sent back unchanged on delete; the server refuses when it no longer matches. */
  expect: Record<string, string[]>;
  /** Things deleted together with the item. */
  removed: { key: string; title: string; items: { id: string; label: string; note?: string }[] }[];
  /** Things that stay but lose their link to the item. */
  detached: { key: string; title: string; items: { id: string; label: string }[] }[];
  /** Every linked article. */
  articles: PlanArticle[];
  /** What happens to the articles that are kept. */
  keptNote: string;
  /** Sport deletion: where kept articles can move. */
  moveTargets?: { slug: string; name: string; isVisible: boolean }[];
  // Event/edition plans also expose these (used by older clients and tests).
  editions?: { id: string; title: string; year: number }[];
  faqs?: { id: string; question: string; status: string; scope: string }[];
}

type ArticleRow = { id: string; title: string; status: string; slug: string; sportSlug: string; eventSlug: string | null; editionYear: number | null; _count: { faqs: number } };
const articleSelect = { id: true, title: true, status: true, slug: true, sportSlug: true, eventSlug: true, editionYear: true, _count: { select: { faqs: true } } } as const;
const toArticle = (a: ArticleRow, newPath: string | null, choiceWhenPublic: boolean): PlanArticle => ({
  id: a.id, title: a.title, status: a.status, slug: a.slug, editionYear: a.editionYear, path: articlePath(a), newPath,
  needsChoice: choiceWhenPublic && PUBLIC_STATUSES.includes(a.status), faqCount: a._count.faqs,
});
const faqItems = (rows: { id: string; question: string; status: string }[]) => rows.map((f) => ({ id: f.id, label: f.question, note: f.status }));
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

async function loadEventTarget(db: Db, kind: 'event' | 'edition', id: string) {
  if (kind === 'event') {
    const event = await db.sportEvent.findUnique({ where: { id } });
    if (!event) throw new PlanError(404, 'Event not found.');
    return { event, edition: null };
  }
  const edition = await db.eventEdition.findUnique({ where: { id } });
  if (!edition) throw new PlanError(404, 'Edition not found.');
  const event = await db.sportEvent.findUnique({ where: { sportSlug_slug: { sportSlug: edition.sportSlug, slug: edition.eventSlug } } });
  if (!event) throw new PlanError(404, 'The event of this edition was not found.');
  return { event, edition };
}

export async function buildDeletePlan(db: Db, kind: Kind, id: string): Promise<DeletePlan> {
  if (kind === 'event' || kind === 'edition') {
    const { event, edition } = await loadEventTarget(db, kind, id);
    const editions = kind === 'event'
      ? await db.eventEdition.findMany({ where: { sportSlug: event.sportSlug, eventSlug: event.slug }, select: { id: true, title: true, year: true }, orderBy: { year: 'desc' } })
      : [{ id: edition!.id, title: edition!.title, year: edition!.year }];
    const rows = await db.article.findMany({ where: { sportSlug: event.sportSlug, eventSlug: event.slug, ...(kind === 'edition' ? { editionYear: edition!.year } : {}) }, select: articleSelect, orderBy: [{ status: 'asc' }, { title: 'asc' }] });
    const faqs = await db.faqEntry.findMany({ where: kind === 'event' ? { OR: [{ eventId: event.id }, { editionId: { in: ids(editions) } }] } : { editionId: edition!.id }, select: { id: true, question: true, status: true, eventId: true }, orderBy: { displayOrder: 'asc' } });
    const articles = rows.map((a) => toArticle(a, articlePath({ ...a, eventSlug: kind === 'event' ? null : a.eventSlug, editionYear: null }), true));
    return {
      kind, id,
      name: kind === 'event' ? event.name : edition!.title,
      path: kind === 'event' ? eventPath(event.sportSlug, event.slug) : editionPath(event.sportSlug, event.slug, edition!.year),
      expect: { editions: ids(editions), articles: ids(articles), faqs: ids(faqs) },
      removed: [
        ...(kind === 'event' && editions.length ? [{ key: 'editions', title: 'Editions', items: editions.map((e) => ({ id: e.id, label: e.title, note: String(e.year) })) }] : []),
        ...(faqs.length ? [{ key: 'faqs', title: 'FAQ entries', items: faqItems(faqs) }] : []),
      ],
      detached: [],
      articles,
      keptNote: kind === 'event' ? 'They lose the event and become general articles of the sport.' : 'They stay in the event without an edition.',
      editions,
      faqs: faqs.map((f) => ({ id: f.id, question: f.question, status: f.status, scope: f.eventId ? 'event' : 'edition' })),
    };
  }

  if (kind === 'sport') {
    const sport = await db.sport.findUnique({ where: { id } });
    if (!sport) throw new PlanError(404, 'Sport not found.');
    const events = await db.sportEvent.findMany({ where: { sportSlug: sport.slug }, select: { id: true, name: true, _count: { select: { editions: true } } }, orderBy: { name: 'asc' } });
    const editions = await db.eventEdition.findMany({ where: { sportSlug: sport.slug }, select: { id: true } });
    const groups = await db.discipline.findMany({ where: { sportSlug: sport.slug }, select: { id: true, name: true }, orderBy: { order: 'asc' } });
    const rows = await db.article.findMany({ where: { sportSlug: sport.slug }, select: articleSelect, orderBy: [{ status: 'asc' }, { title: 'asc' }] });
    const faqs = await db.faqEntry.findMany({ where: { OR: [{ sportId: sport.id }, { eventId: { in: ids(events) } }, { editionId: { in: ids(editions) } }] }, select: { id: true, question: true, status: true }, orderBy: { displayOrder: 'asc' } });
    const moveTargets = await db.sport.findMany({ where: { id: { not: sport.id } }, select: { slug: true, name: true, isVisible: true }, orderBy: { name: 'asc' } });
    const articles = rows.map((a) => toArticle(a, null, true));
    return {
      kind, id, name: sport.name, path: sportPath(sport.slug),
      expect: { events: ids(events), editions: ids(editions), groups: ids(groups), articles: ids(articles), faqs: ids(faqs) },
      removed: [
        ...(events.length ? [{ key: 'events', title: 'Events (with their editions)', items: events.map((e) => ({ id: e.id, label: e.name, note: `${e._count.editions} edition(s)` })) }] : []),
        ...(groups.length ? [{ key: 'groups', title: 'Groups', items: groups.map((g) => ({ id: g.id, label: g.name })) }] : []),
        ...(faqs.length ? [{ key: 'faqs', title: 'FAQ entries', items: faqItems(faqs) }] : []),
      ],
      detached: [],
      articles,
      keptNote: 'They move to the sport you choose below and lose their event, edition and group.',
      moveTargets,
    };
  }

  const group = await db.discipline.findUnique({ where: { id } });
  if (!group) throw new PlanError(404, 'Group not found.');
  const events = await db.sportEvent.findMany({ where: { sportSlug: group.sportSlug, disciplineSlug: group.slug }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const rows = await db.article.findMany({ where: { sportSlug: group.sportSlug, disciplineSlug: group.slug }, select: articleSelect, orderBy: [{ status: 'asc' }, { title: 'asc' }] });
  const articles = rows.map((a) => toArticle(a, articlePath(a), false));
  return {
    kind, id, name: group.name, path: disciplinePath(group.sportSlug, group.slug),
    expect: { events: ids(events), articles: ids(articles) },
    removed: [],
    detached: events.length ? [{ key: 'events', title: 'Events — kept, without this group', items: events.map((e) => ({ id: e.id, label: e.name })) }] : [],
    articles,
    keptNote: 'They lose the group. Their addresses and publication do not change.',
  };
}

function parseBody(body: unknown) {
  const b = body as Record<string, any>;
  if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some((k) => !['expect', 'publishedActions', 'moveTo'].includes(k))) throw new PlanError(400, 'Send { expect, publishedActions, moveTo? }.');
  const expect = b.expect;
  const okIds = (v: unknown) => Array.isArray(v) && v.length <= 5000 && v.every((x) => typeof x === 'string' && x.length <= 200);
  if (!expect || typeof expect !== 'object' || Array.isArray(expect) || !Object.values(expect).every(okIds)) throw new PlanError(400, 'expect must be the list sent with the delete plan.');
  const actions = b.publishedActions ?? {};
  if (typeof actions !== 'object' || Array.isArray(actions) || Object.values(actions).some((v) => v !== 'unpublish' && v !== 'delete')) throw new PlanError(400, 'publishedActions must map article IDs to "unpublish" or "delete".');
  if (b.moveTo !== undefined && (typeof b.moveTo !== 'string' || b.moveTo.length > 120)) throw new PlanError(400, 'moveTo must be a sport slug.');
  return { expect: expect as Record<string, string[]>, actions: actions as Record<string, PublishedAction>, moveTo: b.moveTo as string | undefined };
}
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
const sameExpect = (a: Record<string, string[]>, b: Record<string, string[]>) => sameSet(Object.keys(a), Object.keys(b)) && Object.keys(a).every((k) => sameSet(a[k], b[k]));
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Runs the plan; returns what was done and the public paths that went away. */
export async function executeDeletePlan(kind: Kind, id: string, body: unknown, actor: { userId: string; userName: string }) {
  const { expect, actions, moveTo } = parseBody(body);
  return prisma.$transaction(async (tx) => {
    const plan = await buildDeletePlan(tx, kind, id);
    if (!sameExpect(plan.expect, expect)) throw new PlanError(409, 'The content linked to this item changed after the dialog opened. Review it again.');
    const choiceIds = plan.articles.filter((a) => a.needsChoice).map((a) => a.id);
    if (Object.keys(actions).some((k) => !choiceIds.includes(k))) throw new PlanError(400, 'A choice was sent for an article that does not need one.');
    const missing = plan.articles.find((a) => a.needsChoice && !actions[a.id]);
    if (missing) throw new PlanError(400, `Choose what happens to the published article "${missing.title}" (unpublish or delete).`);
    const kept = plan.articles.filter((a) => actions[a.id] !== 'delete');
    const toDelete = plan.articles.filter((a) => actions[a.id] === 'delete');

    let target: { slug: string; name: string } | null = null;
    if (kind === 'sport') {
      if (moveTo !== undefined && !kept.length) throw new PlanError(400, 'No article is kept, so there is nothing to move.');
      if (kept.length) {
        if (!moveTo) throw new PlanError(400, `Choose the sport that keeps ${n(kept.length, 'article')}.`);
        if (moveTo === plan.path.slice(1, -1)) throw new PlanError(400, 'Choose another sport than the one being deleted.');
        target = await tx.sport.findUnique({ where: { slug: moveTo }, select: { slug: true, name: true } });
        if (!target) throw new PlanError(400, 'The sport chosen for the kept articles does not exist.');
      }
    } else if (moveTo !== undefined) throw new PlanError(400, `moveTo is only used when deleting a sport.`);

    const goneFromSite: string[] = [];
    const subject = `${LABEL[kind]} "${plan.name}"`;
    for (const a of toDelete) {
      await tx.faqEntry.deleteMany({ where: { articleId: a.id } });
      await tx.article.delete({ where: { id: a.id } });
      if (a.status === 'published') goneFromSite.push(a.path);
      await recordAudit(tx, { ...actor, action: 'Deleted Article', entityType: 'Article', entityId: a.id, details: `Admin ${actor.userName} deleted "${a.title}" (${a.status}${a.faqCount ? `, with ${n(a.faqCount, 'FAQ entry', 'FAQ entries')}` : ''}) while deleting ${subject}.` });
    }

    // Kept articles: their links to the deleted item are cleared.
    for (const a of kept) {
      const unpublish = actions[a.id] === 'unpublish';
      // Plain foreign-key columns (the edition relation also spans sportSlug, so it cannot be "disconnected").
      const link: Prisma.ArticleUncheckedUpdateInput =
        kind === 'event' ? { eventSlug: null, editionYear: null }
        : kind === 'edition' ? { editionYear: null }
        : kind === 'sport' ? { sportSlug: target!.slug, eventSlug: null, editionYear: null, disciplineSlug: null }
        : { disciplineSlug: null };
      await tx.article.update({ where: { id: a.id }, data: { ...link, reviewVersion: { increment: 1 }, ...(unpublish ? { status: 'draft' as const, scheduledFor: null } : {}) } });
      if (unpublish && a.status === 'published') goneFromSite.push(a.path);
      const where = kind === 'sport' ? `moved to ${target!.name}` : `detached from ${subject}`;
      await recordAudit(tx, { ...actor, action: 'Updated Article', entityType: 'Article', entityId: a.id, details: `Admin ${actor.userName} ${unpublish ? 'unpublished and ' : ''}${where} "${a.title}" while deleting ${subject}.` });
    }

    const faqIds = plan.expect.faqs ?? [];
    if (faqIds.length) {
      await tx.faqEntry.deleteMany({ where: { id: { in: faqIds } } });
      await recordAudit(tx, { ...actor, action: 'Deleted FAQ Entries', entityType: 'Faq', entityId: id, details: `Admin ${actor.userName} deleted ${n(faqIds.length, 'FAQ entry', 'FAQ entries')} of ${subject}: ${(plan.removed.find((r) => r.key === 'faqs')?.items ?? []).map((f) => `"${f.label}"`).join(', ').slice(0, 1500)}.` });
    }

    const summary = `${n(kept.length, 'article')} kept${kind === 'sport' && target ? ` (moved to ${target.name})` : ''}, ${n(toDelete.length, 'article')} deleted, ${n(faqIds.length, 'FAQ entry', 'FAQ entries')} deleted`;
    if (kind === 'event' || kind === 'edition') {
      const { event, edition } = await loadEventTarget(tx, kind, id);
      if (kind === 'event') {
        await tx.eventEdition.deleteMany({ where: { id: { in: plan.expect.editions } } });
        await tx.sportEvent.delete({ where: { id: event.id } });
        await removeFeaturedEvent(tx, [event.id]);
        if (event.isVisible) goneFromSite.push(eventPath(event.sportSlug, event.slug), ...(plan.editions ?? []).map((e) => editionPath(event.sportSlug, event.slug, e.year)));
        await recordAudit(tx, { ...actor, action: 'Deleted Permanent Event', entityType: 'Event', entityId: event.id, details: `Admin ${actor.userName} deleted permanent event ${event.name} with ${plan.expect.editions.length} edition(s); ${summary}.`, before: event as unknown as Record<string, unknown>, after: null, fields: ['name', 'slug', 'sportSlug', 'disciplineSlug', 'isVisible'] });
      } else {
        await tx.eventEdition.delete({ where: { id: edition!.id } });
        if (event.currentEditionYear === edition!.year) await tx.sportEvent.update({ where: { id: event.id }, data: { currentEditionYear: null } });
        if (event.isVisible) goneFromSite.push(editionPath(event.sportSlug, event.slug, edition!.year));
        await recordAudit(tx, { ...actor, action: 'Deleted Event Edition', entityType: 'Edition', entityId: edition!.id, details: `Admin ${actor.userName} deleted edition ${edition!.title}; ${summary}.`, before: edition as unknown as Record<string, unknown>, after: null, fields: ['title', 'year', 'eventSlug', 'sportSlug', 'status'] });
      }
    } else if (kind === 'sport') {
      const sport = await tx.sport.findUniqueOrThrow({ where: { id } });
      const events = await tx.sportEvent.findMany({ where: { sportSlug: sport.slug }, select: { id: true, slug: true, isVisible: true } });
      const editions = await tx.eventEdition.findMany({ where: { sportSlug: sport.slug }, select: { eventSlug: true, year: true } });
      const groups = await tx.discipline.findMany({ where: { sportSlug: sport.slug }, select: { slug: true, isVisible: true, isActive: true } });
      await tx.eventEdition.deleteMany({ where: { sportSlug: sport.slug } });
      await tx.sportEvent.deleteMany({ where: { sportSlug: sport.slug } }); // before the groups they may belong to
      await removeFeaturedEvent(tx, ids(events));
      await tx.discipline.deleteMany({ where: { sportSlug: sport.slug } });
      await tx.sport.delete({ where: { id: sport.id } });
      if (sport.isVisible) {
        const visible = new Set(events.filter((e) => e.isVisible).map((e) => e.slug));
        goneFromSite.push(sportPath(sport.slug), ...events.filter((e) => e.isVisible).map((e) => eventPath(sport.slug, e.slug)), ...editions.filter((e) => visible.has(e.eventSlug)).map((e) => editionPath(sport.slug, e.eventSlug, e.year)), ...groups.filter((g) => g.isVisible && g.isActive).map((g) => disciplinePath(sport.slug, g.slug)));
      }
      await recordAudit(tx, { ...actor, action: 'Deleted Sport', entityType: 'Sport', entityId: sport.id, details: `Admin ${actor.userName} deleted sport ${sport.name} with ${n(events.length, 'event')}, ${n(editions.length, 'edition')} and ${n(groups.length, 'group')}; ${summary}.`, before: sport as unknown as Record<string, unknown>, after: null, fields: ['name', 'slug', 'isVisible', 'order'] });
    } else {
      const group = await tx.discipline.findUniqueOrThrow({ where: { id } });
      await tx.sportEvent.updateMany({ where: { sportSlug: group.sportSlug, disciplineSlug: group.slug }, data: { disciplineSlug: null } });
      await tx.discipline.delete({ where: { id } });
      const sport = await tx.sport.findUnique({ where: { slug: group.sportSlug }, select: { isVisible: true } });
      if (sport?.isVisible && group.isVisible && group.isActive) goneFromSite.push(disciplinePath(group.sportSlug, group.slug));
      await recordAudit(tx, { ...actor, action: 'Deleted Group', entityType: 'Sport', entityId: group.id, details: `Admin ${actor.userName} deleted the group ${group.name} (${group.sportSlug}); ${n(plan.expect.events.length, 'event')} and ${n(kept.length, 'article')} kept without it.`, before: group as unknown as Record<string, unknown>, after: null, fields: ['name', 'slug', 'sportSlug', 'isVisible', 'isActive'] });
    }

    // A kept article whose address changes must land on a free one (checked after the deleted item is gone).
    if (kind !== 'group') {
      const sportSlug = kind === 'sport' ? target?.slug : plan.path.split('/')[1];
      for (const a of kept) {
        const slug = a.slug; const newPath = articlePath({ sportSlug: sportSlug!, slug });
        try { await assertArticleSlugFree(tx, { sportSlug: sportSlug!, slug }); }
        catch (err) { if (err instanceof UrlConflict) throw new PlanError(409, `"${a.title}" cannot be kept: ${err.message.replace('Choose a different article slug.', 'Change this article\'s URL slug first, then delete again.')}`); throw err; }
        const clash = await tx.article.findFirst({ where: { id: { not: a.id }, sportSlug, slug, editionYear: null }, select: { title: true, status: true } });
        if (clash) throw new PlanError(409, `"${a.title}" cannot be kept: ${newPath} is already used by the article "${clash.title}" (${clash.status}). Change one of the URL slugs first, then delete again.`);
      }
    }
    return {
      kept: kept.length - Object.values(actions).filter((v) => v === 'unpublish').length,
      unpublished: Object.values(actions).filter((v) => v === 'unpublish').length,
      deleted: toDelete.length,
      faqsDeleted: faqIds.length,
      removed: Object.fromEntries(plan.removed.filter((r) => r.key !== 'faqs').map((r) => [r.key, r.items.length])),
      movedTo: target?.name ?? null,
      goneFromSite,
      // Event/edition clients read these names.
      detached: kept.length - Object.values(actions).filter((v) => v === 'unpublish').length,
      editionsDeleted: kind === 'event' ? plan.expect.editions.length : kind === 'edition' ? 1 : 0,
    };
  }, { isolationLevel: 'Serializable' });
}

/** Featured-event lists must not keep deleted IDs (a later save of the sport or group would be refused). */
async function removeFeaturedEvent(tx: Prisma.TransactionClient, eventIds: string[]) {
  if (!eventIds.length) return;
  for (const s of await tx.sport.findMany({ where: { featuredEventIds: { hasSome: eventIds } }, select: { id: true, featuredEventIds: true } })) await tx.sport.update({ where: { id: s.id }, data: { featuredEventIds: s.featuredEventIds.filter((x) => !eventIds.includes(x)) } });
  for (const d of await tx.discipline.findMany({ where: { featuredEventIds: { hasSome: eventIds } }, select: { id: true, featuredEventIds: true } })) await tx.discipline.update({ where: { id: d.id }, data: { featuredEventIds: d.featuredEventIds.filter((x) => !eventIds.includes(x)) } });
}

export function deletePlanRouter(getLookup: () => AuthLookup, deps: { onGone: (paths: string[], reason: string) => void }) {
  const router = express.Router();
  const admin = requireRole(getLookup, ['Admin']);
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch((err) => {
    if (err instanceof PlanError) return res.status(err.status).json({ error: err.message });
    if (err?.code === 'P2034' || err?.code === 'P2025') return res.status(409).json({ error: 'The content changed while deleting. Review it again.' });
    return next(err);
  });
  for (const [kind, base] of [['event', '/api/events'], ['edition', '/api/editions'], ['sport', '/api/sports'], ['group', '/api/disciplines']] as const) {
    router.get(`${base}/:id/delete-plan`, admin, wrap(async (req, res) => res.json(await buildDeletePlan(prisma, kind, req.params.id))));
    router.post(`${base}/:id/delete`, admin, wrap(async (req, res) => {
      const result = await executeDeletePlan(kind, req.params.id, req.body, { userId: req.authContext!.userId, userName: req.authContext!.userName });
      if (result.goneFromSite.length) deps.onGone(result.goneFromSite, `${kind} deleted`);
      return res.json({ success: true, id: req.params.id, ...result });
    }));
  }
  return router;
}
