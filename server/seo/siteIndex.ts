/**
 * Site index (PHASE D): every public URL, what it is, and whether it may be
 * indexed — built from the database with the shared rules in
 * src/lib/indexability.ts. Used by the XML sitemap, redirect validation and
 * the SEO scanner (never by public page rendering).
 */

import { prisma } from '../db';
import { articlePath, authorPath, editionPath, eventPath, sportPath } from '../../src/lib/paths';
import { canonicalPagePath, stripTrailingSlash } from '../../src/config/urls';
import {
  STATIC_INDEXABLE_PATHS,
  STATIC_NON_INDEXABLE_PATHS,
  FAQ_PATH,
  articleIndexability,
  authorIndexability,
  editionIndexability,
  eventIndexability,
  sportIndexability,
  type Indexability,
} from '../../src/lib/indexability';
import type { SeoMetadata } from '../../src/types';

export type PageKind = 'static' | 'sport' | 'event' | 'edition' | 'article' | 'author';

export interface IndexedPage {
  path: string;
  kind: PageKind;
  id: string;
  title: string;
  status: Indexability;
  /** Last meaningful content change (articles only; see sitemap rules). */
  lastmod?: Date;
}

export async function loadSiteIndex(origin: string) {
  const [sports, events, editions, articles, authors, redirects, publishedFaqs, faqPageSetting] = await Promise.all([
    prisma.sport.findMany(),
    prisma.sportEvent.findMany(),
    prisma.eventEdition.findMany(),
    prisma.article.findMany({ where: { status: 'published' }, select: { id: true, slug: true, title: true, sportSlug: true, eventSlug: true, editionYear: true, status: true, seo: true, authorId: true, publishedAt: true, updatedAt: true } }),
    prisma.author.findMany({ select: { id: true, slug: true, name: true } }),
    prisma.redirectRule.findMany({ where: { isActive: true } }),
    prisma.faqEntry.count({ where: { status: 'published', eventId: null, articleId: null, editionId: null, sportId: null } }),
    prisma.siteSetting.findUnique({ where: { key: 'globalFaqPage' } }),
  ]);

  const sportBySlug = new Map(sports.map((s) => [s.slug, s]));
  const eventByKey = new Map(events.map((e) => [`${e.sportSlug}/${e.slug}`, e]));
  const eventVisible = (sportSlug: string, eventSlug: string) => {
    const e = eventByKey.get(`${sportSlug}/${eventSlug}`);
    return !!e && e.isVisible && !!sportBySlug.get(sportSlug)?.isVisible;
  };
  const articleVisible = (a: { sportSlug: string; eventSlug: string | null }) =>
    !!sportBySlug.get(a.sportSlug)?.isVisible && (!a.eventSlug || eventVisible(a.sportSlug, a.eventSlug));

  const pages: IndexedPage[] = [];
  for (const path of STATIC_INDEXABLE_PATHS) pages.push({ path, kind: 'static', id: path, title: path, status: { indexable: true } });
  for (const [path, reason] of Object.entries(STATIC_NON_INDEXABLE_PATHS)) pages.push({ path, kind: 'static', id: path, title: path, status: { indexable: false, reason } });
  // PHASE H: the FAQ is indexable once it has published questions (an empty page is thin).
  // PHASE R (v2.2): the site-wide page exists only when enabled in Settings (otherwise a real 404).
  if (faqPageSetting?.value === 'enabled') {
    pages.push({ path: FAQ_PATH, kind: 'static', id: FAQ_PATH, title: 'FAQ', status: publishedFaqs > 0 ? { indexable: true } : { indexable: false, reason: 'no published questions yet' } });
  }

  const visibleArticles = articles.filter(articleVisible);
  for (const s of sports) {
    const status = sportIndexability({
      isVisible: s.isVisible,
      seo: s.seo as SeoMetadata,
      publishedArticleCount: visibleArticles.filter((a) => a.sportSlug === s.slug).length,
      visibleEventCount: events.filter((e) => e.sportSlug === s.slug && e.isVisible).length,
    }, sportPath(s.slug), origin);
    if (s.isVisible) pages.push({ path: sportPath(s.slug), kind: 'sport', id: s.id, title: s.name, status });
  }
  const eventStatus = new Map<string, Indexability>();
  for (const e of events) {
    const status = eventIndexability({ isVisible: e.isVisible, sportVisible: !!sportBySlug.get(e.sportSlug)?.isVisible, seo: e.seo as SeoMetadata }, eventPath(e.sportSlug, e.slug), origin);
    eventStatus.set(`${e.sportSlug}/${e.slug}`, status);
    if (eventVisible(e.sportSlug, e.slug)) pages.push({ path: eventPath(e.sportSlug, e.slug), kind: 'event', id: e.id, title: e.name, status });
  }
  for (const ed of editions) {
    if (!eventVisible(ed.sportSlug, ed.eventSlug)) continue;
    const status = editionIndexability({ eventIndexable: !!eventStatus.get(`${ed.sportSlug}/${ed.eventSlug}`)?.indexable, seo: ed.seo as SeoMetadata }, editionPath(ed.sportSlug, ed.eventSlug, ed.year), origin);
    pages.push({ path: editionPath(ed.sportSlug, ed.eventSlug, ed.year), kind: 'edition', id: ed.id, title: ed.title, status });
  }
  for (const a of visibleArticles) {
    const path = articlePath(a);
    const status = articleIndexability({ status: a.status, visible: true, seo: a.seo as SeoMetadata, path }, origin);
    pages.push({ path, kind: 'article', id: a.id, title: a.title, status, lastmod: a.updatedAt && a.updatedAt > a.publishedAt ? a.updatedAt : a.publishedAt });
  }
  for (const au of authors) {
    const count = visibleArticles.filter((a) => a.authorId === au.id).length;
    pages.push({ path: authorPath(au.slug), kind: 'author', id: au.id, title: au.name, status: authorIndexability(count) });
  }

  // A URL that an active redirect claims is never served as a page (the
  // redirect engine runs first), so it can't be indexed either.
  const redirectSources = new Map(redirects.map((r) => [canonicalPagePath(r.sourceUrl), r]));
  for (const p of pages) {
    if (p.status.indexable && redirectSources.has(p.path)) p.status = { indexable: false, reason: 'an active redirect is configured for this URL' };
  }

  const byPath = new Map(pages.map((p) => [p.path, p]));
  return {
    pages,
    redirects,
    /** Resolve any internal URL (with or without trailing slash) to a public page, or null (a real 404). */
    resolve(path: string): IndexedPage | null {
      const clean = path.split(/[?#]/)[0];
      return byPath.get(canonicalPagePath(clean)) || null;
    },
    /** The active redirect whose source is this path, if any. */
    redirectFor(path: string) {
      return redirects.find((r) => r.sourceUrl === stripTrailingSlash(path.split(/[?#]/)[0])) || null;
    },
  };
}

export type SiteIndex = Awaited<ReturnType<typeof loadSiteIndex>>;
