/**
 * SportingSpy Server Input Validation
 * ====================================
 * PHASE 0.1 SECURITY HARDENING.
 *
 * Minimal, dependency-free validation helpers for mutation endpoints.
 * No new validation library was introduced — the project had none, and the
 * validation needs here (presence, length caps, slug shape, safe URL
 * schemes) don't justify adding one yet. Revisit if the schema grows
 * significantly more complex.
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

export function validateSlug(value: unknown, fieldName: string): ValidationResult {
  if (typeof value !== 'string' || !SLUG_PATTERN.test(value) || value.length > 120) {
    return { valid: false, error: `${fieldName} must be a lowercase, hyphenated slug (e.g. "french-open") of at most 120 characters.` };
  }
  return { valid: true };
}

export function validateText(value: unknown, fieldName: string, maxLength: number, required = true): ValidationResult {
  if (value === undefined || value === null || value === '') {
    if (required) return { valid: false, error: `${fieldName} is required.` };
    return { valid: true };
  }
  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string.` };
  }
  if (required && value.trim().length === 0) {
    return { valid: false, error: `${fieldName} cannot be blank.` };
  }
  if (value.length > maxLength) {
    return { valid: false, error: `${fieldName} must be at most ${maxLength} characters.` };
  }
  return { valid: true };
}

/**
 * Allowed URL schemes for anything the app will render as an href/src.
 * Deliberately excludes javascript:, data:, vbscript:, file:, etc.
 * Relative paths (starting with "/") are always allowed.
 */
export function validateSafeUrl(value: unknown, fieldName: string, opts: { allowRelative?: boolean; required?: boolean } = {}): ValidationResult {
  const { allowRelative = true, required = true } = opts;

  if (value === undefined || value === null || value === '') {
    return required ? { valid: false, error: `${fieldName} is required.` } : { valid: true };
  }
  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string.` };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return required ? { valid: false, error: `${fieldName} cannot be blank.` } : { valid: true };
  }
  if (trimmed.length > 2048) {
    return { valid: false, error: `${fieldName} is too long.` };
  }

  if (allowRelative && trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    // Relative path — safe, no scheme to inspect. Reject control characters / newlines (header/response splitting hygiene).
    if (/[\r\n\t]/.test(trimmed)) {
      return { valid: false, error: `${fieldName} contains invalid control characters.` };
    }
    return { valid: true };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: `${fieldName} must be a valid absolute URL or a relative path starting with "/".` };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: `${fieldName} must use http:// or https:// (got "${parsed.protocol}").` };
  }

  return { valid: true };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: unknown, fieldName: string): ValidationResult {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { valid: false, error: `${fieldName} is required.` };
  }
  const trimmed = value.trim();
  if (trimmed.length > 200 || !EMAIL_PATTERN.test(trimmed)) {
    return { valid: false, error: `${fieldName} must be a valid email address.` };
  }
  return { valid: true };
}

/**
 * A redirect's sourceUrl must always be a relative path on this site — it is
 * never meaningful for it to be an absolute external URL. Rejects dangerous
 * schemes (javascript:, data:, etc.) implicitly by requiring a leading "/".
 */
export function validateRedirectSource(value: unknown, fieldName: string): ValidationResult {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { valid: false, error: `${fieldName} is required.` };
  }
  const trimmed = value.trim();
  if (trimmed.length > 500) {
    return { valid: false, error: `${fieldName} is too long.` };
  }
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return { valid: false, error: `${fieldName} must be a relative path on this site starting with a single "/" (e.g. "/old-page").` };
  }
  if (/[\r\n\t]/.test(trimmed) || /^\/(javascript|data|vbscript):/i.test(trimmed)) {
    return { valid: false, error: `${fieldName} contains invalid or unsafe characters.` };
  }
  return { valid: true };
}

/** Accepts only one of `allowed` (or empty when not required). */
export function validateOneOf(value: unknown, fieldName: string, allowed: readonly string[], required = false): ValidationResult {
  if (value === undefined || value === null || value === '') {
    return required ? { valid: false, error: `${fieldName} is required.` } : { valid: true };
  }
  if (typeof value !== 'string' || !allowed.includes(value)) {
    return { valid: false, error: `${fieldName} must be one of: ${allowed.join(', ')}.` };
  }
  return { valid: true };
}

const SEO_KEYS = ['metaTitle', 'metaDescription', 'canonicalUrl', 'keywords', 'noIndex', 'ogTitle', 'ogDescription', 'ogImage'];

/**
 * Validates an SEO/social metadata object (see SeoMetadata in
 * src/types/index.ts). Unknown keys are rejected so the stored JSON stays a
 * known contract Phase B can render server-side without surprises.
 */
