/**
 * Public side of the Site Experience (PHASE F.1): turns the effective
 * documents into what pages render. Only publicly visible content is ever
 * resolved. Manually chosen articles that are no longer public are skipped
 * (and automatic sources fill the gap), empty sections are dropped, and an
 * article already shown higher on the homepage is not repeated by an
 * automatic section.
 */

import type { Prisma } from '../../generated/prisma/client';
import {
  _db as db, _listArticles as listArticles, _countArticles as countArticles, _summarize as summarize, _summarySelect as summarySelect,
  _publishedArticleWhere as publishedArticleWhere, _summarizeEvents as summarizeEvents, _visibleEventWhere as visibleEventWhere,
  _toSport as toSport, _toEdition as toEdition, editionTimingWhere, editionTimingOrder, type ArticleSummary, type EventSummary,
} from './content';
import { editionPath } from '../../../src/lib/paths';
import { effectiveDocuments } from '../../siteExperience';
import { toMediaAsset, type MediaAsset } from '../../../src/lib/media';
import { introMediaReferences } from '../../../src/lib/siteExperience/intro';
import { inWindow, type ArticleSource, type AutoSource, type BlockPlacement, type GlobalBlock, type HomeSection, type SiteExperienceDocs } from '../../../src/lib/siteExperience/types';
import { HOMEPAGE_H1, HOMEPAGE_INTRO, LEGACY_HOMEPAGE_INTRO } from '../../../src/lib/siteExperience/defaults';

export type ResolvedAnnouncement = { id: string; variant: 'breaking' | 'info'; text: string; href: string | null };
export type ResolvedBlock = Omit<GlobalBlock, 'articleId'> & { article: ArticleSummary | null };

async function publicArticles(ids: string[]): Promise<Map<string, ArticleSummary>> {
  if (!ids.length) return new Map();
  const prisma = await db();
  const rows = await prisma.article.findMany({ where: await publishedArticleWhere({ id: { in: [...new Set(ids)] } }), select: summarySelect });
  return new Map((await summarize(rows)).map((a) => [a.id, a]));
}

/** The site-wide pieces every page needs (header, footer, announcements, blocks). */
export async function getSiteLayout(options: { preview: boolean }) {
  const docs = await effectiveDocuments({ preview: options.preview });
  const now = Date.now();
  const announcements = docs.announcements.items.filter((a) => a.enabled && inWindow(a, now)).sort((a, b) => b.priority - a.priority);
  const blocks = docs.blocks.items.filter((b) => b.enabled && inWindow(b, now));
  const linked = await publicArticles([...announcements.map((a) => a.articleId), ...blocks.map((b) => b.articleId)].filter(Boolean));
  return {
    preview: options.preview,
    docs,
    announcements: announcements
      .map((a): ResolvedAnnouncement => ({ id: a.id, variant: a.variant, text: a.text, href: a.articleId ? linked.get(a.articleId)?.url ?? null : a.href || null }))
      // An announcement pointing at an article that is no longer public is withdrawn, not shown with a dead link.
      .filter((a, i) => !announcements[i].articleId || a.href),
    blocks: blocks
      .map(({ articleId, ...b }): ResolvedBlock => ({ ...b, article: articleId ? linked.get(articleId) ?? null : null }))
      .filter((b) => b.type !== 'featuredStory' || b.article),
  };
}
export type SiteLayout = Awaited<ReturnType<typeof getSiteLayout>>;

export const blocksFor = (layout: SiteLayout, placement: BlockPlacement) => layout.blocks.filter((b) => b.placements.includes(placement));

function autoWhere(auto: AutoSource): Prisma.ArticleWhereInput {
  if (auto.kind === 'sport') return { sportSlug: auto.value };
  if (auto.kind === 'event') { const [sportSlug, eventSlug] = auto.value.split('/'); return { sportSlug, eventSlug }; }
  if (auto.kind === 'type') return { articleType: auto.value };
  return {};
}

