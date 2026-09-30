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
import { articlePath, editionPath } from '../../../src/lib/paths';
import { toMediaAsset, type MediaAsset } from '../../../src/lib/media';
import { legacyToDoc, type RichDoc } from '../../../src/lib/richText';
import { publicSportEventValues, resolveSportEventConfiguration } from '../../sportEventConfiguration';

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
    prisma.eventEdition.findMany({ where: { status: 'upcoming', event: visibleEventWhere() }, take: 3 }),
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

export async function getSportHub(slug: string) {
  const sport = await getSport(slug);
  if (!sport) return null;
  const prisma = await db();
  const [eventRows, articles, editionRows] = await Promise.all([
    prisma.sportEvent.findMany({ where: visibleEventWhere({ sportSlug: slug }) }),
    listArticles({ sportSlug: slug }),
    prisma.eventEdition.findMany({ where: { sportSlug: slug, event: visibleEventWhere() } }),
  ]);
  return {
    sport,
    events: await summarizeEvents(eventRows),
    articles,
    editions: editionRows.map((ed) => ({ ...toEdition(ed), sportName: sport.name, url: editionPath(ed.sportSlug, ed.eventSlug, ed.year) })),
  };
}

export async function getEventsDirectory(sportFilter?: string) {
  const prisma = await db();
  const allRows = await prisma.sportEvent.findMany({ where: visibleEventWhere() });
  const events = await summarizeEvents(allRows);
  const sports = await prisma.sport.findMany({ where: { isVisible: true }, orderBy: { order: 'asc' }, select: { id: true, slug: true, name: true } });
  return {
    total: events.length,
    sports,
    events: sportFilter ? events.filter((e) => e.sportSlug === sportFilter) : events,
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

export async function getEventPage(sportSlug: string, eventSlug: string) {
  const found = await getEvent(sportSlug, eventSlug);
  if (!found) return null;
  const prisma = await db();
  const [editionRows, articles, relatedRows] = await Promise.all([
    prisma.eventEdition.findMany({ where: { sportSlug, eventSlug }, orderBy: { year: 'desc' } }),
    listArticles({ sportSlug, eventSlug }),
    prisma.sportEvent.findMany({ where: visibleEventWhere({ sportSlug, slug: { not: eventSlug } }), orderBy: [{ featured: 'desc' }, { name: 'asc' }], take: 3 }),
  ]);
  const editions = editionRows.map(toEdition);
  return {
    ...found,
    sportSpecificValues: found.event.sportSpecificValues ?? {},
    editions,
    articles,
    relatedEvents: await summarizeEvents(relatedRows),
    currentEdition: found.event.currentEditionYear === null ? undefined : editions.find((ed) => ed.year === found.event.currentEditionYear),
  };
}

export async function getEditionPage(sportSlug: string, eventSlug: string, year: number) {
  const found = await getEvent(sportSlug, eventSlug);
  if (!found) return null;
  const prisma = await db();
  const row = await prisma.eventEdition.findFirst({ where: { sportSlug, eventSlug, year } });
  if (!row) return null;
  const [articles, otherYears] = await Promise.all([
    listArticles({ sportSlug, eventSlug, editionYear: year }),
    prisma.eventEdition.findMany({ where: { sportSlug, eventSlug, year: { not: year } }, select: { id: true, year: true } }),
  ]);
  return { ...found, edition: toEdition(row), articles, otherEditions: otherYears };
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
  const [eventRow, editionRow, authorRow, media] = await Promise.all([
    article.eventSlug ? prisma.sportEvent.findFirst({ where: visibleEventWhere({ sportSlug, slug: article.eventSlug }) }) : null,
    article.eventSlug && article.editionYear
      ? prisma.eventEdition.findFirst({ where: { sportSlug, eventSlug: article.eventSlug, year: article.editionYear } })
      : null,
    prisma.author.findUnique({ where: { id: article.authorId } }),
    mediaAssets([row.featuredMediaId, ...bodyMediaIds]),
  ]);

  // Related content priority (Spec §12): same edition -> same event -> same sport, newest first.
  const candidates = withRelated ? await listArticles({ sportSlug, id: { not: article.id } }, { take: 24 }) : [];
  const rank = (a: ArticleSummary) =>
    a.eventSlug === article.eventSlug && article.eventSlug
      ? a.editionYear === article.editionYear && article.editionYear ? 0 : 1
      : 2;
  const related = [...candidates].sort((a, b) => rank(a) - rank(b)).slice(0, 3);

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
  return { total, allPublished, articles, sports, totalPages: Math.max(1, Math.ceil(total / LATEST_PAGE_SIZE)) };
}

export async function getAuthorPage(slug: string) {
  const prisma = await db();
  const row = await prisma.author.findUnique({ where: { slug } });
  if (!row) return null;
  return { author: toAuthor(row), articles: await listArticles({ authorId: row.id }) };
}

/** Approved comments only; callers check the comments launch flag first. */
export async function getApprovedComments(articleId: string): Promise<Comment[]> {
  const prisma = await db();
  const rows = await prisma.comment.findMany({ where: { articleId, status: 'approved' }, orderBy: { createdAt: 'desc' } });
  return rows.map((c) => ({ ...c, userAvatar: c.userAvatar ?? undefined, userRole: c.userRole ?? undefined, createdAt: c.createdAt.toISOString() }));
}

export { listArticles as _listArticles, countArticles as _countArticles, summarize as _summarize, summarySelect as _summarySelect, summarizeEvents as _summarizeEvents, publishedArticleWhere as _publishedArticleWhere, visibleEventWhere as _visibleEventWhere, toSport as _toSport, toEdition as _toEdition, db as _db };
