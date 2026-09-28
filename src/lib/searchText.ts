/**
 * Search query text helpers (PHASE E), shared by the server search service
 * and the search UI so both agree on what a "term" is.
 */

export const SEARCH_MAX_QUERY = 100;
const MAX_TERMS = 8;

/** Trims, strips control characters, collapses whitespace and caps the length. */
export function normalizeQuery(q: string | undefined | null): string {
  return (q ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_QUERY);
}

/** Searchable words: letters of any script (incl. combining marks such as Bangla vowel signs) and digits. */
export function queryTerms(q: string): string[] {
  return (q.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).slice(0, MAX_TERMS);
}

export type HighlightPart = { text: string; match: boolean };

/**
 * Splits `text` into plain and matched parts for rendering as React text
 * nodes (never HTML). A word matches when it starts with a query term, which
 * mirrors the search's prefix matching (`crick` highlights "Cricket").
 */
export function highlightParts(text: string, q: string): HighlightPart[] {
  const terms = queryTerms(q).filter((t) => t.length >= 2).sort((a, b) => b.length - a.length);
  if (!terms.length || !text) return [{ text, match: false }];
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${escaped.join('|')})[\\p{L}\\p{M}\\p{N}]*`, 'giu');
  const parts: HighlightPart[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index! > last) parts.push({ text: text.slice(last, m.index), match: false });
    parts.push({ text: m[0], match: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}
