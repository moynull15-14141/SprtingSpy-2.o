/**
 * Validation for search query parameters (PHASE E). One parser for the public
 * search page, the public search API and CMS article search, so every entry
 * point accepts exactly the same values and limits.
 *
 * Strict mode (APIs) reports the first invalid parameter; lenient mode
 * (server-rendered page) drops invalid values and continues with defaults.
 */

import { ARTICLE_TYPES } from '../../../src/types';
import { REVIEW_STATUSES } from '../../../src/lib/editorialWorkflow';
import { SEARCH_MAX_LIMIT, SEARCH_MAX_QUERY, normalizeQuery, type ArticleStatusFilter, type SearchSort } from './articleSearch';

export const DATE_RANGES = ['today', 'week', 'month', 'year'] as const;
export type DateRange = (typeof DATE_RANGES)[number];
export const SORTS: SearchSort[] = ['relevance', 'newest', 'oldest'];
const STATUSES: ArticleStatusFilter[] = ['draft', 'preview', 'scheduled', 'published', 'archived'];
const MAX_PAGE = 500;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ID = /^[A-Za-z0-9_-]{1,120}$/;

export interface SearchQuery {
  q: string;
  sport: string;
  type: string;
  author: string;
  date: DateRange | '';
  from?: Date;
  to?: Date;
  sort: SearchSort;
  page: number;
  limit: number;
  status: ArticleStatusFilter | '';
  publicOnly?: boolean;
  reviewStatus?: string;
  myDrafts?: boolean;
}

type Raw = Record<string, unknown>;
type Parsed = { ok: true; value: SearchQuery } | { ok: false; error: string; value?: undefined };

/** Start of the requested range (UTC), relative to `now`. */
export function dateRangeStart(range: DateRange, now = new Date()): Date {
  const startOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (range === 'today') return new Date(startOfDay);
  if (range === 'week') return new Date(startOfDay - 6 * 86400000);
  if (range === 'month') return new Date(startOfDay - 29 * 86400000);
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
}

const isoDay = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};

export function parseSearchQuery(raw: Raw, options: { strict: boolean; defaultLimit: number; allowStatus?: boolean }): Parsed {
  const value: SearchQuery = { q: '', sport: '', type: '', author: '', date: '', sort: 'relevance', page: 1, limit: options.defaultLimit, status: '' };
  const fail = (error: string): Parsed | null => (options.strict ? { ok: false, error } : null);

  for (const [key, input] of Object.entries(raw)) {
    if (input === undefined || input === '') continue;
    // Repeated or bracketed keys (?q=a&q=b, ?sport[]=x) arrive as arrays/objects.
    if (typeof input !== 'string') { const f = fail(`${key} must be a single value.`); if (f) return f; continue; }
    let error: string | null = null;
    switch (key) {
      case 'reviewStatus':
        if (options.allowStatus && (REVIEW_STATUSES as readonly string[]).includes(input)) value.reviewStatus = input;
        else error = 'reviewStatus must be an editorial review state and is available only in CMS search.';
        break;
      case 'myDrafts':
        if (options.allowStatus && ['true','false'].includes(input)) value.myDrafts = input === 'true';
        else error = 'myDrafts must be true or false and is available only in CMS search.';
        break;
      case 'q':
        if (input.length > SEARCH_MAX_QUERY * 2) error = `q must be at most ${SEARCH_MAX_QUERY} characters.`;
        else value.q = normalizeQuery(input);
        break;
      case 'sport':
        if (SLUG.test(input) && input.length <= 120) value.sport = input; else error = 'sport must be a sport slug.';
        break;
      case 'type':
        if ((ARTICLE_TYPES as readonly string[]).includes(input)) value.type = input; else error = 'type is not a known article type.';
        break;
      case 'author':
        if (SLUG.test(input) && input.length <= 120) value.author = input; else error = 'author must be an author slug.';
        break;
      case 'date':
        if ((DATE_RANGES as readonly string[]).includes(input)) value.date = input as DateRange; else error = `date must be one of ${DATE_RANGES.join(', ')}.`;
        break;
      case 'from':
      case 'to': {
        const day = isoDay(input);
        if (!day) error = `${key} must be a YYYY-MM-DD date.`;
        else if (key === 'from') value.from = day;
        else value.to = new Date(day.getTime() + 86400000); // inclusive end day
        break;
      }
      case 'sort':
        if ((SORTS as string[]).includes(input)) value.sort = input as SearchSort; else error = `sort must be one of ${SORTS.join(', ')}.`;
        break;
      case 'page':
        if (/^[1-9]\d{0,3}$/.test(input) && Number(input) <= MAX_PAGE) value.page = Number(input); else error = `page must be between 1 and ${MAX_PAGE}.`;
        break;
      case 'limit':
        if (/^[1-9]\d{0,2}$/.test(input) && Number(input) <= SEARCH_MAX_LIMIT) value.limit = Number(input); else error = `limit must be between 1 and ${SEARCH_MAX_LIMIT}.`;
        break;
      case 'status':
        if (options.allowStatus && (STATUSES as string[]).includes(input)) value.status = input as ArticleStatusFilter;
        else error = options.allowStatus ? `status must be one of ${STATUSES.join(', ')}.` : 'status is not a public search parameter.';
        break;
      case 'publicOnly':
        if (options.allowStatus && (input === 'true' || input === 'false')) value.publicOnly = input === 'true';
        else error = 'publicOnly must be true or false and is available only for CMS search.';
        break;
      case 'exclude':
        if (!ID.test(input)) error = 'exclude must be an article id.';
        break;
      default:
        // Unknown keys are ignored on the page (tracking params etc.) but rejected by the APIs.
        error = `Unknown search parameter: ${key}.`;
    }
    if (error) { const f = fail(error); if (f) return f; }
  }

  if (value.date && !value.from) value.from = dateRangeStart(value.date);
  if (value.from && value.to && value.from >= value.to) {
    const f = fail('from must be on or before to.');
    if (f) return f;
    value.from = undefined; value.to = undefined; value.date = '';
  }
  return { ok: true, value };
}

export const idParam = (value: unknown) => (typeof value === 'string' && ID.test(value) ? value : undefined);
