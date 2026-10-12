/**
 * Mapping PROPOSALS for legacy WordPress posts (sport, article type, author).
 * Proposals only: every row carries its confidence, the reason, and the
 * decisions an Admin still has to make. Nothing here creates a Sport or an
 * Author profile, and a sport or type is only ever proposed when it exists in
 * the CMS snapshot the caller passes in. Pure: no database, no network.
 */
import type { WxrAuthor, WxrItem } from './wxr';

export interface CmsSnapshot {
  capturedAt: string;
  source: string;
  sports: { slug: string; visible?: boolean }[];
  events: { sportSlug: string; slug: string }[];
  /** Event editions verified to exist (a public edition page answers 200). */
  editions?: { sportSlug: string; eventSlug: string; year: number }[];
  /** Sports whose public hub page /{slug}/ is verified live. */
  sportPages?: string[];
  /** Public paths of CMS pages verified live ("/about"). */
  pages?: string[];
  articleTypes: { name: string; isActive?: boolean }[];
  authors: { slug: string }[];
  /** Public paths of existing articles ("/tennis/some-slug"), or null when not captured. */
  articlePaths: string[] | null;
}

export type Confidence = 'high' | 'medium' | 'low' | 'none';
export interface SportProposal { sportSlug: string | null; confidence: Confidence; rationale: string; newSportSuggestion: string | null; decisions: string[] }
export interface TypeProposal { articleType: string | null; confidence: Confidence; rationale: string }
export interface AuthorProposal { wordpressLogin: string; sourceName: string; authorSlug: string | null; proposedSlug: string; decision: string | null }

/** WordPress categories that are a sport already in the CMS under the same idea. */
export const CATEGORY_TO_SPORT: Record<string, string> = { athletics: 'athletics', basketball: 'basketball', boxing: 'boxing', cycling: 'cycling', football: 'football', golf: 'golf', hockey: 'hockey', nfl: 'nfl', rugby: 'rugby', tennis: 'tennis', 'net-ball': 'netball' };
/** Editorial labels, never a sport. */
const NON_SPORT_CATEGORIES = new Set(['latest-news', 'interview', 'video', 'uncategorized', 'other-sports']);

interface Detector { key: string; test: RegExp; existing: string | null; suggest: string | null; confidence: Confidence; why: string; decision?: string }
/** Checked in order against the title and slug; the first match wins. Content beats the WordPress category. */
const DETECTORS: Detector[] = [
  { key: 'triathlon', test: /\biron\s?man\b|\btriathlon\b/i, existing: null, suggest: 'triathlon', confidence: 'none', why: 'Triathlon / IRONMAN event. WordPress filed it under Athletics, but triathlon is its own sport and is not classified as athletics.', decision: 'Create a "triathlon" sport, or do not migrate.' },
  { key: 'australian-football', test: /\bafl\b|aussie rules|australian football/i, existing: null, suggest: 'australian-football', confidence: 'none', why: 'AFL is Australian rules football. WordPress filed it under NFL, which is a different sport; no existing sport fits.', decision: 'Create an "australian-football" sport, or choose another home for this post.' },
  { key: 'marathon', test: /\bmarathon\b/i, existing: 'athletics', suggest: null, confidence: 'high', why: 'Marathon (road running) is an athletics discipline; the CMS already keeps the Chicago Marathon under "athletics".' },
  { key: 'rodeo', test: /\brodeo\b|\bwnfr\b|\bjnfr\b|cowboy christmas/i, existing: null, suggest: 'rodeo', confidence: 'none', why: 'Rodeo event; no existing sport fits.', decision: 'Create a "rodeo" sport, or do not migrate.' },
  { key: 'horse-racing', test: /horse rac|melbourne cup|japan cup/i, existing: null, suggest: 'horse-racing', confidence: 'none', why: 'Horse racing; "motorsport" is the only racing sport in the CMS and does not fit.', decision: 'Create a "horse-racing" sport, or do not migrate.' },
  { key: 'curling', test: /\bcurling\b/i, existing: null, suggest: 'curling', confidence: 'none', why: 'Curling; no existing sport fits.', decision: 'Create a "curling" sport, or do not migrate.' },
  { key: 'netball', test: /\bnetball\b/i, existing: 'netball', suggest: null, confidence: 'high', why: 'Netball event; matches the existing "netball" sport (WordPress category "net-ball").' },
  { key: 'boxing', test: /\bfight\b|\bboxing\b|\bbout\b/i, existing: 'boxing', suggest: null, confidence: 'medium', why: 'Boxing fight (WordPress category "fight"); matches the existing "boxing" sport.', decision: 'Confirm "boxing" (the old "fight" category could also have held other combat sports).' },
  { key: 'ice-hockey', test: /ice hockey/i, existing: 'hockey', suggest: null, confidence: 'medium', why: 'Ice hockey; the CMS has one "hockey" sport.', decision: 'Confirm that "hockey" covers ice hockey.' },
];

