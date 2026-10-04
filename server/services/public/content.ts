/**
 * Public content service (PHASE B).
 *
 * Route-specific, read-only queries for the server-rendered public site.
 * Replaces the old pattern of downloading the whole database to the browser
 * via GET /api/data. Rules enforced here, not in page components:
 *   - only `published` articles
 *   - only visible sports and visible events (and their editions/articles)
 *   - no user, session, audit, redirect or draft data is ever selected
 *   - listings never select article bodies
 */

import type { Prisma } from '../../generated/prisma/client';
import type { Article, Author, EventEdition, Sport, SportEvent, AdSlotConfig, Comment } from '../../../src/types';
import { articlePath, editionPath, eventPath } from '../../../src/lib/paths';
import { toMediaAsset, type MediaAsset } from '../../../src/lib/media';
import { legacyToDoc, type RichDoc } from '../../../src/lib/richText';
import { publicSportEventValues, resolveSportEventConfiguration } from '../../sportEventConfiguration';
import { utcToday, type EditionTiming } from '../../../src/lib/eventTiming';

// Loaded lazily so importing this module (e.g. while Next.js collects page
// data at build time) never opens a database connection by itself.
const db = async () => (await import('../../db')).prisma;

export type ArticleSummary = Omit<Article, 'content' | 'tables' | 'references'> & {
  url: string;
  sportName: string;
  eventName?: string;
  eventShortName?: string;
  authorName?: string;
  /** Featured image from the Media Library (responsive), when linked. */
  image?: MediaAsset;
};

export type EventSummary = SportEvent & { sportName: string; currentEditionUrl?: string };

export type EditionSummary = EventEdition & { sportName: string; url: string };

/** PHASE E5: an Edition in Event discovery, with the names its card needs. */
export type DiscoveryEdition = EditionSummary & { eventName: string; eventUrl: string };

// ── Serializers (DB row -> public domain type; Dates -> ISO strings) ──

type ArticleRow = Prisma.ArticleGetPayload<object>;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : undefined);

function toSport(row: Prisma.SportGetPayload<object>): Sport {
  const { eventConfiguration, ...common } = row;
  void eventConfiguration;
  return { ...common, colorTheme: row.colorTheme ?? undefined, heroImage: row.heroImage ?? undefined, seo: row.seo as Sport['seo'] };
}

function toEvent(row: Prisma.SportEventGetPayload<object>): SportEvent {
  const { sportSpecificValues: _values, ...common } = row;
  return {
    ...common,
    history: row.history ?? undefined,
    featuredImage: row.featuredImage ?? undefined,
    officialSourceUrl: row.officialSourceUrl ?? undefined,
    eventType: row.eventType ?? undefined,
    seo: row.seo as SportEvent['seo'],
  };
}

function toEdition(row: Prisma.EventEditionGetPayload<object>): EventEdition {
  return {
    ...row,
    quickFacts: (row.quickFacts ?? []) as unknown as EventEdition['quickFacts'],
    prizeMoneyTotal: row.prizeMoneyTotal ?? undefined,
    defendingChampions: (row.defendingChampions ?? undefined) as unknown as EventEdition['defendingChampions'],
    qualificationInfo: row.qualificationInfo ?? undefined,
    participantsCount: row.participantsCount ?? undefined,
    officialSourceUrl: row.officialSourceUrl ?? undefined,
    seo: row.seo as EventEdition['seo'],
  };
}

function toArticle(row: ArticleRow): Article {
  const { body: _body, featuredMediaId: _featuredMediaId, reviewedAt: _reviewedAt,
    reviewStatus: _reviewStatus, reviewerId: _reviewerId, reviewComment: _reviewComment,
    reviewSubmittedAt: _reviewSubmittedAt, reviewDecidedAt: _reviewDecidedAt, reviewVersion: _reviewVersion, ...rest } = row;
  return {
    ...rest,
    subtitle: row.subtitle || undefined,
    eventSlug: row.eventSlug ?? undefined,
    editionYear: row.editionYear ?? undefined,
    articleType: row.articleType as Article['articleType'],
    publishedAt: row.publishedAt.toISOString(),
    updatedAt: iso(row.updatedAt),
    reviewedAt: iso(row.reviewedAt),
    scheduledFor: iso(row.scheduledFor),
    tables: (row.tables ?? undefined) as unknown as Article['tables'],
    references: (row.references ?? undefined) as unknown as Article['references'],
    seo: row.seo as Article['seo'],
  };
}

function toAuthor(row: Prisma.AuthorGetPayload<object>): Author {
  // userId links a byline to a staff login; it is never public.
  const { userId: _userId, ...rest } = row;
  return { ...rest, twitter: row.twitter ?? undefined, email: row.email ?? undefined, articleCount: row.articleCount ?? undefined };
}

// ── Visibility rules ──

