'use client';

import { useEffect } from 'react';
import { analytics } from '../../lib/analytics';

/**
 * Reports article_view for a public article (PHASE F). Only public identifiers
 * are sent — never the body, drafts or staff data. Not rendered on staff previews.
 */
export function ArticleAnalytics(props: { id: string; sport: string; category: string; author?: string; event?: string; publishedAt: string }) {
  useEffect(() => {
    analytics.track('article_view', {
      article_id: props.id, sport: props.sport, category: props.category, author: props.author, event: props.event, published_at: props.publishedAt.slice(0, 10),
    }, { pageScoped: true });
  }, [props.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