export function proposeSport(post: WxrItem, cms: CmsSnapshot): SportProposal {
  const exists = (slug: string | null) => !!slug && cms.sports.some((s) => s.slug === slug);
  const haystack = `${post.title} ${post.slug.replace(/-/g, ' ')}`;
  const categories = post.categories.map((c) => c.slug);
  const sportCategories = categories.filter((c) => !NON_SPORT_CATEGORIES.has(c));
  const filed = `WordPress categories: ${categories.join(', ') || 'none'}.`;
  const hit = DETECTORS.find((d) => d.test.test(haystack));
  if (hit) {
    const existing = exists(hit.existing) ? hit.existing : null;
    const decisions = hit.decision ? [hit.decision] : [];
    if (hit.existing && !existing) decisions.push(`Sport "${hit.existing}" is not in the CMS snapshot.`);
    return { sportSlug: existing, confidence: existing ? hit.confidence : 'none', rationale: `${hit.why} ${filed}`, newSportSuggestion: hit.suggest, decisions };
  }
  const direct = [...new Set(sportCategories.map((c) => CATEGORY_TO_SPORT[c]).filter((s): s is string => exists(s)))];
  if (direct.length === 1) return { sportSlug: direct[0], confidence: 'high', rationale: `WordPress category matches the existing "${direct[0]}" sport. ${filed}`, newSportSuggestion: null, decisions: [] };
  if (direct.length > 1) return { sportSlug: null, confidence: 'none', rationale: `Several sport categories. ${filed}`, newSportSuggestion: null, decisions: [`Choose one sport: ${direct.join(' or ')}.`] };
  return { sportSlug: null, confidence: 'none', rationale: `No existing sport matches. ${filed}`, newSportSuggestion: sportCategories[0] ?? null, decisions: ['Choose an existing sport or approve a new one.'] };
}

