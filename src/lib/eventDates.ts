/**
 * Edition date formatting (E4, shared from PHASE E5). Dates are stored as UTC
 * calendar days (`YYYY-MM-DD`), so they are formatted in UTC to stay stable
 * on every server and browser.
 */

import type { EventEdition } from '../types';

export const longDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "24 May 2026 – 7 June 2026", a single date, or null when no date is stored. */
export const editionDates = (edition: Pick<EventEdition, 'startDate' | 'endDate'>) =>
  edition.startDate && edition.endDate && edition.startDate !== edition.endDate
    ? `${longDate(edition.startDate)} – ${longDate(edition.endDate)}`
    : edition.startDate ? longDate(edition.startDate) : edition.endDate ? longDate(edition.endDate) : null;
