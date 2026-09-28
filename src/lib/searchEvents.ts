/**
 * Search analytics hooks (PHASE E; PHASE F routes them through the analytics
 * layer). The search UI reports what happened here; lib/analytics decides
 * whether anything is sent (consent + configured provider) and sanitizes it.
 *
 * Search text is reported normalized, lower-cased, cut to 50 characters, and
 * replaced by "(redacted)" when it looks like an e-mail address or a long
 * number. Result links are reported as site paths without query strings.
 * A search with no results is a `search` event with result_count 0.
 */

import { analytics } from './analytics';
import { sanitizePath, sanitizeSearchTerm } from './analytics/sanitize';

export type SearchEvent =
  | { type: 'search'; query: string; total: number; page: number; filters: Record<string, string>; sort?: string }
  | { type: 'search_result_click'; query: string; url: string; position: number }
  | { type: 'search_suggestion_click'; query: string; url: string };

const pathOnly = (url: string) => sanitizePath(url, location.origin).split('?')[0];

export function trackSearchEvent(event: SearchEvent): void {
  if (typeof window === 'undefined') return;
  const search_term = sanitizeSearchTerm(event.query);
  if (event.type === 'search') {
    analytics.track('search', {
      search_term, result_count: event.total, page: event.page, sort: event.sort,
      sport: event.filters.sport, category: event.filters.type, author: event.filters.author, date: event.filters.date || (event.filters.from || event.filters.to ? 'custom' : ''),
    });
  } else if (event.type === 'search_result_click') {
    analytics.track('search_result_click', { search_term, link_path: pathOnly(event.url), position: event.position });
  } else {
    analytics.track('search_suggestion_click', { search_term, link_path: pathOnly(event.url) });
  }
}
