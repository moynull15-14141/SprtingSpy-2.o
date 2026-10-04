/**
 * URL stability (PHASE R, Spec §13.2–13.3, §20.3: published URLs stay stable;
 * any URL change gets a direct 301 from the old URL to the new one).
 *
 * Article moves were already handled (server/redirects.ts#redirectMovedArticle).
 * This module covers the cases that change MANY URLs at once:
 *   - a Sport slug change   → the sport page, every event, edition and article URL under it
 *   - an Event slug change  → the event page, its editions and its articles
 *   - an Event moved to another Sport
 *
 * The database relations use natural keys with ON UPDATE CASCADE, so those
 * renames rewrite descendant rows automatically. Before the rename we record
 * every affected public URL by STABLE row id; afterwards we read the new URL
 * of each id and write old → 301 → new for every one that changed (each
 * pointing directly at the final URL, so no chains; existing rules that
 * pointed at an old URL are re-targeted by saveRedirect).
 *
 * Event-level articles (eventSlug set, no edition) are not linked to the
 * event by a foreign key, so the cascade does NOT reach them; they are
 * updated explicitly here so they never lose their event.
 *
 * Collision rules (deterministic, enforced on every write):
 *   1. /{sport}/{segment}/ is served by the EVENT when one exists, so an
 *      event-less article may not use the slug of an event in its sport, and
 *      an event may not take the slug of an event-less article in its sport.
 *   2. A sport slug may not equal a top-level site path (/search/, /events/ …).
 */

import type { Prisma } from './generated/prisma/client';
import { prisma } from './db';
import { articlePath, editionPath, eventPath, sportPath } from '../src/lib/paths';
import { releasePath, saveRedirect } from './redirects';

type Db = Prisma.TransactionClient | typeof prisma;

/** Top-level paths owned by the site itself (never usable as a sport slug). */
export const RESERVED_SPORT_SLUGS = [
  'about', 'account', 'admin', 'api', 'author', 'contact', 'dmca', 'events', 'faq', 'latest', 'privacy-policy',
  'terms-and-conditions', 'privacy', 'terms', 'search', 'sports', 'media', 'sitemaps', 'reset-password', 'src', 'node_modules',
  'sitemap', 'robots', 'feed', 'rss', 'login', 'logout', 'preview',
];

export class UrlConflict extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

const strip = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path);

/** Public URLs (without trailing slash) keyed by `kind:id`. */
export type UrlSnapshot = Map<string, string>;

export type Scope = { sportSlug: string; eventSlug?: string };

/** Every public URL in a sport's or an event's subtree, keyed by stable row id. */
export async function snapshotUrls(db: Db, scope: Scope): Promise<UrlSnapshot> {
  const snap: UrlSnapshot = new Map();
  if (!scope.eventSlug) {
    const sport = await db.sport.findUnique({ where: { slug: scope.sportSlug }, select: { id: true, slug: true } });
    if (sport) snap.set(`sport:${sport.id}`, strip(sportPath(sport.slug)));
  }
  const eventWhere = scope.eventSlug ? { sportSlug: scope.sportSlug, slug: scope.eventSlug } : { sportSlug: scope.sportSlug };
  const [events, editions, articles] = await Promise.all([
    db.sportEvent.findMany({ where: eventWhere, select: { id: true, sportSlug: true, slug: true } }),
    db.eventEdition.findMany({ where: scope.eventSlug ? { sportSlug: scope.sportSlug, eventSlug: scope.eventSlug } : { sportSlug: scope.sportSlug }, select: { id: true, sportSlug: true, eventSlug: true, year: true } }),
    // Only published articles have public URLs to preserve.
    db.article.findMany({
      where: { status: 'published', ...(scope.eventSlug ? { sportSlug: scope.sportSlug, eventSlug: scope.eventSlug } : { sportSlug: scope.sportSlug }) },
      select: { id: true, sportSlug: true, eventSlug: true, editionYear: true, slug: true },
    }),
  ]);
  for (const e of events) snap.set(`event:${e.id}`, strip(eventPath(e.sportSlug, e.slug)));
  for (const ed of editions) snap.set(`edition:${ed.id}`, strip(editionPath(ed.sportSlug, ed.eventSlug, ed.year)));
  for (const a of articles) snap.set(`article:${a.id}`, strip(articlePath(a)));
  return snap;
}

