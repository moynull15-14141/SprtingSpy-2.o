/**
 * Analytics payload sanitizing (PHASE F). Everything sent to an analytics
 * provider passes through here: only allow-listed, short, primitive values.
 */

import { normalizeQuery } from '../searchText';

const MAX_STRING = 100;
/** Query parameters that may appear in a reported page URL. Everything else (including the search text `q`) is dropped. */
const URL_PARAM_ALLOWLIST = new Set(['sport', 'type', 'date', 'sort', 'page', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']);
/** Pages that are never measured: staff CMS, previews, reader accounts. */
const PRIVATE_PATHS = [/^\/admin(\/|$)/, /^\/account(\/|$)/, /^\/api(\/|$)/];

export const isPrivatePath = (path: string) => PRIVATE_PATHS.some((re) => re.test(path));

/** Path plus allow-listed query parameters; no fragment, no search text. */
export function sanitizePath(url: string, origin = 'http://localhost'): string {
  let parsed: URL;
  try { parsed = new URL(url, origin); } catch { return '/'; }
  const kept = new URLSearchParams();
  parsed.searchParams.forEach((value, key) => {
    if (URL_PARAM_ALLOWLIST.has(key) && value.length <= 64) kept.append(key, value);
  });
  const qs = kept.toString();
  return `${parsed.pathname}${qs ? `?${qs}` : ''}`;
}

/**
 * Search text as reported to analytics: normalized, lower-cased and cut to
 * 50 characters. Text that looks personal (an e-mail address, or a long
 * digit run such as a phone or ID number) is replaced entirely.
 */
export function sanitizeSearchTerm(q: string): string {
  const term = normalizeQuery(q).toLowerCase().slice(0, 50);
  if (/@|\d[\d\s-]{5,}\d/.test(term)) return '(redacted)';
  return term;
}

export type Params = Record<string, string | number | boolean>;

/** Keeps only the allowed keys whose values are short strings, finite numbers or booleans. */
export function sanitizeParams(params: Record<string, unknown>, allowed: readonly string[]): Params {
  const out: Params = {};
  for (const key of allowed) {
    const value = params[key];
    if (typeof value === 'string') { const v = value.trim().slice(0, MAX_STRING); if (v) out[key] = v; }
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}