/** Events hidden from the public (or under a hidden sport). Small set; loaded per request. */
async function hiddenEventKeys(): Promise<{ sportSlug: string; slug: string }[]> {
  const prisma = await db();
  return prisma.sportEvent.findMany({
    where: { OR: [{ isVisible: false }, { sport: { isVisible: false } }] },
    select: { sportSlug: true, slug: true },
  });
}

async function publishedArticleWhere(extra: Prisma.ArticleWhereInput = {}): Promise<Prisma.ArticleWhereInput> {
  const hidden = await hiddenEventKeys();
  const where: Prisma.ArticleWhereInput = { status: 'published', sport: { isVisible: true }, ...extra };
  // Articles without an event must be matched explicitly: in SQL,
  // NOT (eventSlug = 'x') is NULL (not true) when eventSlug IS NULL.
  if (hidden.length) {
    where.AND = [{ OR: [{ eventSlug: null }, { NOT: { OR: hidden.map((h) => ({ sportSlug: h.sportSlug, eventSlug: h.slug })) } }] }];
  }
  return where;
}

const visibleEventWhere = (extra: Prisma.SportEventWhereInput = {}): Prisma.SportEventWhereInput => ({
  isVisible: true,
  sport: { isVisible: true },
  ...extra,
});

/**
 * PHASE E5: SQL form of src/lib/eventTiming.ts#editionTiming (same rules; the
 * verify-phase-e5 suite checks the two agree). Dates are `YYYY-MM-DD` strings,
 * so string comparison is calendar order.
 */
export function editionTimingWhere(timing: EditionTiming, today: string = utcToday()): Prisma.EventEditionWhereInput {
  const live: Prisma.EventEditionWhereInput = { status: { in: ['upcoming', 'active'] } };
  const lastBeforeToday: Prisma.EventEditionWhereInput = { OR: [{ endDate: { lt: today } }, { endDate: null, startDate: { lt: today } }] };
  const lastNotBeforeToday: Prisma.EventEditionWhereInput = { OR: [{ endDate: { gte: today } }, { endDate: null, startDate: { gte: today } }, { endDate: null, startDate: null }] };
  if (timing === 'past') return { OR: [{ status: { in: ['completed', 'archived'] } }, lastBeforeToday] };
  if (timing === 'upcoming') {
    return { AND: [live, lastNotBeforeToday, { OR: [{ startDate: { gt: today } }, { startDate: null, endDate: { gt: today } }, { startDate: null, endDate: null, status: 'upcoming' }] }] };
  }
  return { AND: [live, lastNotBeforeToday, { OR: [{ startDate: { lte: today } }, { startDate: null, endDate: { lte: today } }, { startDate: null, endDate: null, status: 'active' }] }] };
}

/** Soonest first for upcoming/ongoing; most recent first for past. Undated last; ties are deterministic. */
export const editionTimingOrder = (timing: EditionTiming): Prisma.EventEditionOrderByWithRelationInput[] => timing === 'past'
  ? [{ endDate: { sort: 'desc', nulls: 'last' } }, { startDate: { sort: 'desc', nulls: 'last' } }, { year: 'desc' }, { id: 'asc' }]
  : [{ startDate: { sort: 'asc', nulls: 'last' } }, { endDate: { sort: 'asc', nulls: 'last' } }, { year: 'asc' }, { id: 'asc' }];

// Everything except the (potentially large) body, tables and references.
const summarySelect = {
  id: true, slug: true, title: true, subtitle: true, sportSlug: true, eventSlug: true, editionYear: true,
  articleType: true, excerpt: true, featuredImage: true, authorId: true, publishedAt: true, updatedAt: true,
  scheduledFor: true, status: true, readingTimeMinutes: true, featured: true, seo: true, featuredMediaId: true,
} satisfies Prisma.ArticleSelect;

/** Media Library items by id, as deliverable assets. */
async function mediaAssets(ids: (string | null | undefined)[]): Promise<Record<string, MediaAsset>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return {};
  const prisma = await db();
  const rows = await prisma.mediaItem.findMany({ where: { id: { in: unique } } });
  return Object.fromEntries(rows.map((r) => [r.id, toMediaAsset(r)]));
}

