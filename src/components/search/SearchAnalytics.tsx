'use client';

import React, { useEffect, useRef } from 'react';
import { trackSearchEvent } from '../../lib/searchEvents';

/**
 * Emits search events for the rendered result page and result clicks (see lib/searchEvents).
 * PHASE Q: `trackSearch={false}` reports result clicks only (the Event group shown
 * above the article results), so one search is never reported twice.
 */
export function SearchAnalytics({ query, total, page, filters, sort, trackSearch = true, children }: {
  query: string; total: number; page: number; filters: Record<string, string>; sort: string; trackSearch?: boolean; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const key = JSON.stringify([query, total, page, filters, sort]);

  useEffect(() => {
    if (!query || !trackSearch) return;
    trackSearchEvent({ type: 'search', query, total, page, filters, sort });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div
      ref={ref}
      onClick={(e) => {
        const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-result-position]');
        if (link && query) trackSearchEvent({ type: 'search_result_click', query, url: link.getAttribute('href') || '', position: Number(link.dataset.resultPosition), resultType: link.closest<HTMLElement>('[data-result-kind]')?.dataset.resultKind === 'event' ? 'event' : 'article' });
      }}
    >
      {children}
    </div>
  );
}