export function validateSeo(value: unknown, fieldName = 'seo'): ValidationResult {
  if (value === undefined || value === null) return { valid: true };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, error: `${fieldName} must be an object.` };
  }
  const seo = value as Record<string, unknown>;
  const unknownKey = Object.keys(seo).find((key) => !SEO_KEYS.includes(key));
  if (unknownKey) {
    return { valid: false, error: `${fieldName}.${unknownKey} is not a supported field.` };
  }
  if (seo.keywords !== undefined && (!Array.isArray(seo.keywords) || seo.keywords.length > 30 || seo.keywords.some((k) => typeof k !== 'string' || k.length > 100))) {
    return { valid: false, error: `${fieldName}.keywords must be a list of at most 30 short strings.` };
  }
  if (seo.noIndex !== undefined && typeof seo.noIndex !== 'boolean') {
    return { valid: false, error: `${fieldName}.noIndex must be true or false.` };
  }
  const error = firstError(
    validateText(seo.metaTitle, `${fieldName}.metaTitle`, 300, false),
    validateText(seo.metaDescription, `${fieldName}.metaDescription`, 500, false),
    validateSafeUrl(seo.canonicalUrl, `${fieldName}.canonicalUrl`, { required: false }),
    validateText(seo.ogTitle, `${fieldName}.ogTitle`, 200, false),
    validateText(seo.ogDescription, `${fieldName}.ogDescription`, 500, false),
    validateSafeUrl(seo.ogImage, `${fieldName}.ogImage`, { required: false })
  );
  return error ? { valid: false, error } : { valid: true };
}

/**
 * PHASE H: a list of small `{ [key]: text }` records (quick facts, defending
 * champions, article references). Rejects unknown keys, blanks and overlong
 * values; `url` keys must be safe http(s) URLs or site paths.
 */
export function validateRecordList(value: unknown, fieldName: string, spec: Record<string, number>, maxItems: number): ValidationResult {
  if (value === undefined || value === null) return { valid: true };
  if (!Array.isArray(value)) return { valid: false, error: `${fieldName} must be a list.` };
  if (value.length > maxItems) return { valid: false, error: `${fieldName} can have at most ${maxItems} entries.` };
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { valid: false, error: `${fieldName} entry ${index + 1} must be an object.` };
    const unknownKey = Object.keys(item).find((k) => !(k in spec));
    if (unknownKey) return { valid: false, error: `${fieldName} entry ${index + 1}: "${unknownKey}" is not supported.` };
    for (const [key, max] of Object.entries(spec)) {
      const v = (item as Record<string, unknown>)[key];
      const check = key === 'url' ? validateSafeUrl(v, `${fieldName} entry ${index + 1} ${key}`) : validateText(v, `${fieldName} entry ${index + 1} ${key}`, max);
      if (!check.valid) return check;
    }
  }
  return { valid: true };
}

export const ARTICLE_STATUSES = ['draft', 'preview', 'scheduled', 'published', 'archived'] as const;
const MAX_SCHEDULE_AHEAD_MS = 2 * 366 * 86_400_000;

/**
 * PHASE H: a scheduled publication time must be an unambiguous ISO-8601
 * instant (with Z or an explicit offset, so it never depends on the server's
 * time zone), in the future, and at most two years ahead.
 */
export function parseScheduledFor(value: unknown, now = Date.now()): { ok: true; date: Date } | { ok: false; error: string } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return { ok: false, error: 'Choose a publication date and time for the scheduled article.' };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ok: false, error: 'The scheduled publication time is not a valid date.' };
  // Date parsing normalizes impossible dates such as February 30; reject them.
  if (!validateIsoDate(value.slice(0, 10), 'scheduledFor', true).valid) return { ok: false, error: 'The scheduled publication time is not a valid calendar date.' };
  const time = value.slice(11).match(/^(\d{2}):(\d{2})(?::(\d{2}))?/)!;
  if (Number(time[1]) > 23 || Number(time[2]) > 59 || Number(time[3] ?? 0) > 59) return { ok: false, error: 'The scheduled publication time is not a valid clock time.' };
  if (date.getTime() <= now) return { ok: false, error: 'The scheduled publication time must be in the future.' };
  if (date.getTime() > now + MAX_SCHEDULE_AHEAD_MS) return { ok: false, error: 'Schedule publication at most two years ahead.' };
  return { ok: true, date };
}

/** PHASE H: calendar dates stored as YYYY-MM-DD strings (edition start/end). */
export function validateIsoDate(value: unknown, fieldName: string, required = false): ValidationResult {
  if (value === undefined || value === null || value === '') return required ? { valid: false, error: `${fieldName} is required.` } : { valid: true };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    return { valid: false, error: `${fieldName} must be a date (YYYY-MM-DD).` };
  }
  return { valid: true };
}

/** Runs a list of validators in order and returns the first failure, or null if all pass. */
export function firstError(...results: ValidationResult[]): string | null {
  for (const r of results) {
    if (!r.valid) return r.error || 'Invalid input.';
  }
  return null;
}
