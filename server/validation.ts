/**
 * SportingSpy Server Input Validation
 * ====================================
 * PHASE 0.1 SECURITY HARDENING.
 *
 * Minimal, dependency-free validation helpers for mutation endpoints.
 * No new validation library was introduced — the project had none, and the
 * validation needs here (presence, length caps, slug shape, safe URL
 * schemes) don't justify adding one yet. Revisit if the schema grows
 * significantly more complex (see PROJECT_BRAIN.md Phase 2).
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

/** Runs a list of validators in order and returns the first failure, or null if all pass. */
export function firstError(...results: ValidationResult[]): string | null {
  for (const r of results) {
    if (!r.valid) return r.error || 'Invalid input.';
  }
  return null;
}