/** Attaches the sport/event/author display names each card needs, in three batched queries. */
async function summarize(rows: Prisma.ArticleGetPayload<{ select: typeof summarySelect }>[]): Promise<ArticleSummary[]> {
  if (!rows.length) return [];
  const prisma = await db();
  const [sports, events, authors, images] = await Promise.all([
    prisma.sport.findMany({ where: { slug: { in: [...new Set(rows.map((r) => r.sportSlug))] } }, select: { slug: true, name: true } }),
    prisma.sportEvent.findMany({
      where: { slug: { in: [...new Set(rows.map((r) => r.eventSlug).filter((s): s is string => !!s))] } },
      select: { sportSlug: true, slug: true, name: true, shortName: true },
    }),
    prisma.author.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, name: true } }),
    mediaAssets(rows.map((r) => r.featuredMediaId)),
  ]);
  const sportName = new Map(sports.map((s) => [s.slug, s.name]));
  const eventByKey = new Map(events.map((e) => [`${e.sportSlug}/${e.slug}`, e]));
  const authorName = new Map(authors.map((a) => [a.id, a.name]));
  return rows.map((row) => {
    const { content: _c, tables: _t, references: _r, ...article } = toArticle({ ...row, content: '', tables: null, references: null, body: null } as ArticleRow);
    const event = row.eventSlug ? eventByKey.get(`${row.sportSlug}/${row.eventSlug}`) : undefined;
    return {
      ...article,
      url: articlePath(row),
      sportName: sportName.get(row.sportSlug) || row.sportSlug,
      eventName: event?.name,
      eventShortName: event?.shortName,
      authorName: authorName.get(row.authorId),
      image: row.featuredMediaId ? images[row.featuredMediaId] : undefined,
    };
  });
}

async function listArticles(where: Prisma.ArticleWhereInput, opts: { take?: number; skip?: number } = {}) {
  const prisma = await db();
  const rows = await prisma.article.findMany({
    where: await publishedArticleWhere(where),
    orderBy: { publishedAt: 'desc' },
    select: summarySelect,
    ...opts,
  });
  return summarize(rows);
}

async function countArticles(where: Prisma.ArticleWhereInput = {}) {
  const prisma = await db();
  return prisma.article.count({ where: await publishedArticleWhere(where) });
}

/** Events plus their sport name and a link to the current edition, if that edition exists. */
async function summarizeEvents(rows: Prisma.SportEventGetPayload<object>[]): Promise<EventSummary[]> {
  if (!rows.length) return [];
  const prisma = await db();
  const selectedRows = rows.filter((e) => e.currentEditionYear !== null);
  const [sports, editions] = await Promise.all([
    prisma.sport.findMany({ where: { slug: { in: [...new Set(rows.map((e) => e.sportSlug))] } }, select: { slug: true, name: true } }),
    selectedRows.length ? prisma.eventEdition.findMany({
      where: { OR: selectedRows.map((e) => ({ sportSlug: e.sportSlug, eventSlug: e.slug, year: e.currentEditionYear! })) },
      select: { sportSlug: true, eventSlug: true, year: true },
    }) : Promise.resolve([]),
  ]);
  const sportName = new Map(sports.map((s) => [s.slug, s.name]));
  const current = new Set(editions.map((ed) => `${ed.sportSlug}/${ed.eventSlug}/${ed.year}`));
  return rows.map((row) => ({
    ...toEvent(row),
    sportName: sportName.get(row.sportSlug) || row.sportSlug,
    currentEditionUrl: row.currentEditionYear !== null && current.has(`${row.sportSlug}/${row.slug}/${row.currentEditionYear}`)
      ? editionPath(row.sportSlug, row.slug, row.currentEditionYear)
      : undefined,
  }));
}

// ── Page-level queries ──

export async function getNavSports() {
  const prisma = await db();
  return prisma.sport.findMany({ where: { isVisible: true }, orderBy: { order: 'asc' }, select: { id: true, slug: true, name: true, icon: true } });
}

export async function getAdSlots(): Promise<AdSlotConfig[]> {
  const prisma = await db();
  const rows = await prisma.adSlotConfig.findMany({ include: { creative: true } });
  return rows.map((r) => ({
    ...r,
    id: r.id as AdSlotConfig['id'],
    sponsorName: r.sponsorName ?? undefined,
    bannerText: r.bannerText ?? undefined,
    linkUrl: r.linkUrl ?? undefined,
    provider: r.provider === 'adsense' ? 'adsense' : 'house',
  }));
}

export async function getHomeData() {
  const prisma = await db();
  const [latest, totalArticles, featuredEventRows, sports, upcomingRows] = await Promise.all([
    listArticles({}, { take: 8 }),
    countArticles(),
    prisma.sportEvent.findMany({ where: visibleEventWhere({ featured: true }) }),
    prisma.sport.findMany({ where: { isVisible: true }, orderBy: { order: 'asc' } }),
    prisma.eventEdition.findMany({ where: { AND: [{ event: visibleEventWhere() }, editionTimingWhere('upcoming')] }, orderBy: editionTimingOrder('upcoming'), take: 3 }),
  ]);
  const [articleCounts, eventCounts, featuredEvents] = await Promise.all([
    prisma.article.groupBy({ by: ['sportSlug'], where: await publishedArticleWhere(), _count: { _all: true } }),
    prisma.sportEvent.groupBy({ by: ['sportSlug'], where: visibleEventWhere(), _count: { _all: true } }),
    summarizeEvents(featuredEventRows),
  ]);
  const articleCount = new Map(articleCounts.map((c) => [c.sportSlug, c._count._all]));
  const eventCount = new Map(eventCounts.map((c) => [c.sportSlug, c._count._all]));
  const sportName = new Map(sports.map((s) => [s.slug, s.name]));
  return {
    latest,
    totalArticles,
    featuredEvents,
    sports: sports.map((s) => ({ ...toSport(s), articleCount: articleCount.get(s.slug) || 0, eventCount: eventCount.get(s.slug) || 0 })),
    upcomingEditions: upcomingRows.map((ed) => ({
      ...toEdition(ed),
      sportName: sportName.get(ed.sportSlug) || ed.sportSlug,
      url: editionPath(ed.sportSlug, ed.eventSlug, ed.year),
    })),
  };
}

