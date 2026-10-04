/** Normalizes untrusted URL query/route parameters for the public pages. */

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || '';

export const slugParam = (value: string | string[] | undefined) => {
  const v = firstParam(value);
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) && v.length <= 120 ? v : '';
};

/**
 * An Article Type filter value. PHASE R: types are database-backed (Admin →
 * Article Types), so only the SHAPE is checked here; an unknown name simply
 * matches no articles. Filtered listings are noindex either way.
 */
export const articleTypeParam = (value: string | string[] | undefined) => {
  const v = firstParam(value);
  return /^[\p{L}\p{N}][\p{L}\p{N} &'’/().,-]{0,58}[\p{L}\p{N})]$/u.test(v) ? v : '';
};

/** A positive page number, or null when the value is present but invalid. */
export const pageParam = (value: string | string[] | undefined): number | null => {
  const v = firstParam(value);
  if (!v) return 1;
  return /^[1-9]\d{0,4}$/.test(v) ? Number(v) : null;
};

/** A 1–4 digit edition year route segment, or null. */
export const yearParam = (value: string) => (/^\d{1,4}$/.test(value) ? Number(value) : null);
