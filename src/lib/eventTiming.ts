/**
 * Edition timing (PHASE E5): whether an Edition is upcoming, happening now or
 * past, derived only from stored facts. Used by Event discovery, the home
 * "upcoming" section and the Event FAQ, so every surface agrees.
 *
 * Rules (dates are UTC calendar days, `YYYY-MM-DD`; a single stored date
 * stands for both ends):
 *   past     status is completed/archived, OR the last day is before today
 *   upcoming not past, AND the first day is after today
 *            (or no dates are stored and the status is `upcoming`)
 *   ongoing  everything else: the dates include today
 *            (or no dates are stored and the status is `active`)
 *
 * The editor's status is never rewritten; a stale `upcoming` status with
 * dates in the past is simply listed as past by its dates.
 */

import type { EditionStatus } from '../types';

export const EDITION_TIMINGS = ['upcoming', 'ongoing', 'past'] as const;
export type EditionTiming = (typeof EDITION_TIMINGS)[number];

export const TIMING_LABELS: Record<EditionTiming, string> = { upcoming: 'Upcoming', ongoing: 'Happening now', past: 'Past' };

/** Today's UTC calendar date, the reference day for every timing decision. */
export const utcToday = (now: Date = new Date()) => now.toISOString().slice(0, 10);

export function editionTiming(edition: { status: EditionStatus; startDate?: string | null; endDate?: string | null }, today: string = utcToday()): EditionTiming {
  if (edition.status === 'completed' || edition.status === 'archived') return 'past';
  const first = edition.startDate || edition.endDate || null;
  const last = edition.endDate || edition.startDate || null;
  if (last && last < today) return 'past';
  if (first) return first > today ? 'upcoming' : 'ongoing';
  return edition.status === 'active' ? 'ongoing' : 'upcoming';
}

export const timingParam = (value: string | string[] | undefined): EditionTiming | '' | null => {
  const v = (Array.isArray(value) ? value[0] : value) || '';
  if (!v) return '';
  return (EDITION_TIMINGS as readonly string[]).includes(v) ? (v as EditionTiming) : null;
};