export async function getSportsDirectory() {
  const prisma = await db();
  const [sports, articleCounts, eventCounts] = await Promise.all([
    prisma.sport.findMany({ where: { isVisible: true }, orderBy: { order: 'asc' } }),
    prisma.article.groupBy({ by: ['sportSlug'], where: await publishedArticleWhere(), _count: { _all: true } }),
    prisma.sportEvent.groupBy({ by: ['sportSlug'], where: visibleEventWhere(), _count: { _all: true } }),
  ]);
  const articleCount = new Map(articleCounts.map((c) => [c.sportSlug, c._count._all]));
  const eventCount = new Map(eventCounts.map((c) => [c.sportSlug, c._count._all]));
  return sports.map((s) => ({ ...toSport(s), articleCount: articleCount.get(s.slug) || 0, eventCount: eventCount.get(s.slug) || 0 }));
}

export async function getSport(slug: string): Promise<Sport | null> {
  const prisma = await db();
  const row = await prisma.sport.findFirst({ where: { slug, isVisible: true } });
  return row ? toSport(row) : null;
}

/** PHASE R: Article Types whose SEO profile marks them as evergreen reference content (Spec §8.6 "Related Articles"). */
const EVERGREEN_PROFILES = ['event-guide', 'past-winners', 'records', 'venue', 'qualification', 'rules-format', 'history', 'analysis', 'general', 'players', 'teams', 'prize-money', 'viewing'];
async function evergreenTypes(): Promise<string[]> {
  const { allArticleTypes } = await import('../../articleTypes');
  return (await allArticleTypes()).filter((t) => EVERGREEN_PROFILES.includes(t.seoProfile)).map((t) => t.name);
}

/** Bounded list sizes for hub pages (Spec §23.4, §26.2: no unbounded listings). */
export const HUB_LIMITS = { featuredEvents: 6, upcoming: 6, latest: 12, events: 24, guides: 12, explore: 6, editionLatest: 9, related: 6, eventEditions: 30, author: 30 } as const;

