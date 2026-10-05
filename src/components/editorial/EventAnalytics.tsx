'use client';

import { useEffect } from 'react';
import { analytics } from '../../lib/analytics';

/**
 * Reports event_view for a public Event or Edition page (PHASE Q), the Event
 * counterpart of article_view. Public identifiers only; sent with the page's
 * page_view and only under analytics consent (lib/analytics).
 */
export function EventAnalytics(props: { id: string; sport: string; event: string; editionYear?: number; editionStatus?: string }) {
  useEffect(() => {
    analytics.track('event_view', {
      event_id: props.id, sport: props.sport, event: props.event, edition_year: props.editionYear, edition_status: props.editionStatus,
    }, { pageScoped: true });
  }, [props.id, props.editionYear]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
