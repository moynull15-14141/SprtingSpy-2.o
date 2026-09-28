/** Normalizes untrusted URL query/route parameters for the public pages. */
import { ARTICLE_TYPES } from '../types';

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || '';

export const slugParam = (value: string | string[] | undefined) => {
  const v = firstParam(value);
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) && v.length <= 120 ? v : '';
};

export const articleTypeParam = (value: string | string[] | undefined) => {
  const v = firstParam(value);
  return (ARTICLE_TYPES as readonly string[]).includes(v) ? v : '';
};

/** A positive page number, or null when the value is present but invalid. */
export const pageParam = (value: string | string[] | undefined): number | null => {
  const v = firstParam(value);
  if (!v) return 1;
  return /^[1-9]\d{0,4}$/.test(v) ? Number(v) : null;
};

/** A 1–4 digit edition year route segment, or null. */
export const yearParam = (value: string) => (/^\d{1,4}$/.test(value) ? Number(value) : null);