/** Merges ranked lists, keeping the first occurrence of each article. */
function mergeUnique(lists: ArticleSummary[][], exclude: Set<string>, limit: number): ArticleSummary[] {
  const out: ArticleSummary[] = [];
  const seen = new Set(exclude);
  for (const list of lists) for (const a of list) {
    if (out.length >= limit) return out;
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

export async function getSportHub(slug: string) {
  const sport = await getSport(slug);
  if (!sport) return null;
  const prisma = await db();
  const today = utcToday();
  const sportEvents = visibleEventWhere({ sportSlug: slug });
  const [featuredRows, flaggedRows, eventRows, eventTotal, latestArticles, articleTotal, guides, guideTotal, upcomingRows, recentPastRows, faqs] = await Promise.all([
    sport.featuredEventIds.length ? prisma.sportEvent.findMany({ where: { ...sportEvents, id: { in: sport.featuredEventIds } } }) : Promise.resolve([]),
    prisma.sportEvent.findMany({ where: { ...sportEvents, featured: true }, orderBy: [{ name: 'asc' }], take: HUB_LIMITS.featuredEvents }),
    prisma.sportEvent.findMany({ where: sportEvents, orderBy: [{ featured: 'desc' }, { name: 'asc' }, { id: 'asc' }], take: HUB_LIMITS.events }),
    prisma.sportEvent.count({ where: sportEvents }),
    listArticles({ sportSlug: slug }, { take: HUB_LIMITS.latest }),
    countArticles({ sportSlug: slug }),
    listArticles({ sportSlug: slug, eventSlug: null }, { take: HUB_LIMITS.guides }),
    countArticles({ sportSlug: slug, eventSlug: null }),
    prisma.eventEdition.findMany({ where: { AND: [{ sportSlug: slug, event: visibleEventWhere() }, { OR: [editionTimingWhere('ongoing', today), editionTimingWhere('upcoming', today)] }] }, orderBy: editionTimingOrder('upcoming'), take: HUB_LIMITS.upcoming }),
    prisma.eventEdition.findMany({ where: { AND: [{ sportSlug: slug, event: visibleEventWhere() }, editionTimingWhere('past', today)] }, orderBy: editionTimingOrder('past'), take: HUB_LIMITS.explore }),
    prisma.faqEntry.findMany({ where: { sportId: sport.id, status: 'published' }, orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], select: { id: true, question: true, answer: true } }),
  ]);
  // Featured: the editor's explicit choice (in their order), else events flagged "featured".
  const chosen = sport.featuredEventIds.map((id) => featuredRows.find((e) => e.id === id)).filter((e): e is NonNullable<typeof e> => !!e);
  const featuredEvents = await summarizeEvents(chosen.length ? chosen.slice(0, HUB_LIMITS.featuredEvents) : flaggedRows);
  const editionCard = (ed: Prisma.EventEditionGetPayload<object>) => ({ ...toEdition(ed), sportName: sport.name, url: editionPath(ed.sportSlug, ed.eventSlug, ed.year) });
  return {
    sport,
    faqSchemaEnabled: !!sport.faqSchemaEnabled,
    featuredEvents,
    upcomingEditions: upcomingRows.map(editionCard),
    latestArticles,
    articleTotal,
    events: await summarizeEvents(eventRows),
    eventTotal,
    guides,
    guideTotal,
    recentEditions: recentPastRows.map(editionCard),
    faqs,
  };
}

export const EVENTS_PAGE_SIZE = 12;
export const DISCOVERY_PREVIEW_SIZE = 6;

/** Editions (of visible Events) with their Event/Sport names, for discovery cards. */
async function discoveryEditions(where: Prisma.EventEditionWhereInput, orderBy: Prisma.EventEditionOrderByWithRelationInput[], opts: { take: number; skip?: number }): Promise<DiscoveryEdition[]> {
  const prisma = await db();
  const rows = await prisma.eventEdition.findMany({
    where, orderBy, ...opts,
    include: { event: { select: { name: true, sport: { select: { name: true } } } } },
  });
  return rows.map(({ event, ...ed }) => ({
    ...toEdition(ed),
    sportName: event.sport.name,
    eventName: event.name,
    eventUrl: eventPath(ed.sportSlug, ed.eventSlug),
    url: editionPath(ed.sportSlug, ed.eventSlug, ed.year),
  }));
}

/**
 * PHASE E5: the public Event discovery page. Without `when`, a paginated
 * Event index plus short Happening now / Upcoming / Past previews; with
 * `when`, a paginated list of Editions in that timing. Every list is bounded
 * and filtered in SQL (no full-table loads).
 */
export async function getEventsDirectory({ sport, when, page = 1 }: { sport?: string; when?: EditionTiming; page?: number } = {}) {
  const prisma = await db();
  const today = utcToday();
  const eventWhere = visibleEventWhere(sport ? { sportSlug: sport } : {});
  const editionWhere = (timing: EditionTiming): Prisma.EventEditionWhereInput => ({ AND: [{ event: eventWhere }, editionTimingWhere(timing, today)] });
  const [total, sports, timingCounts] = await Promise.all([
    prisma.sportEvent.count({ where: visibleEventWhere() }),
    prisma.sport.findMany({ where: { isVisible: true }, orderBy: { order: 'asc' }, select: { id: true, slug: true, name: true } }),
    Promise.all((['ongoing', 'upcoming', 'past'] as const).map((t) => prisma.eventEdition.count({ where: editionWhere(t) }))),
  ]);
  const counts: Record<EditionTiming, number> = { ongoing: timingCounts[0], upcoming: timingCounts[1], past: timingCounts[2] };
  const skip = (page - 1) * EVENTS_PAGE_SIZE;

  if (when) {
    const editions = await discoveryEditions(editionWhere(when), editionTimingOrder(when), { take: EVENTS_PAGE_SIZE, skip });
    return { today, total, sports, counts, when, page, totalPages: Math.max(1, Math.ceil(counts[when] / EVENTS_PAGE_SIZE)), events: [] as EventSummary[], eventTotal: 0, editions, previews: null };
  }

  const [eventTotal, eventRows, ongoing, upcoming, past] = await Promise.all([
    prisma.sportEvent.count({ where: eventWhere }),
    prisma.sportEvent.findMany({ where: eventWhere, orderBy: [{ featured: 'desc' }, { name: 'asc' }, { id: 'asc' }], take: EVENTS_PAGE_SIZE, skip }),
    discoveryEditions(editionWhere('ongoing'), editionTimingOrder('ongoing'), { take: DISCOVERY_PREVIEW_SIZE }),
    discoveryEditions(editionWhere('upcoming'), editionTimingOrder('upcoming'), { take: DISCOVERY_PREVIEW_SIZE }),
    discoveryEditions(editionWhere('past'), editionTimingOrder('past'), { take: 3 }),
  ]);
  return {
    today, total, sports, counts, when: undefined, page,
    totalPages: Math.max(1, Math.ceil(eventTotal / EVENTS_PAGE_SIZE)),
    events: await summarizeEvents(eventRows),
    eventTotal,
    editions: [] as DiscoveryEdition[],
    previews: { ongoing, upcoming, past },
  };
}

export async function getEvent(sportSlug: string, eventSlug: string) {
  const prisma = await db();
  const [row, sportRow] = await Promise.all([
    prisma.sportEvent.findFirst({ where: visibleEventWhere({ sportSlug, slug: eventSlug }) }),
    prisma.sport.findFirst({ where: { slug: sportSlug, isVisible: true } }),
  ]);
  if (!row || !sportRow) return null;
  const configuration = resolveSportEventConfiguration(sportRow.eventConfiguration);
  return {
    sport: toSport(sportRow),
    event: { ...toEvent(row), sportSpecificValues: publicSportEventValues(row.sportSpecificValues, configuration) },
    sportConfiguration: { ...configuration, fields: configuration.fields.filter((field) => field.publicVisible) },
  };
}

const faqSelect = { id: true, question: true, answer: true } as const;
const faqOrder: Prisma.FaqEntryOrderByWithRelationInput[] = [{ displayOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }];

/**
 * Event page. Latest Articles = newest published articles of the event;
 * Related Articles = evergreen reference articles (event-level or sport-level)
 * not already listed. Both are generated from relationships (Spec §8.6).
 */
export async function getEventPage(sportSlug: string, eventSlug: string) {
  const found = await getEvent(sportSlug, eventSlug);
  if (!found) return null;
  const prisma = await db();
  const evergreen = await evergreenTypes();
  const [editionRows, editionTotal, articles, articleTotal, relatedRows, faqs] = await Promise.all([
    prisma.eventEdition.findMany({ where: { sportSlug, eventSlug }, orderBy: { year: 'desc' }, take: HUB_LIMITS.eventEditions }),
    prisma.eventEdition.count({ where: { sportSlug, eventSlug } }),
    listArticles({ sportSlug, eventSlug }, { take: HUB_LIMITS.editionLatest }),
    countArticles({ sportSlug, eventSlug }),
    prisma.sportEvent.findMany({ where: visibleEventWhere({ sportSlug, slug: { not: eventSlug } }), orderBy: [{ featured: 'desc' }, { name: 'asc' }], take: 3 }),
    // Published, editor-approved questions scoped to this Event (v2.2: no automatic FAQ).
    prisma.faqEntry.findMany({ where: { eventId: found.event.id, status: 'published' }, orderBy: faqOrder, select: faqSelect }),
  ]);
  const latestIds = new Set(articles.map((a) => a.id));
  const [eventEvergreen, sportEvergreen] = await Promise.all([
    listArticles({ sportSlug, eventSlug, articleType: { in: evergreen }, id: { notIn: [...latestIds] } }, { take: HUB_LIMITS.related }),
    listArticles({ sportSlug, eventSlug: null, articleType: { in: evergreen } }, { take: HUB_LIMITS.related }),
  ]);
  const editions = editionRows.map(toEdition);
  const currentEdition = found.event.currentEditionYear === null
    ? undefined
    : editions.find((ed) => ed.year === found.event.currentEditionYear)
      ?? (await prisma.eventEdition.findFirst({ where: { sportSlug, eventSlug, year: found.event.currentEditionYear } }).then((r) => (r ? toEdition(r) : undefined)));
  return {
    ...found,
    sportSpecificValues: found.event.sportSpecificValues ?? {},
    editions,
    editionTotal,
    articles,
    articleTotal,
    relatedArticles: mergeUnique([eventEvergreen, sportEvergreen], latestIds, HUB_LIMITS.related),
    relatedEvents: await summarizeEvents(relatedRows),
    faqs,
    faqSchemaEnabled: !!found.event.faqSchemaEnabled,
    today: utcToday(),
    currentEdition,
  };
}

/**
 * Edition page (Spec §8.4): Latest Articles = newest published articles of
 * this edition; Related Articles = evergreen articles of the same event
 * (event-level or other editions) and of the sport, excluding the latest list.
 */
export async function getEditionPage(sportSlug: string, eventSlug: string, year: number) {
  const found = await getEvent(sportSlug, eventSlug);
  if (!found) return null;
  const prisma = await db();
  const row = await prisma.eventEdition.findFirst({ where: { sportSlug, eventSlug, year } });
  if (!row) return null;
  const evergreen = await evergreenTypes();
  const [latestArticles, articleTotal, otherYears, faqs] = await Promise.all([
    listArticles({ sportSlug, eventSlug, editionYear: year }, { take: HUB_LIMITS.editionLatest }),
    countArticles({ sportSlug, eventSlug, editionYear: year }),
    prisma.eventEdition.findMany({ where: { sportSlug, eventSlug, year: { not: year } }, select: { id: true, year: true }, orderBy: { year: 'desc' }, take: HUB_LIMITS.eventEditions }),
    prisma.faqEntry.findMany({ where: { editionId: row.id, status: 'published' }, orderBy: faqOrder, select: faqSelect }),
  ]);
  const latestIds = new Set(latestArticles.map((a) => a.id));
  const [eventEvergreen, sportEvergreen] = await Promise.all([
    listArticles({ sportSlug, eventSlug, articleType: { in: evergreen }, OR: [{ editionYear: null }, { editionYear: { not: year } }] }, { take: HUB_LIMITS.related }),
    listArticles({ sportSlug, eventSlug: null, articleType: { in: evergreen } }, { take: HUB_LIMITS.related }),
  ]);
  return {
    ...found,
    edition: toEdition(row),
    latestArticles,
    articleTotal,
    relatedArticles: mergeUnique([eventEvergreen, sportEvergreen], latestIds, HUB_LIMITS.related),
    otherEditions: otherYears,
    faqs,
    faqSchemaEnabled: row.faqSchemaEnabled,
  };
}

/**
 * A single published article at its canonical location. `eventSlug`/`year`
 * are given for edition articles; for the two-segment URL both are absent
 * and only articles without an edition match.
 */
export async function getArticlePage(sportSlug: string, slug: string, eventSlug?: string, year?: number) {
  const prisma = await db();
  const row = await prisma.article.findFirst({
    where: await publishedArticleWhere(
      eventSlug && year ? { sportSlug, slug, eventSlug, editionYear: year } : { sportSlug, slug, editionYear: null }
    ),
  });
  if (!row) return null;
  const sport = await getSport(sportSlug);
  if (!sport) return null;
  return buildArticleView(row, sport, true);
}

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'when', 'where', 'how', 'who', 'your', 'about', 'into', 'will', 'are', 'was', 'guide', 'complete']);

