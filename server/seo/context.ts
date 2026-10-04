/**
 * Data an SEO evaluation needs (PHASE D). Loaded once per scan or per
 * editor check — never during public page rendering.
 */

import { prisma } from '../db';
import { legacyToDoc, type RichDoc } from '../../src/lib/richText';
import { articlePath, editionPath, eventPath, sportPath } from '../../src/lib/paths';
import type { SeoMetadata } from '../../src/types';
import { analyzeDoc, type DocAnalysis } from './analyze';
import { loadSiteIndex, type SiteIndex } from './siteIndex';

export interface ArticleSubject {
  id: string;
  title: string;
  subtitle: string;
  slug: string;
  status: string;
  articleType: string;
  sportSlug: string;
  eventSlug: string | null;
  editionYear: number | null;
  excerpt: string;
  seo: SeoMetadata;
  doc: RichDoc;
  a: DocAnalysis;
  featuredMediaId: string | null;
  featuredImage: string;
  references: { title: string; url: string }[];
  structuredTables: number;
  publishedAt: Date;
  updatedAt: Date | null;
  reviewedAt: Date | null;
  authorId: string;
  path: string;
}

type ArticleInput = {
  id: string; title: string; subtitle?: string | null; slug: string; status: string; articleType: string; sportSlug: string;
  eventSlug?: string | null; editionYear?: number | null; excerpt?: string | null; seo?: unknown; body?: unknown; content?: string | null;
  featuredMediaId?: string | null; featuredImage?: string | null; references?: unknown; tables?: unknown;
  publishedAt?: Date | string | null; updatedAt?: Date | string | null; reviewedAt?: Date | string | null; authorId?: string | null;
};

const toDate = (v: Date | string | null | undefined) => (v ? new Date(v) : null);

export function toArticleSubject(row: ArticleInput): ArticleSubject {
  const doc = (row.body as RichDoc | null) || legacyToDoc(row.content || '');
  return {
    id: row.id,
    title: row.title || '',
    subtitle: row.subtitle || '',
    slug: row.slug || '',
    status: row.status,
    articleType: row.articleType,
    sportSlug: row.sportSlug,
    eventSlug: row.eventSlug || null,
    editionYear: row.editionYear ?? null,
    excerpt: row.excerpt || '',
    seo: (row.seo as SeoMetadata) || {},
    doc,
    a: analyzeDoc(doc),
    featuredMediaId: row.featuredMediaId || null,
    featuredImage: row.featuredImage || '',
    references: Array.isArray(row.references) ? (row.references as { title: string; url: string }[]) : [],
    structuredTables: Array.isArray(row.tables) ? row.tables.length : 0,
    publishedAt: toDate(row.publishedAt) || new Date(),
    updatedAt: toDate(row.updatedAt),
    reviewedAt: toDate(row.reviewedAt),
    authorId: row.authorId || '',
    path: articlePath({ sportSlug: row.sportSlug, eventSlug: row.eventSlug, editionYear: row.editionYear, slug: row.slug || 'draft' }),
  };
}

export async function buildSeoContext(origin: string) {
  const [site, sports, events, editions, media, articles, settings] = await Promise.all([
    loadSiteIndex(origin),
    prisma.sport.findMany(),
    prisma.sportEvent.findMany(),
    prisma.eventEdition.findMany(),
    prisma.mediaItem.findMany(),
    prisma.article.findMany(),
    prisma.siteSetting.findMany(),
  ]);
  // PHASE R: Article Type SEO profiles (custom types inherit the checks of their profile),
  // existing URL collisions and repeated no-result searches (content opportunities).
  const [{ allArticleTypes }, { findShadowedArticles }, { noResultOpportunities }] = await Promise.all([import('../articleTypes'), import('../urlStability'), import('../searchAnalytics')]);
  const [types, shadowed, noResults] = await Promise.all([allArticleTypes(), findShadowedArticles(), noResultOpportunities().catch(() => [])]);
  const typeProfiles = new Map<string, string>(types.map((t) => [t.name, t.seoProfile as string]));
  const subjects = articles.map(toArticleSubject);
  const published = subjects.filter((s) => s.status === 'published');

  // Editorial inbound links between published articles (listings excluded).
  const inbound = new Map<string, number>();
  for (const s of published) {
    for (const l of s.a.links) {
      const target = site.resolve(new URL(l.href, origin).origin === origin ? new URL(l.href, origin).pathname : '');
      if (target && target.path !== s.path) inbound.set(target.path, (inbound.get(target.path) || 0) + 1);
    }
  }
  const countBy = (values: string[]) => values.reduce((m, v) => m.set(v, (m.get(v) || 0) + 1), new Map<string, number>());

  return {
    now: new Date(),
    origin,
    site,
    sports: new Map(sports.map((s) => [s.slug, s])),
    events: new Map(events.map((e) => [`${e.sportSlug}/${e.slug}`, e])),
    editions: new Map(editions.map((ed) => [`${ed.sportSlug}/${ed.eventSlug}/${ed.year}`, ed])),
    eventList: events.map((e) => ({ ...e, path: eventPath(e.sportSlug, e.slug) })),
    editionList: editions.map((ed) => ({ ...ed, path: editionPath(ed.sportSlug, ed.eventSlug, ed.year) })),
    sportList: sports.map((s) => ({ ...s, path: sportPath(s.slug) })),
    media: new Map(media.map((m) => [m.id, m])),
    mediaList: media,
    articles: subjects,
    published,
    inbound,
    titleCounts: countBy(published.map((s) => (s.seo.metaTitle || s.title).trim().toLowerCase())),
    descriptionCounts: countBy(published.map((s) => (s.seo.metaDescription || s.excerpt).trim().toLowerCase()).filter(Boolean)),
    settings: Object.fromEntries(settings.map((s) => [s.key, s.value])) as Record<string, string>,
    typeProfiles,
    shadowed,
    noResults,
  };
}

export type SeoContext = Awaited<ReturnType<typeof buildSeoContext>>;
