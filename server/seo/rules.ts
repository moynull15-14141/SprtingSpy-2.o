/**
 * SEO rule registry (PHASE D, Spec v1.1 §14 "SEO Rules Engine").
 *
 * Each rule: what it checks (code, below) + defaults for everything an
 * editor may change at runtime through the SeoRule table (enabled, severity,
 * applicable article types, thresholds and term lists). A rule reports
 * concrete issues — what is wrong and what to change — never a score.
 */

import type { SeoContext, ArticleSubject } from './context';
import { containsAny, extractDates, mentionsDates, TIME_RE, wordCount } from './analyze';
import { headingWarnings } from '../../src/lib/richText';
import { canonicalPagePath } from '../../src/config/urls';

export type Severity = 'blocking' | 'warning' | 'info';
export const SEVERITIES: Severity[] = ['blocking', 'warning', 'info'];
export type Category =
  | 'technical' | 'on-page' | 'content' | 'internal-links' | 'external-links' | 'structured-data'
  | 'image-seo' | 'ai-readiness' | 'freshness' | 'event-seo' | 'redirects' | 'search-appearance';

export interface Issue { message: string; fix?: string }

type Ctx = SeoContext;
type EditionRow = Ctx['editionList'][number];
type EventRow = Ctx['eventList'][number];
type SportRow = Ctx['sportList'][number];
type MediaRow = Ctx['mediaList'][number];
type RedirectRow = Ctx['site']['redirects'][number];

interface Targets { article: ArticleSubject; edition: EditionRow; event: EventRow; sport: SportRow; media: MediaRow; redirect: RedirectRow; site: null }
export type TargetType = keyof Targets;

export interface RuleDef<T extends TargetType = TargetType> {
  key: string;
  name: string;
  /** Why it matters (shown with every finding). */
  why: string;
  /** What to change (default; an issue may be more specific). */
  fix: string;
  category: Category;
  target: T;
  severity: Severity;
  /** Article rules only: types it applies to by default ([] = all). */
  articleTypes?: string[];
  config: Record<string, unknown>;
  check: (subject: Targets[T], ctx: Ctx, config: any) => Issue[];
}

const rule = <T extends TargetType>(def: RuleDef<T>) => def as unknown as RuleDef;
const issue = (message: string, fix?: string): Issue[] => [{ message, fix }];
const DAY = 86_400_000;
const lastContentChange = (s: ArticleSubject) => (s.updatedAt && s.updatedAt > s.publishedAt ? s.updatedAt : s.publishedAt);
const lastReviewedOrChanged = (s: ArticleSubject) => (s.reviewedAt && s.reviewedAt > lastContentChange(s) ? s.reviewedAt : lastContentChange(s));
const editionOf = (s: ArticleSubject, ctx: Ctx) => (s.eventSlug && s.editionYear ? ctx.editions.get(`${s.sportSlug}/${s.eventSlug}/${s.editionYear}`) : undefined);
const eventOf = (s: ArticleSubject, ctx: Ctx) => (s.eventSlug ? ctx.events.get(`${s.sportSlug}/${s.eventSlug}`) : undefined);
const isInternal = (href: string, origin: string) => {
  try { return new URL(href, origin).origin === origin; } catch { return false; }
};
const internalPath = (href: string, origin: string) => new URL(href, origin).pathname;
const hostOf = (url?: string | null) => { try { return url ? new URL(url).hostname.replace(/^www\./, '') : null; } catch { return null; } };

const EVENT_TYPES = ['Event Guide', 'Schedule', 'Results', 'How to Watch', 'Preview', 'Past Winners', 'Prize Money', 'Players', 'Teams', 'Venue', 'Qualification'];
const EDITION_TYPES = ['Schedule', 'Results', 'How to Watch', 'Preview', 'Prize Money', 'Players', 'Teams', 'Qualification'];
const TIME_SENSITIVE = ['Schedule', 'How to Watch', 'Prize Money', 'Players', 'Teams', 'Venue', 'Qualification', 'Preview'];

