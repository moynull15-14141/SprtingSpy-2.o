'use client';

import React, { useEffect, useRef } from 'react';
import { trackSearchEvent } from '../../lib/searchEvents';

/** Emits search events for the rendered result page and result clicks (see lib/searchEvents). */
export function SearchAnalytics({ query, total, page, filters, sort, children }: {
  query: string; total: number; page: number; filters: Record<string, string>; sort: string; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const key = JSON.stringify([query, total, page, filters, sort]);

  useEffect(() => {
    if (!query) return;
    trackSearchEvent({ type: 'search', query, total, page, filters, sort });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div
      ref={ref}
      onClick={(e) => {
        const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-result-position]');
        if (link && query) trackSearchEvent({ type: 'search_result_click', query, url: link.getAttribute('href') || '', position: Number(link.dataset.resultPosition) });
      }}
    >
      {children}
    </div>
  );
}