export type ResolvedSection =
  | { id: string; type: 'intro'; section: Extract<HomeSection, { type: 'intro' }>; image: MediaAsset | null }
  | { id: string; type: 'featured' | 'articles'; section: Extract<HomeSection, { type: 'featured' | 'articles' }>; articles: ArticleSummary[]; total: number }
  | { id: string; type: 'featuredEvents'; section: Extract<HomeSection, { type: 'featuredEvents' }>; events: EventSummary[] }
  | { id: string; type: 'sportsGrid'; section: Extract<HomeSection, { type: 'sportsGrid' }>; sports: (ReturnType<typeof toSport> & { articleCount: number; eventCount: number })[] }
  | { id: string; type: 'upcomingEditions'; section: Extract<HomeSection, { type: 'upcomingEditions' }>; editions: (ReturnType<typeof toEdition> & { sportName: string; url: string })[] }
  | { id: string; type: 'block'; block: ResolvedBlock }
  | { id: string; type: 'adSlot'; slot: 'HOMEPAGE_TOP' | 'HOMEPAGE_MIDDLE' };

/** Resolves the homepage sections, in order, skipping disabled and empty ones. */
export async function getHomepageSections(docs: SiteExperienceDocs, layout: SiteLayout): Promise<ResolvedSection[]> {
  const prisma = await db();
  const sections = docs.homepage.sections.filter((s) => s.enabled);
  const has = (t: HomeSection['type']) => sections.some((s) => s.type === t);
  const manualIds = sections.flatMap((s) => ('source' in s && s.source.mode !== 'auto' ? s.source.articleIds : []));
  const imageIds = [...new Set(introMediaReferences({ sections }).map((s) => s.mediaId))];
  const introImages = new Map((imageIds.length ? await prisma.mediaItem.findMany({ where: { id: { in: imageIds }, copyrightReview: { not: 'restricted' } } }) : []).map((m) => [m.id, toMediaAsset(m)]));

  const articleSections = sections.filter((s): s is Extract<HomeSection, { type: 'featured' | 'articles' }> => 'source' in s);
  const sourceKey = (s: AutoSource) => JSON.stringify(s);
  const sources = [...new Map(articleSections.map((s) => [sourceKey(s.source.auto), s.source.auto])).values()];
  const publicWhere = await publishedArticleWhere();
  const take = Math.max(1, articleSections.reduce((n, s) => n + s.count, 0));
  const [manual, featuredEventRows, sportRows, upcomingRows, sourceRows, sourceTotals] = await Promise.all([
    publicArticles(manualIds),
    has('featuredEvents') ? prisma.sportEvent.findMany({ where: visibleEventWhere({ featured: true }) }) : Promise.resolve([]),
    has('sportsGrid') || has('upcomingEditions') ? prisma.sport.findMany({ where: { isVisible: true }, orderBy: { order: 'asc' } }) : Promise.resolve([]),
    has('upcomingEditions') ? prisma.eventEdition.findMany({ where: { AND: [{ event: visibleEventWhere() }, editionTimingWhere('upcoming')] }, orderBy: editionTimingOrder('upcoming'), take: 12 }) : Promise.resolve([]),
    Promise.all(sources.map((auto) => prisma.article.findMany({ where: { AND: [publicWhere, autoWhere(auto)] }, select: summarySelect, orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }], take }))),
    Promise.all(sources.map((auto) => articleSections.some((s) => s.type === 'articles' && s.moreLink && sourceKey(s.source.auto) === sourceKey(auto)) ? prisma.article.count({ where: { AND: [publicWhere, autoWhere(auto)] } }) : Promise.resolve(0))),
  ]);
  // Resolve names/media once for all sources, rather than repeating joins for every section.
  const summaries = new Map((await summarize([...new Map(sourceRows.flat().map((a) => [a.id, a])).values()])).map((a) => [a.id, a]));
  const automatic = new Map(sources.map((auto, i) => [sourceKey(auto), sourceRows[i].map((a) => summaries.get(a.id)!)]));
  const totals = new Map(sources.map((auto, i) => [sourceKey(auto), sourceTotals[i]]));
  const [featuredEvents, counts] = await Promise.all([
    summarizeEvents(featuredEventRows),
    has('sportsGrid')
      ? Promise.all([
          prisma.article.groupBy({ by: ['sportSlug'], where: await publishedArticleWhere(), _count: { _all: true } }),
          prisma.sportEvent.groupBy({ by: ['sportSlug'], where: visibleEventWhere(), _count: { _all: true } }),
        ])
      : Promise.resolve(null),
  ]);

  // Article sections resolve top to bottom so later automatic sections skip what is already shown.
  const shown = new Set<string>();
  const resolveArticles = (source: ArticleSource, count: number) => {
    const picked = source.mode === 'auto' ? [] : source.articleIds.map((id) => manual.get(id)).filter((a): a is ArticleSummary => !!a && !shown.has(a.id));
    let fill: ArticleSummary[] = [];
    if (source.mode !== 'manual' && picked.length < count) {
      const exclude = [...shown, ...picked.map((a) => a.id)];
      fill = (automatic.get(sourceKey(source.auto)) ?? []).filter((a) => !exclude.includes(a.id)).slice(0, count - picked.length);
    } else if (source.mode === 'manual' && picked.length < source.articleIds.length) {
      // Manual slot whose article went away: fall back to the automatic source rather than a gap.
      const exclude = [...shown, ...picked.map((a) => a.id)];
      fill = (automatic.get(sourceKey(source.auto)) ?? []).filter((a) => !exclude.includes(a.id)).slice(0, Math.max(0, Math.min(count, source.articleIds.length) - picked.length));
    }
    const articles = [...picked, ...fill].slice(0, count);
    articles.forEach((a) => shown.add(a.id));
    return articles;
  };

  const sportName = new Map(sportRows.map((s) => [s.slug, s.name]));
  const out: ResolvedSection[] = [];
  for (const s of sections) {
    switch (s.type) {
      case 'intro': {
        // Upgrade only untouched legacy defaults at render time. This also
        // works when old article selections prevent republishing the document;
        // manual wording, drafts and article selections remain intact.
        const section = {
          ...s,
          title: s.title === LEGACY_HOMEPAGE_INTRO.title ? HOMEPAGE_H1 : s.title,
          text: s.text === LEGACY_HOMEPAGE_INTRO.text ? HOMEPAGE_INTRO : s.text,
          secondaryCta: s.secondaryCta?.label === LEGACY_HOMEPAGE_INTRO.secondaryCtaLabel ? { ...s.secondaryCta, label: 'Browse All Sports' } : s.secondaryCta,
        };
        out.push({ id: s.id, type: s.type, section, image: s.appearance?.mediaId ? introImages.get(s.appearance.mediaId) ?? null : null }); break;
      }
      case 'adSlot': out.push({ id: s.id, type: s.type, slot: s.slot }); break;
      case 'featured': case 'articles': {
        const articles = resolveArticles(s.source, s.count);
        if (articles.length) out.push({ id: s.id, type: s.type, section: s, articles, total: s.type === 'articles' && s.moreLink ? totals.get(sourceKey(s.source.auto)) ?? 0 : 0 });
        break;
      }
      case 'featuredEvents': { const events = featuredEvents.slice(0, s.count); if (events.length) out.push({ id: s.id, type: s.type, section: s, events }); break; }
      case 'sportsGrid': {
        const [a, e] = counts!;
        const ac = new Map<string, number>(a.map((c) => [c.sportSlug, Number(c._count._all)])), ec = new Map<string, number>(e.map((c) => [c.sportSlug, Number(c._count._all)]));
        if (sportRows.length) out.push({ id: s.id, type: s.type, section: s, sports: sportRows.map((r) => ({ ...toSport(r), articleCount: ac.get(r.slug) || 0, eventCount: ec.get(r.slug) || 0 })) });
        break;
      }
      case 'upcomingEditions': {
        const editions = upcomingRows.slice(0, s.count).map((ed) => ({ ...toEdition(ed), sportName: sportName.get(ed.sportSlug) || ed.sportSlug, url: editionPath(ed.sportSlug, ed.eventSlug, ed.year) }));
        if (editions.length) out.push({ id: s.id, type: s.type, section: s, editions });
        break;
      }
      case 'block': { const block = layout.blocks.find((b) => b.id === s.blockId && b.placements.includes('homepage')); if (block) out.push({ id: s.id, type: 'block', block }); break; }
    }
  }
  return out;
}