/**
 * Topic similarity (Spec §12 priority 4): published articles of the sport
 * whose full-text document matches the title's significant words, ranked by
 * PostgreSQL ts_rank. Bounded and index-backed (Article_searchVector_idx).
 */
async function similarArticleIds(sportSlug: string, excludeId: string, title: string, limit: number): Promise<string[]> {
  const terms = [...new Set(title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length > 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w)))].slice(0, 8);
  if (!terms.length) return [];
  const prisma = await db();
  const query = terms.join(' | ');
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Article"
    WHERE "status" = 'published' AND "sportSlug" = ${sportSlug} AND "id" <> ${excludeId}
      AND "searchVector" @@ to_tsquery('english', ${query})
    ORDER BY ts_rank("searchVector", to_tsquery('english', ${query})) DESC, "publishedAt" DESC
    LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

/**
 * Everything the article template needs. Shared by the public page and the
 * staff preview so both render identically. `withRelated` is false for
 * previews (no public listing data needed).
 */
async function buildArticleView(row: ArticleRow, sport: Sport, withRelated: boolean) {
  const prisma = await db();
  const article = toArticle(row);
  const sportSlug = row.sportSlug;
  const body: RichDoc = (row.body as unknown as RichDoc | null) ?? legacyToDoc(row.content);
  const bodyMediaIds: string[] = [];
  const collect = (nodes: RichDoc['content']) => nodes.forEach((n) => (n.type === 'image' ? bodyMediaIds.push(String(n.attrs?.mediaId)) : n.content && collect(n.content)));
  collect(body.content);
  const [eventRow, editionRow, authorRow, media, faqs, typeDef] = await Promise.all([
    article.eventSlug ? prisma.sportEvent.findFirst({ where: visibleEventWhere({ sportSlug, slug: article.eventSlug }) }) : null,
    article.eventSlug && article.editionYear
      ? prisma.eventEdition.findFirst({ where: { sportSlug, eventSlug: article.eventSlug, year: article.editionYear } })
      : null,
    prisma.author.findUnique({ where: { id: article.authorId } }),
    mediaAssets([row.featuredMediaId, ...bodyMediaIds]),
    prisma.faqEntry.findMany({ where: { articleId: row.id, status: 'published' }, orderBy: faqOrder, select: faqSelect }),
    import('../../articleTypes').then((m) => m.articleTypeMap()).then((map) => map.get(row.articleType) ?? null),
  ]);

  // Related content priority (Spec §12): same edition → same event → same sport
  // + topic similarity → newest in the sport. Each step is a bounded, indexed
  // query (no fixed "latest 24" window), so older but closely related
  // articles are still found as the archive grows.
  let related: ArticleSummary[] = [];
  let latest: ArticleSummary[] = [];
  if (withRelated) {
    const self = new Set([article.id]);
    const RELATED = 3;
    const [sameEdition, sameEvent, similarIds] = await Promise.all([
      article.eventSlug && article.editionYear ? listArticles({ sportSlug, eventSlug: article.eventSlug, editionYear: article.editionYear, id: { not: article.id } }, { take: RELATED + 1 }) : Promise.resolve([]),
      article.eventSlug ? listArticles({ sportSlug, eventSlug: article.eventSlug, id: { not: article.id }, ...(article.editionYear ? { NOT: { editionYear: article.editionYear } } : {}) }, { take: RELATED + 1 }) : Promise.resolve([]),
      similarArticleIds(sportSlug, article.id, `${article.title} ${article.articleType}`, RELATED + 1),
    ]);
    const similar = similarIds.length ? (await listArticles({ id: { in: similarIds } })).sort((a, b) => similarIds.indexOf(a.id) - similarIds.indexOf(b.id)) : [];
    const needFallback = sameEdition.length + sameEvent.length + similar.length < RELATED;
    const sportRecent = needFallback ? await listArticles({ sportSlug, id: { not: article.id } }, { take: RELATED + 1 }) : [];
    related = mergeUnique([sameEdition, sameEvent, similar, sportRecent], self, RELATED);
    // Latest Articles (Spec §9.7): newest in the same sport, not already shown as related (never other sports).
    const shown = new Set([article.id, ...related.map((a) => a.id)]);
    latest = (await listArticles({ sportSlug, id: { notIn: [...shown] } }, { take: 4 }));
  }

  return {
    article,
    body,
    media,
    featuredImage: row.featuredMediaId ? media[row.featuredMediaId] : undefined,
    sport,
    event: eventRow ? toEvent(eventRow) : null,
    edition: editionRow ? toEdition(editionRow) : null,
    author: authorRow ? toAuthor(authorRow) : null,
    related,
    latest,
    faqs,
    faqSchemaEnabled: row.faqSchemaEnabled,
    schemaType: typeDef?.schemaType ?? 'Article',
  };
}