/** Title signals for the existing Article Types, most specific first. */
const TYPE_RULES: { type: string; test: RegExp; confidence: Confidence; why: string }[] = [
  { type: 'Players', test: /rising stars|famous players|future legends|players to watch/i, confidence: 'medium', why: 'The title is about players.' },
  { type: 'How to Watch', test: /how to watch|guide to watch|way(s)? to watch|to watch\b|watching guide|viewing|viewers?[’' ]?s? guide|\btv\b|live stream|broadcast|international viewers/i, confidence: 'medium', why: 'The title promises viewing / TV / streaming information.' },
  { type: 'Schedule', test: /\bschedule\b|tee times|fixtures/i, confidence: 'medium', why: 'The title leads with the schedule.' },
  { type: 'Event Guide', test: /\bguide\b|key (details|info|overview)|important facts|need to know|venue|format/i, confidence: 'medium', why: 'The title is a general event guide.' },
];

export function proposeArticleType(post: WxrItem, cms: CmsSnapshot): TypeProposal {
  const usable = (name: string) => cms.articleTypes.some((t) => t.name === name && t.isActive !== false);
  const rule = TYPE_RULES.find((r) => r.test.test(post.title) && usable(r.type));
  if (rule) return { articleType: rule.type, confidence: rule.confidence, rationale: `${rule.why} Proposed from the title only; an editor confirms.` };
  if (usable('Event Guide')) return { articleType: 'Event Guide', confidence: 'low', rationale: 'No clear signal in the title; "Event Guide" is the CMS default. An editor confirms.' };
  return { articleType: null, confidence: 'none', rationale: 'No supported article type could be proposed.' };
}

export const slugify = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

/** The WordPress display name is kept as the source attribution; an Author profile is matched by slug only. */
export function proposeAuthor(login: string, authors: WxrAuthor[], cms: CmsSnapshot): AuthorProposal {
  const sourceName = authors.find((a) => a.login === login)?.displayName || login;
  const proposedSlug = slugify(sourceName);
  const match = cms.authors.find((a) => a.slug === proposedSlug);
  return {
    wordpressLogin: login, sourceName, authorSlug: match?.slug ?? null, proposedSlug,
    decision: match ? null : `No SportingSpy Author profile matches "${sourceName}". An Admin creates an unlinked profile (name "${sourceName}", slug "${proposedSlug}", no e-mail, no login) or chooses an existing profile.`,
  };
}

/** Existing CMS events a post is probably about. A hint only: the edition year must exist before an article can be attached. */
const EVENT_HINTS: { test: RegExp; event: string }[] = [
  { test: /roland garros|french open/i, event: 'tennis/french-open' },
  { test: /\bwimbledon\b/i, event: 'tennis/wimbledon' },
  { test: /masters golf|the masters\b/i, event: 'golf/the-masters' },
  { test: /chicago marathon/i, event: 'athletics/chicago-marathon' },
  { test: /six nations/i, event: 'rugby/six-nations' },
  { test: /monaco grand prix/i, event: 'motorsport/monaco-grand-prix' },
];
export function possibleEvent(post: WxrItem, cms: CmsSnapshot): string | null {
  const hint = EVENT_HINTS.find((h) => h.test.test(post.title));
  if (!hint) return null;
  const found = cms.events.find((e) => `${e.sportSlug}/${e.slug}`.startsWith(hint.event));
  return found ? `${found.sportSlug}/${found.slug}` : null;
}

/** Up to 30 keywords of at most 100 characters (the limits of seo.keywords): focus keyword first, then tag names. */
export function proposeKeywords(post: WxrItem): { keywords: string[]; dropped: number } {
  const seen = new Set<string>();
  const all = [...(post.meta.get('rank_math_focus_keyword') ?? '').split(','), ...post.tags.map((t) => t.name)].map((k) => k.trim()).filter((k) => k && k.length <= 100 && !seen.has(k.toLowerCase()) && !!seen.add(k.toLowerCase()));
  return { keywords: all.slice(0, 30), dropped: Math.max(0, all.length - 30) };
}

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'in', 'for', 'at', 'on', 'how', 'watch', 'guide', 'best', 'live', 'tv', 'schedule', 'your', 'you', 'with', 'is', 'vs']);
const titleTokens = (title: string) => new Set((title.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)));
/** Pairs of posts about the same subject (shared title words, years ignored): candidates for a merge decision. */
export function similarTitles(posts: WxrItem[], threshold = 0.6): { a: string; b: string; score: number }[] {
  const out: { a: string; b: string; score: number }[] = [];
  const tokens = posts.map((p) => titleTokens(p.title));
  for (let i = 0; i < posts.length; i++) for (let j = i + 1; j < posts.length; j++) {
    const shared = [...tokens[i]].filter((w) => tokens[j].has(w)).length;
    const score = shared / Math.max(1, Math.min(tokens[i].size, tokens[j].size));
    if (shared >= 3 && score >= threshold) out.push({ a: posts[i].id, b: posts[j].id, score: Math.round(score * 100) / 100 });
  }
  return out;
}