/** Current URLs of the same ids after a change. */
async function resolveIds(db: Db, before: UrlSnapshot): Promise<UrlSnapshot> {
  const ids = { sport: [] as string[], event: [] as string[], edition: [] as string[], article: [] as string[] };
  for (const key of before.keys()) {
    const [kind, id] = key.split(/:(.*)/s);
    ids[kind as keyof typeof ids].push(id);
  }
  const [sports, events, editions, articles] = await Promise.all([
    ids.sport.length ? db.sport.findMany({ where: { id: { in: ids.sport } }, select: { id: true, slug: true } }) : [],
    ids.event.length ? db.sportEvent.findMany({ where: { id: { in: ids.event } }, select: { id: true, sportSlug: true, slug: true } }) : [],
    ids.edition.length ? db.eventEdition.findMany({ where: { id: { in: ids.edition } }, select: { id: true, sportSlug: true, eventSlug: true, year: true } }) : [],
    ids.article.length ? db.article.findMany({ where: { id: { in: ids.article } }, select: { id: true, sportSlug: true, eventSlug: true, editionYear: true, slug: true, status: true } }) : [],
  ]);
  const after: UrlSnapshot = new Map();
  for (const s of sports) after.set(`sport:${s.id}`, strip(sportPath(s.slug)));
  for (const e of events) after.set(`event:${e.id}`, strip(eventPath(e.sportSlug, e.slug)));
  for (const ed of editions) after.set(`edition:${ed.id}`, strip(editionPath(ed.sportSlug, ed.eventSlug, ed.year)));
  for (const a of articles) if (a.status === 'published') after.set(`article:${a.id}`, strip(articlePath(a)));
  return after;
}

export interface UrlMove { key: string; from: string; to: string }

/**
 * Writes old → 301 → new for every URL in `before` whose id now lives at a
 * different URL. Must run in the same transaction as the change.
 */
export async function redirectChangedUrls(db: Db, before: UrlSnapshot, reason: string): Promise<UrlMove[]> {
  const after = await resolveIds(db, before);
  const moves: UrlMove[] = [];
  for (const [key, from] of before) {
    const to = after.get(key);
    if (to && to !== from) moves.push({ key, from, to });
  }
  // New locations first: an old rule at a destination must not hide the page.
  for (const m of moves) await releasePath(db, m.to, `Deactivated ${new Date().toISOString()}: ${m.key} now lives here (${reason}).`);
  for (const m of moves) {
    await saveRedirect(db, { sourceUrl: m.from, targetUrl: m.to, statusCode: 301, origin: 'slug-change', notes: `Automatic: ${m.key} moved from ${m.from}/ to ${m.to}/ (${reason}).` }, 'upsert');
  }
  return moves;
}

/**
 * Event-level articles (event set, no edition) have no foreign key to the
 * event, so a rename/move must carry them along explicitly.
 */
export async function moveEventLevelArticles(db: Db, from: { sportSlug: string; eventSlug: string }, to: { sportSlug: string; eventSlug: string }) {
  if (from.sportSlug === to.sportSlug && from.eventSlug === to.eventSlug) return 0;
  const result = await db.article.updateMany({
    where: { sportSlug: from.sportSlug, eventSlug: from.eventSlug, editionYear: null },
    data: { sportSlug: to.sportSlug, eventSlug: to.eventSlug },
  });
  return result.count;
}

// ── Collision rules ──

export function assertSportSlugAllowed(slug: string) {
  if (RESERVED_SPORT_SLUGS.includes(slug)) throw new UrlConflict(`"${slug}" is a reserved site path (/${slug}/) and cannot be used as a sport slug.`, 400);
}

/** Rule 1 (article side): an event-less article may not shadow / be shadowed by an event. */
export async function assertArticleSlugFree(db: Db, a: { sportSlug: string; eventSlug?: string | null; editionYear?: number | null; slug: string }) {
  if (a.eventSlug && a.editionYear) return; // edition articles live four segments deep
  const event = await db.sportEvent.findUnique({ where: { sportSlug_slug: { sportSlug: a.sportSlug, slug: a.slug } }, select: { name: true } });
  if (event) throw new UrlConflict(`/${a.sportSlug}/${a.slug}/ is the URL of the event "${event.name}". Choose a different article slug.`);
}

/** Rule 1 (event side): an event may not take the URL of an event-less article. */
export async function assertEventSlugFree(db: Db, e: { sportSlug: string; slug: string; ignoreEventId?: string }) {
  const article = await db.article.findFirst({ where: { sportSlug: e.sportSlug, slug: e.slug, editionYear: null }, select: { title: true, status: true } });
  if (article) throw new UrlConflict(`/${e.sportSlug}/${e.slug}/ is already used by the article "${article.title}" (${article.status}). Choose a different event slug or move that article first.`);
}

/** Existing data that breaks rule 1 (reported by the SEO scanner; never auto-fixed). */
export async function findShadowedArticles(db: Db = prisma) {
  const events = await db.sportEvent.findMany({ select: { sportSlug: true, slug: true, name: true } });
  if (!events.length) return [];
  const shadowed = await db.article.findMany({
    where: { editionYear: null, OR: events.map((e) => ({ sportSlug: e.sportSlug, slug: e.slug })) },
    select: { id: true, title: true, sportSlug: true, slug: true, status: true },
  });
  return shadowed.map((a) => ({ ...a, event: events.find((e) => e.sportSlug === a.sportSlug && e.slug === a.slug)!.name }));
}