/**
 * Staff preview (PHASE C): any status, including drafts. Callers MUST have
 * authorized the viewer first (see src/app/admin/preview). Authors may only
 * preview their own articles.
 */
export async function getArticlePreview(id: string, viewer: { userId: string; role: string }) {
  const prisma = await db();
  const row = await prisma.article.findUnique({ where: { id } });
  if (!row) return null;
  if (viewer.role === 'Author') {
    const owner = await prisma.author.findUnique({ where: { id: row.authorId }, select: { userId: true } });
    if (owner?.userId !== viewer.userId) return null;
  }
  const sportRow = await prisma.sport.findUnique({ where: { slug: row.sportSlug } });
  if (!sportRow) return null;
  return buildArticleView(row, toSport(sportRow), false);
}

export const LATEST_PAGE_SIZE = 6;

export async function getLatest({ sport, type, page }: { sport?: string; type?: string; page: number }) {
  const prisma = await db();
  const where: Prisma.ArticleWhereInput = {};
  if (sport) where.sportSlug = sport;
  if (type) where.articleType = type;
  const [total, allPublished, articles, sports] = await Promise.all([
    countArticles(where),
    countArticles(),
    listArticles(where, { take: LATEST_PAGE_SIZE, skip: (page - 1) * LATEST_PAGE_SIZE }),
    prisma.sport.findMany({ where: { isVisible: true }, orderBy: { order: 'asc' }, select: { id: true, slug: true, name: true } }),
  ]);
  // PHASE R: the type filter lists the active, database-backed Article Types.
  const types = (await (await import('../../articleTypes')).activeArticleTypes()).map((t) => t.name);
  return { total, allPublished, articles, sports, types, totalPages: Math.max(1, Math.ceil(total / LATEST_PAGE_SIZE)) };
}

export async function getAuthorPage(slug: string) {
  const prisma = await db();
  const row = await prisma.author.findUnique({ where: { slug } });
  if (!row) return null;
  // PHASE R: bounded (newest first) with the total, so large bylines stay fast.
  const [articles, articleTotal] = await Promise.all([listArticles({ authorId: row.id }, { take: HUB_LIMITS.author }), countArticles({ authorId: row.id })]);
  return { author: toAuthor(row), articles, articleTotal };
}

/** Approved comments only; callers check the comments launch flag first. */
export async function getApprovedComments(articleId: string): Promise<Comment[]> {
  const prisma = await db();
  const rows = await prisma.comment.findMany({ where: { articleId, status: 'approved' }, orderBy: { createdAt: 'desc' } });
  return rows.map((c) => ({ ...c, userAvatar: c.userAvatar ?? undefined, userRole: c.userRole ?? undefined, createdAt: c.createdAt.toISOString() }));
}

export { listArticles as _listArticles, countArticles as _countArticles, summarize as _summarize, summarySelect as _summarySelect, summarizeEvents as _summarizeEvents, publishedArticleWhere as _publishedArticleWhere, visibleEventWhere as _visibleEventWhere, toSport as _toSport, toEdition as _toEdition, db as _db };