export const RULES: RuleDef[] = [
  // ── On-page ──
  rule({
    key: 'title-length', name: 'Title length', category: 'on-page', target: 'article', severity: 'warning', config: { min: 30, max: 65 },
    why: 'Search results show roughly 50–65 characters; very short titles under-describe the page and long ones are truncated.',
    fix: 'Adjust the SEO title (or headline) to fit the recommended length.',
    check: (s, _c, cfg) => {
      const t = (s.seo.metaTitle || s.title).trim();
      if (!t) return issue('The article has no title.', 'Add a descriptive headline.');
      if (t.length < cfg.min) return issue(`Title is ${t.length} characters (minimum ${cfg.min}).`);
      if (t.length > cfg.max) return issue(`Title is ${t.length} characters (maximum ${cfg.max}); it will be truncated in results.`);
      return [];
    },
  }),
  rule({
    key: 'meta-description', name: 'Meta description', category: 'on-page', target: 'article', severity: 'warning', config: { min: 70, max: 160 },
    why: 'The description is often used as the search snippet; missing or poorly sized descriptions reduce click-through.',
    fix: 'Write a specific 70–160 character meta description (or excerpt) that answers what the page covers.',
    check: (s, _c, cfg) => {
      const d = (s.seo.metaDescription || s.excerpt).trim();
      if (!d) return issue('No meta description or excerpt.');
      if (d.length < cfg.min) return issue(`Meta description is ${d.length} characters (minimum ${cfg.min}).`);
      if (d.length > cfg.max) return issue(`Meta description is ${d.length} characters (maximum ${cfg.max}).`);
      return [];
    },
  }),
  rule({
    key: 'duplicate-title', name: 'Duplicate titles & descriptions', category: 'search-appearance', target: 'article', severity: 'warning', config: {},
    why: 'Pages sharing a title or description compete with each other and look identical in results.',
    fix: 'Make the title and description unique to this article.',
    check: (s, ctx) => {
      if (s.status !== 'published') return [];
      const out: Issue[] = [];
      if ((ctx.titleCounts.get((s.seo.metaTitle || s.title).trim().toLowerCase()) || 0) > 1) out.push({ message: 'Another published article uses the same title.' });
      const d = (s.seo.metaDescription || s.excerpt).trim().toLowerCase();
      if (d && (ctx.descriptionCounts.get(d) || 0) > 1) out.push({ message: 'Another published article uses the same meta description.' });
      return out;
    },
  }),
  rule({
    key: 'slug-quality', name: 'URL slug', category: 'technical', target: 'article', severity: 'info', config: { maxLength: 80 },
    why: 'Short, descriptive, stable URLs are easier to share and understand (Spec §10).',
    fix: 'Use a shorter descriptive slug. Changing a published slug creates a 301 automatically.',
    check: (s, _c, cfg) => (s.slug.length > cfg.maxLength ? issue(`Slug is ${s.slug.length} characters (maximum ${cfg.maxLength}).`) : []),
  }),

  // ── Technical ──
  rule({
    key: 'relationships', name: 'Sport / Event / Edition connected', category: 'technical', target: 'article', severity: 'blocking',
    config: { requireEvent: EVENT_TYPES, requireEdition: EDITION_TYPES },
    why: 'Event and edition links drive the URL, breadcrumbs, related content and structured data (Spec §4, §12).',
    fix: 'Select the Event and Edition this article belongs to.',
    check: (s, ctx, cfg) => {
      const out: Issue[] = [];
      if (!ctx.sports.get(s.sportSlug)) out.push({ message: `Sport "${s.sportSlug}" does not exist.` });
      if ((cfg.requireEvent as string[]).includes(s.articleType) && !s.eventSlug) out.push({ message: `${s.articleType} articles should be connected to an Event.` });
      else if ((cfg.requireEdition as string[]).includes(s.articleType) && !s.editionYear) out.push({ message: `${s.articleType} articles should be connected to an Edition (year).` });
      if (s.eventSlug && !eventOf(s, ctx)) out.push({ message: `Event "${s.eventSlug}" does not exist.` });
      if (s.editionYear && !editionOf(s, ctx)) out.push({ message: `Edition ${s.editionYear} does not exist for this event.` });
      return out;
    },
  }),
  rule({
    key: 'canonical-override', name: 'Canonical override', category: 'technical', target: 'article', severity: 'blocking', config: {},
    why: 'A canonical pointing to a redirect, a 404 or another host tells search engines to drop this page (Spec §18).',
    fix: 'Clear the canonical override (pages are self-canonical by default) or point it to a live URL on this site.',
    check: (s, ctx) => {
      const c = s.seo.canonicalUrl;
      if (!c) return [];
      let url: URL;
      try { url = new URL(c, ctx.origin); } catch { return issue(`Canonical override "${c}" is not a valid URL.`); }
      if (url.origin !== ctx.origin) return issue(`Canonical override points to another host (${url.origin}).`);
      if (ctx.site.redirectFor(url.pathname)) return issue(`Canonical override ${url.pathname} is a redirected URL.`);
      if (!ctx.site.resolve(url.pathname)) return issue(`Canonical override ${url.pathname} does not resolve to a page (404).`);
      if (canonicalPagePath(url.pathname) !== s.path) return issue(`Canonical points to ${url.pathname}, so this URL is treated as a duplicate and kept out of the sitemap.`, 'Only keep this if the article is intentionally a duplicate.');
      return [];
    },
  }),
  rule({
    key: 'published-noindex', name: 'Published but noindex', category: 'technical', target: 'article', severity: 'info', config: {},
    why: 'A noindex article is public but cannot appear in search results.',
    fix: 'Remove the noindex flag unless the page should stay out of search.',
    check: (s) => (s.status === 'published' && s.seo.noIndex ? issue('This published article is set to noindex.') : []),
  }),

  // ── Content ──
  rule({
    key: 'min-words', name: 'Substantive content', category: 'content', target: 'article', severity: 'warning',
    config: { default: 250, byType: { News: 150, Update: 120, Results: 150, 'How to Watch': 250, Schedule: 200 } },
    why: 'Thin pages rarely satisfy searchers (Spec §36: no thin pages for SEO).',
    fix: 'Add useful detail readers need for this article type.',
    check: (s, _c, cfg) => {
      const min = Number(cfg.byType?.[s.articleType] ?? cfg.default);
      return s.a.words < min ? issue(`Body has ${s.a.words} words (at least ${min} expected for ${s.articleType}).`) : [];
    },
  }),
  rule({
    key: 'type-topics', name: 'Article-type essentials', category: 'content', target: 'article', severity: 'warning',
    config: {
      byType: {
        'How to Watch': [
          { label: 'broadcaster / TV channel', terms: ['broadcaster', 'broadcast', 'tv', 'channel', 'television'] },
          { label: 'official streaming option', terms: ['stream', 'streaming', 'live stream', 'app'] },
          { label: 'regional availability', terms: ['uk', 'us', 'usa', 'australia', 'canada', 'india', 'europe', 'region', 'country', 'countries'] },
          { label: 'viewing time / timezone', terms: ['bst', 'gmt', 'utc', 'cet', 'cest', 'et', 'pt', 'aest', 'ist', 'local time', 'time zone', 'timezone'] },
        ],
        Schedule: [
          { label: 'sessions / rounds / fixtures', terms: ['round', 'session', 'fixture', 'match', 'final', 'semifinal', 'quarterfinal', 'qualifying', 'practice', 'race', 'heat', 'day'] },
          { label: 'timezone for times', terms: ['bst', 'gmt', 'utc', 'cet', 'cest', 'et', 'pt', 'aest', 'ist', 'local time', 'time zone', 'timezone'] },
        ],
        Results: [{ label: 'outcome (winner / score / result)', terms: ['won', 'win', 'winner', 'defeated', 'beat', 'score', 'result', 'champion', 'final'] }],
        'Prize Money': [
          { label: 'currency amounts', terms: ['€', '$', '£', 'eur', 'usd', 'gbp', 'million'] },
          { label: 'breakdown by round / position', terms: ['winner', 'runner-up', 'round', 'finalist', 'per round', 'breakdown', 'position'] },
        ],
        'Past Winners': [{ label: 'winners / champions', terms: ['winner', 'champion', 'won', 'title'] }],
        'Event Guide': [
          { label: 'dates', terms: ['date', 'dates', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'] },
          { label: 'venue / location', terms: ['venue', 'stadium', 'court', 'course', 'circuit', 'arena', 'ground', 'location'] },
          { label: 'format', terms: ['format', 'draw', 'round', 'stage', 'qualifying', 'rules'] },
        ],
        Qualification: [{ label: 'qualification criteria', terms: ['qualify', 'qualification', 'ranking', 'wildcard', 'criteria', 'entry'] }],
        Venue: [{ label: 'venue facts (capacity / location)', terms: ['capacity', 'located', 'address', 'seats', 'surface', 'built'] }],
      },
    },
    why: 'Each article type answers specific reader questions; missing essentials make the page incomplete (Spec §5, §14).',
    fix: 'Add a section covering the missing topic(s), if they apply to this event.',
    check: (s, _c, cfg) => {
      const groups = (cfg.byType?.[s.articleType] || []) as { label: string; terms: string[] }[];
      const text = `${s.title} ${s.excerpt} ${s.a.text}`;
      return groups.filter((g) => !containsAny(text, g.terms)).map((g) => ({ message: `No mention of ${g.label}.` }));
    },
  }),
  rule({
    key: 'dates-present', name: 'Dates stated', category: 'content', target: 'article', severity: 'warning',
    articleTypes: ['Schedule', 'Results', 'How to Watch', 'Event Guide', 'Preview'], config: {},
    why: 'Time-bound articles are only useful if readers can see the dates they refer to.',
    fix: 'State the relevant dates explicitly (e.g. "23 May 2027").',
    check: (s) => (mentionsDates(`${s.excerpt} ${s.a.text}`) ? [] : issue('No dates are mentioned.')),
  }),
  rule({
    key: 'timezone-for-times', name: 'Times have a timezone', category: 'content', target: 'article', severity: 'warning',
    config: { terms: ['bst', 'gmt', 'utc', 'cet', 'cest', 'et', 'edt', 'est', 'pt', 'pdt', 'aest', 'ist', 'local time', 'time zone', 'timezone'] },
    why: 'A kick-off or session time without a timezone is ambiguous for an international audience.',
    fix: 'Add the timezone next to times (e.g. "11:00 CEST / 10:00 BST").',
    check: (s, _c, cfg) => (TIME_RE.test(s.a.text) && !containsAny(s.a.text, cfg.terms) ? issue('Times are listed without a timezone.') : []),
  }),
  rule({
    key: 'conflicting-dates', name: 'Dates consistent with the edition', category: 'content', target: 'article', severity: 'warning', config: { toleranceDays: 120 },
    why: 'Dates far from the edition window are often copy-paste errors from another year.',
    fix: 'Check the flagged dates against the official schedule.',
    check: (s, ctx, cfg) => {
      const ed = editionOf(s, ctx);
      if (!ed) return [];
      const start = new Date(ed.startDate).getTime();
      const end = new Date(ed.endDate).getTime();
      if (Number.isNaN(start) || Number.isNaN(end)) return [];
      const far = extractDates(`${s.title} ${s.excerpt} ${s.a.text}`).filter((d) => d.date.getTime() < start - cfg.toleranceDays * DAY || d.date.getTime() > end + cfg.toleranceDays * DAY);
      const out = far.slice(0, 3).map((d) => ({ message: `"${d.raw}" is far outside the ${ed.year} edition (${ed.startDate} – ${ed.endDate}).` }));
      const titleYears = [...s.title.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => +m[0]);
      if (titleYears.length && !titleYears.includes(ed.year)) out.push({ message: `Title mentions ${titleYears.join(', ')} but the article belongs to the ${ed.year} edition.` });
      return out;
    },
  }),
  rule({
    key: 'heading-structure', name: 'Heading structure', category: 'content', target: 'article', severity: 'warning', config: { wordsWithoutHeading: 400 },
    why: 'Headings give the page a scannable structure that readers and search engines use to understand sections.',
    fix: 'Use H2 for main sections, H3/H4 inside them, without skipping levels.',
    check: (s, _c, cfg) => {
      const out = headingWarnings(s.doc).map((w) => ({ message: w }));
      if (s.a.words > cfg.wordsWithoutHeading && !s.a.headings.length) out.push({ message: `${s.a.words} words with no section headings.` });
      return out;
    },
  }),

  // ── External links ──
  rule({
    key: 'official-source', name: 'Official source cited', category: 'external-links', target: 'article', severity: 'warning',
    articleTypes: ['Schedule', 'Results', 'How to Watch', 'Prize Money', 'Qualification', 'Players', 'Past Winners'], config: {},
    why: 'Time-sensitive facts should point readers to the primary source (Spec §13).',
    fix: 'Add the official event/organiser link in the body or in Sources & References.',
    check: (s, ctx) => {
      if (s.references.length) return [];
      const official = [hostOf(editionOf(s, ctx)?.officialSourceUrl), hostOf(eventOf(s, ctx)?.officialSourceUrl)].filter(Boolean);
      const external = s.a.links.filter((l) => !isInternal(l.href, ctx.origin) && !l.href.startsWith('mailto:'));
      if (official.length ? external.some((l) => official.includes(hostOf(l.href))) : external.length > 0) return [];
      return issue(official.length ? `No link to the official source (${official.join(', ')}).` : 'No external source is cited.');
    },
  }),
  rule({
    key: 'external-link-hygiene', name: 'External link hygiene', category: 'external-links', target: 'article', severity: 'warning', config: {},
    why: 'Insecure or empty links hurt trust; absolute links to this site bypass the canonical URL policy.',
    fix: 'Use https links with descriptive anchor text; link to this site with relative paths.',
    check: (s, ctx) => {
      const out: Issue[] = [];
      for (const l of s.a.links) {
        if (l.href.startsWith('http://')) out.push({ message: `Insecure http link: ${l.href}` });
        if (!l.text.trim()) out.push({ message: `Link with no anchor text: ${l.href}` });
        else if (/^(click here|here|read more|link)$/i.test(l.text.trim())) out.push({ message: `Non-descriptive anchor text "${l.text.trim()}" (${l.href}).` });
        if (/^https?:/.test(l.href) && isInternal(l.href, ctx.origin)) out.push({ message: `Absolute link to this site: ${l.href}`, fix: 'Use the relative path instead.' });
      }
      return out;
    },
  }),

  // ── Internal links ──
  rule({
    key: 'broken-internal-links', name: 'Broken internal links', category: 'internal-links', target: 'article', severity: 'blocking', config: {},
    why: 'Links to missing pages send readers to a 404 and waste crawl budget (Spec §12).',
    fix: 'Update or remove the broken link.',
    check: (s, ctx) =>
      s.a.links
        .filter((l) => isInternal(l.href, ctx.origin) && !l.href.startsWith('mailto:'))
        .filter((l) => !ctx.site.resolve(internalPath(l.href, ctx.origin)) && !ctx.site.redirectFor(internalPath(l.href, ctx.origin)))
        .map((l) => ({ message: `Link "${l.text}" → ${l.href} is a 404.` })),
  }),
  rule({
    key: 'internal-link-redirect-hop', name: 'Links through redirects', category: 'internal-links', target: 'article', severity: 'warning', config: {},
    why: 'Linking to a redirected URL adds an unnecessary hop for every visit (Spec §12).',
    fix: 'Point the link directly at the final URL.',
    check: (s, ctx) =>
      s.a.links
        .filter((l) => isInternal(l.href, ctx.origin))
        .map((l) => ({ l, r: ctx.site.redirectFor(internalPath(l.href, ctx.origin)) }))
        .filter((x) => x.r)
        .map((x) => ({ message: `Link "${x.l.text}" → ${x.l.href} redirects to ${x.r!.targetUrl}/.`, fix: `Change the link to ${x.r!.targetUrl}/.` })),
  }),
  rule({
    key: 'internal-links-min', name: 'Internal linking', category: 'internal-links', target: 'article', severity: 'info', config: { min: 1 },
    why: 'Contextual links to the related event, edition and guides help readers and distribute relevance (Spec §12).',
    fix: 'Add links to related pages; see the suggestions in the article editor.',
    check: (s, ctx, cfg) => {
      const n = s.a.links.filter((l) => isInternal(l.href, ctx.origin)).length;
      return n < cfg.min ? issue(`${n} internal link(s) in the body (recommended at least ${cfg.min}).`) : [];
    },
  }),
  rule({
    key: 'orphan-article', name: 'Orphan article', category: 'internal-links', target: 'article', severity: 'warning', config: {},
    why: 'No other article links here, so it is only reachable through automatic listings (Spec §12 "detect orphan pages").',
    fix: 'Link to this article from related articles of the same edition, event or sport.',
    check: (s, ctx) => (s.status === 'published' && !(ctx.inbound.get(s.path) || 0) ? issue('No editorial links from other published articles point here.') : []),
  }),

  // ── Image SEO ──
  rule({
    key: 'featured-image', name: 'Featured image', category: 'image-seo', target: 'article', severity: 'warning', config: {},
    why: 'A library image provides responsive sizes, dimensions and alt text for the page, cards and social previews (Spec §16).',
    fix: 'Choose a featured image from the Media Library and give it alt text.',
    check: (s, ctx) => {
      if (!s.featuredMediaId) return issue(s.featuredImage ? 'Featured image is a plain URL, not a Media Library item.' : 'No featured image.');
      const m = ctx.media.get(s.featuredMediaId);
      if (!m) return issue('The featured image no longer exists in the Media Library.');
      const out: Issue[] = [];
      if (!m.altText.trim()) out.push({ message: `Featured image "${m.title}" has no alt text.` });
      if (m.copyrightReview === 'pending') out.push({ message: `Featured image "${m.title}" has not had its copyright/usage review.`, fix: 'Record the review in the Media Library.' });
      return out;
    },
  }),
  rule({
    key: 'body-image-alt', name: 'Inline image alt text', category: 'image-seo', target: 'article', severity: 'warning', config: {},
    why: 'Alt text describes images for screen readers and image search.',
    fix: 'Add alt text to the image in the editor or the Media Library.',
    check: (s, ctx) => s.a.images.filter((i) => !(i.alt || ctx.media.get(i.mediaId)?.altText || '').trim()).map((i) => ({ message: `Inline image ${i.mediaId} has no alt text.` })),
  }),
  rule({
    key: 'media-quality', name: 'Media alt text & optimisation', category: 'image-seo', target: 'media', severity: 'info', config: {},
    why: 'Images used on the site need alt text and optimised responsive sizes (Spec §16).',
    fix: 'Add alt text; re-upload URL-only images so they are processed.',
    check: (m) => {
      const out: Issue[] = [];
      if (!m.altText.trim()) out.push({ message: 'No alt text.' });
      if (!m.storageKey) out.push({ message: 'URL-only image: no optimised AVIF/WebP sizes.' });
      return out;
    },
  }),

  // ── Structured data ──
  rule({
    key: 'article-schema', name: 'Article structured data', category: 'structured-data', target: 'article', severity: 'warning', config: { maxHeadline: 110 },
    why: 'Article/NewsArticle markup needs a headline, image, author and dates to be eligible for rich results (Spec §15).',
    fix: 'Fill in the missing fields listed.',
    check: (s, ctx, cfg) => {
      const out: Issue[] = [];
      if (s.title.length > cfg.maxHeadline) out.push({ message: `Headline is ${s.title.length} characters; structured data headlines should be ≤ ${cfg.maxHeadline}.` });
      if (!s.featuredImage) out.push({ message: 'No image for the Article markup.' });
      if (!s.authorId) out.push({ message: 'No author for the Article markup.' });
      if (s.status === 'published' && s.publishedAt > ctx.now) out.push({ message: 'datePublished is in the future.' });
      return out;
    },
  }),
  rule({
    key: 'edition-schema', name: 'SportsEvent structured data', category: 'structured-data', target: 'edition', severity: 'blocking', config: {},
    why: 'Edition pages emit SportsEvent markup; invalid dates or a missing location make it invalid (Spec §15).',
    fix: 'Correct the edition dates (YYYY-MM-DD) and venue/location.',
    check: (ed) => {
      const out: Issue[] = [];
      const iso = /^\d{4}-\d{2}-\d{2}$/;
      if (!iso.test(ed.startDate) || Number.isNaN(Date.parse(ed.startDate))) out.push({ message: `Start date "${ed.startDate}" is not a valid date.` });
      if (!iso.test(ed.endDate) || Number.isNaN(Date.parse(ed.endDate))) out.push({ message: `End date "${ed.endDate}" is not a valid date.` });
      if (!out.length && ed.endDate < ed.startDate) out.push({ message: 'End date is before the start date.' });
      if (!ed.venue.trim() || !ed.location.trim()) out.push({ message: 'Venue or location is missing.' });
      return out;
    },
  }),
  rule({
    key: 'event-official-source', name: 'Event official source', category: 'external-links', target: 'event', severity: 'info', config: {},
    why: 'The event page shows the official source to readers (Spec §7.3).',
    fix: 'Add the official website in the event settings.',
    check: (e) => (e.isVisible && !e.officialSourceUrl ? issue('No official website/source is set for this event.') : []),
  }),

  // ── AI Search Readiness (editorial checks; no ranking claims) ──
  rule({
    key: 'ai-answer-first', name: 'Answer clarity', category: 'ai-readiness', target: 'article', severity: 'info', config: { maxWords: 70 },
    why: 'A short opening that directly states the key facts is easier for readers and answer engines to use.',
    fix: 'Open with one or two sentences that answer the main question (who/what/when/where).',
    check: (s, ctx, cfg) => {
      const first = s.excerpt || s.a.paragraphs[0] || '';
      if (!first) return issue('There is no opening summary.');
      const out: Issue[] = [];
      if (wordCount(first) > cfg.maxWords) out.push({ message: `The opening is ${wordCount(first)} words (aim for ≤ ${cfg.maxWords}).` });
      const ev = eventOf(s, ctx);
      const names = [ev?.name, ev?.shortName, ctx.sports.get(s.sportSlug)?.name].filter(Boolean) as string[];
      if (names.length && !containsAny(first, names)) out.push({ message: `The opening does not name the subject (${names.join(' / ')}).` });
      return out;
    },
  }),
  rule({
    key: 'ai-entities', name: 'Entity coverage', category: 'ai-readiness', target: 'article', severity: 'info', config: {},
    why: 'Naming the sport, event, edition year and venue explicitly makes the page unambiguous.',
    fix: 'Mention the missing entities in the text where natural.',
    check: (s, ctx) => {
      const text = `${s.title} ${s.excerpt} ${s.a.text}`;
      const out: Issue[] = [];
      const ev = eventOf(s, ctx);
      const ed = editionOf(s, ctx);
      if (ev && !containsAny(text, [ev.name, ev.shortName])) out.push({ message: `The event (${ev.name}) is not named.` });
      if (ed && !text.includes(String(ed.year))) out.push({ message: `The edition year (${ed.year}) is not stated.` });
      if (ed && ed.venue && !containsAny(text, [ed.venue, ed.location.split(',')[0]])) out.push({ message: `The venue (${ed.venue}) is not mentioned.` });
      return out;
    },
  }),
  rule({
    key: 'ai-structured-info', name: 'Structured information', category: 'ai-readiness', target: 'article', severity: 'info',
    articleTypes: ['Schedule', 'Results', 'Prize Money', 'Past Winners', 'Records', 'Players', 'Teams', 'Qualification', 'How to Watch'], config: {},
    why: 'Lists and tables present facts in a form that is easy to scan and extract.',
    fix: 'Present the key facts as a table or list.',
    check: (s) => (s.a.tables + s.a.lists + s.structuredTables === 0 ? issue('No table or list presents the key facts.') : []),
  }),
  rule({
    key: 'ai-sections', name: 'Topic completeness', category: 'ai-readiness', target: 'article', severity: 'info',
    articleTypes: ['Event Guide', 'Rules & Format', 'General Information', 'History', 'Analysis', 'Venue'], config: { minSections: 2 },
    why: 'Guides and explainers cover a topic completely when organised into clear sections.',
    fix: 'Organise the article into sections with H2/H3 headings.',
    check: (s, _c, cfg) => (s.a.headings.length < cfg.minSections ? issue(`${s.a.headings.length} section heading(s) (at least ${cfg.minSections} expected).`) : []),
  }),

  // ── Freshness (Spec §30) ──
  rule({
    key: 'time-sensitive-review', name: 'Time-sensitive content review', category: 'freshness', target: 'article', severity: 'warning',
    articleTypes: TIME_SENSITIVE, config: { maxAgeDays: 30, windowDays: 60 },
    why: 'Schedules, broadcasters, prize money, venues and participants change as an event approaches.',
    fix: 'Check the facts against the official source, update them, or mark the article as reviewed.',
    check: (s, ctx, cfg) => {
      const ed = editionOf(s, ctx);
      if (!ed || s.status !== 'published') return [];
      const start = Date.parse(ed.startDate);
      const end = Date.parse(ed.endDate);
      const now = ctx.now.getTime();
      const inWindow = now >= start - cfg.windowDays * DAY && now <= end + DAY;
      const age = Math.floor((now - lastReviewedOrChanged(s).getTime()) / DAY);
      return inWindow && age > cfg.maxAgeDays ? issue(`The ${ed.year} edition runs ${ed.startDate} – ${ed.endDate}; this article was last changed or reviewed ${age} days ago.`) : [];
    },
  }),
  rule({
    key: 'stale-content', name: 'Long unreviewed', category: 'freshness', target: 'article', severity: 'info', config: { maxAgeDays: 365 },
    why: 'Older articles may contain outdated facts.',
    fix: 'Review the article and update it or mark it as reviewed.',
    check: (s, ctx, cfg) => {
      if (s.status !== 'published') return [];
      const age = Math.floor((ctx.now.getTime() - lastReviewedOrChanged(s).getTime()) / DAY);
      return age > cfg.maxAgeDays ? issue(`Not changed or reviewed for ${age} days.`) : [];
    },
  }),
  rule({
    key: 'edition-status-dates', name: 'Edition status matches dates', category: 'freshness', target: 'edition', severity: 'warning', config: {},
    why: 'A wrong status (e.g. "upcoming" after the event ended) misleads readers.',
    fix: 'Update the edition status (upcoming / active / completed / archived).',
    check: (ed, ctx) => {
      const today = ctx.now.toISOString().slice(0, 10);
      if (ed.status === 'upcoming' && ed.startDate <= today) return issue(`Status is "upcoming" but the edition started on ${ed.startDate}.`);
      if (ed.status === 'active' && ed.endDate < today) return issue(`Status is "active" but the edition ended on ${ed.endDate}.`);
      if (ed.status === 'active' && ed.startDate > today) return issue(`Status is "active" but the edition starts on ${ed.startDate}.`);
      if (ed.status === 'completed' && ed.endDate >= today) return issue(`Status is "completed" but the edition ends on ${ed.endDate}.`);
      return [];
    },
  }),

  // ── Event SEO / coverage (suggestions only) ──
  rule({
    key: 'edition-coverage', name: 'Edition coverage', category: 'event-seo', target: 'edition', severity: 'info',
    config: {
      upcoming: ['Event Guide', 'Schedule', 'How to Watch', 'Prize Money', 'Players', 'Qualification'],
      active: ['Schedule', 'How to Watch', 'Results'],
      completed: ['Results'],
    },
    why: 'Readers look for the same set of information around every edition (Spec §30 coverage suggestions).',
    fix: 'Consider creating the missing article types. These are suggestions; nothing is created automatically.',
    check: (ed, ctx, cfg) => {
      const expected = (cfg[ed.status] || []) as string[];
      const have = new Set(ctx.published.filter((a) => a.sportSlug === ed.sportSlug && a.eventSlug === ed.eventSlug && a.editionYear === ed.year).map((a) => a.articleType));
      const missing = expected.filter((t) => !have.has(t));
      return missing.length ? issue(`No published ${missing.join(', ')} article for ${ed.title}.`) : [];
    },
  }),
  rule({
    key: 'event-coverage', name: 'Event coverage', category: 'event-seo', target: 'event', severity: 'info', config: { expected: ['Past Winners', 'Venue', 'History'] },
    why: 'Evergreen event pages (past winners, venue, history) serve readers across all editions.',
    fix: 'Consider creating the missing evergreen articles (suggestion only).',
    check: (e, ctx, cfg) => {
      if (!e.isVisible) return [];
      const have = new Set(ctx.published.filter((a) => a.sportSlug === e.sportSlug && a.eventSlug === e.slug).map((a) => a.articleType));
      const missing = (cfg.expected as string[]).filter((t) => !have.has(t));
      return missing.length ? issue(`No published ${missing.join(', ')} article for ${e.name}.`) : [];
    },
  }),

  // ── Redirects (Spec §18 "detect chains and broken redirects") ──
  rule({
    key: 'redirect-health', name: 'Redirect health', category: 'redirects', target: 'redirect', severity: 'blocking', config: {},
    why: 'Chains, loops and redirects to missing pages waste crawl budget and break visits.',
    fix: 'Point the redirect directly at a live final URL, or deactivate it.',
    check: (r, ctx) => {
      const out: Issue[] = [];
      const target = r.targetUrl;
      if (target.startsWith('/')) {
        const next = ctx.site.redirectFor(target);
        if (next) out.push({ message: `Chain: ${r.sourceUrl} → ${target} → ${next.targetUrl}.`, fix: `Change the target to ${next.targetUrl}.` });
        else if (!ctx.site.resolve(target)) out.push({ message: `Target ${target} does not resolve to a page (404).` });
      }
      const shadowed = ctx.site.resolve(r.sourceUrl);
      if (shadowed && !shadowed.status.indexable && (shadowed.status as { reason: string }).reason.includes('active redirect')) {
        out.push({ message: `A live page exists at ${r.sourceUrl}/ but this redirect hides it.`, fix: 'Deactivate the redirect if the page should be reachable.' });
      }
      return out;
    },
  }),

  // ── Site configuration (Spec §19, §28) ──
  rule({
    key: 'search-engine-setup', name: 'Search engine setup', category: 'technical', target: 'site', severity: 'info', config: {},
    why: 'Verification and IndexNow let Google and Bing monitor and discover the site (Spec §19).',
    fix: 'Add the tokens in Settings → Search engine verification / IndexNow.',
    check: (_s, ctx) => {
      const out: Issue[] = [];
      if (!ctx.settings.googleSiteVerification) out.push({ message: 'Google Search Console verification token is not set.' });
      if (!ctx.settings.bingSiteVerification) out.push({ message: 'Bing Webmaster Tools verification token is not set.' });
      if (!ctx.settings.indexNowKey) out.push({ message: 'IndexNow is not configured.' });
      return out;
    },
  }),
];

export const RULES_BY_KEY = new Map(RULES.map((r) => [r.key, r]));
