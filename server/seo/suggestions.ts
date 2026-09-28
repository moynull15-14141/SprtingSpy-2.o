/**
 * Editor suggestions (PHASE D, Spec v1.1 §12, §14 "AI Content Assistant").
 * Deterministic, explainable suggestions computed from real site data.
 * Suggestions only: nothing here writes to the database or the article.
 */

import type { ArticleSubject, SeoContext } from './context';
import { editionPath, eventPath, sportPath } from '../../src/lib/paths';

const STOPWORDS = new Set('the a an and or of to in on for at by with from is are was were be this that it its as how what when where who your our their 2024 2025 2026 2027 2028 guide full complete official'.split(' '));
const terms = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w)));

export interface LinkSuggestion {
  url: string;
  title: string;
  priority: number;
  reason: string;
  anchor: string;
  mentioned: boolean;
}

/** Internal link suggestions, ranked: same edition → same event → same sport → topic similarity → freshness. */
export function internalLinkSuggestions(s: ArticleSubject, ctx: SeoContext, limit = 8): LinkSuggestion[] {
  const linked = new Set(
    s.a.links.map((l) => {
      try { const u = new URL(l.href, ctx.origin); return u.origin === ctx.origin ? ctx.site.resolve(u.pathname)?.path : null; } catch { return null; }
    }).filter(Boolean) as string[]
  );
  const text = `${s.title} ${s.excerpt} ${s.a.text}`.toLowerCase();
  const own = terms(`${s.title} ${s.excerpt}`);
  const out: LinkSuggestion[] = [];
  const push = (x: Omit<LinkSuggestion, 'mentioned'> & { mentionTerms?: string[] }) => {
    if (x.url === s.path || linked.has(x.url) || out.some((o) => o.url === x.url)) return;
    const page = ctx.site.resolve(x.url);
    if (!page || !page.status.indexable) return; // only live, indexable pages
    const mentioned = (x.mentionTerms || []).some((t) => t && text.includes(t.toLowerCase()));
    out.push({ url: x.url, title: x.title, priority: x.priority, reason: x.reason + (mentioned ? ' — already mentioned in the text' : ''), anchor: x.anchor, mentioned });
  };

  const event = s.eventSlug ? ctx.events.get(`${s.sportSlug}/${s.eventSlug}`) : undefined;
  const edition = s.eventSlug && s.editionYear ? ctx.editions.get(`${s.sportSlug}/${s.eventSlug}/${s.editionYear}`) : undefined;
  const sport = ctx.sports.get(s.sportSlug);
  if (edition) push({ url: editionPath(edition.sportSlug, edition.eventSlug, edition.year), title: edition.title, priority: 1, reason: 'This article’s edition page', anchor: edition.title, mentionTerms: [edition.title] });
  if (event) push({ url: eventPath(event.sportSlug, event.slug), title: event.name, priority: 2, reason: 'This article’s event page', anchor: event.name, mentionTerms: [event.name, event.shortName] });

  const candidates = ctx.published
    .filter((o) => o.id !== s.id)
    .map((o) => {
      const sameEdition = !!s.editionYear && o.eventSlug === s.eventSlug && o.editionYear === s.editionYear && o.sportSlug === s.sportSlug;
      const sameEvent = !!s.eventSlug && o.eventSlug === s.eventSlug && o.sportSlug === s.sportSlug;
      const sameSport = o.sportSlug === s.sportSlug;
      const shared = [...terms(`${o.title} ${o.excerpt}`)].filter((w) => own.has(w));
      const priority = sameEdition ? 1 : sameEvent ? 2 : sameSport ? 3 : shared.length >= 2 ? 4 : 99;
      const reason = sameEdition ? `Same edition (${o.articleType})` : sameEvent ? `Same event (${o.articleType})` : sameSport ? `Same sport (${o.articleType})` : `Related topic: ${shared.slice(0, 3).join(', ')}`;
      return { o, priority, reason, shared: shared.length };
    })
    .filter((c) => c.priority < 99)
    .sort((a, b) => a.priority - b.priority || b.shared - a.shared || b.o.publishedAt.getTime() - a.o.publishedAt.getTime());
  for (const c of candidates) push({ url: c.o.path, title: c.o.title, priority: c.priority, reason: c.reason, anchor: c.o.title, mentionTerms: [c.o.title] });

  if (sport) push({ url: sportPath(sport.slug), title: sport.name, priority: 3, reason: 'This article’s sport hub', anchor: `${sport.name} coverage`, mentionTerms: [] });

  // Mentioned-but-not-linked first within the same priority.
  return out.sort((a, b) => a.priority - b.priority || Number(b.mentioned) - Number(a.mentioned)).slice(0, limit);
}

/** Official sources known for this article's event/edition that the article does not cite yet. */
export function externalSourceSuggestions(s: ArticleSubject, ctx: SeoContext) {
  const cited = new Set([...s.references.map((r) => r.url), ...s.a.links.map((l) => l.href)].map((u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }));
  const edition = s.eventSlug && s.editionYear ? ctx.editions.get(`${s.sportSlug}/${s.eventSlug}/${s.editionYear}`) : undefined;
  const event = s.eventSlug ? ctx.events.get(`${s.sportSlug}/${s.eventSlug}`) : undefined;
  const out: { url: string; label: string }[] = [];
  for (const [url, label] of [[edition?.officialSourceUrl, `${edition?.title} official source`], [event?.officialSourceUrl, `${event?.name} official website`]] as const) {
    if (!url) continue;
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { continue; }
    if (!cited.has(host) && !out.some((o) => o.url === url)) out.push({ url, label: label || url });
  }
  return out;
}

/** Article types readers usually expect for this edition/event that are not published yet. */
export function coverageGaps(s: ArticleSubject, ctx: SeoContext, expectedByStatus: Record<string, string[]>) {
  const edition = s.eventSlug && s.editionYear ? ctx.editions.get(`${s.sportSlug}/${s.eventSlug}/${s.editionYear}`) : undefined;
  if (!edition) return [];
  const have = new Set(ctx.published.filter((a) => a.sportSlug === s.sportSlug && a.eventSlug === s.eventSlug && a.editionYear === s.editionYear).map((a) => a.articleType));
  have.add(s.articleType);
  return (expectedByStatus[edition.status] || []).filter((t) => !have.has(t)).map((type) => ({ type, edition: edition.title }));
}
