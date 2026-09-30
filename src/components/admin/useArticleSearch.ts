'use client';

/**
 * CMS article search (PHASE E): one client hook over GET
 * /api/cms/articles/search, shared by the Articles list and the editor's
 * Internal Link / Related Story selectors. Filtering, ranking and paging all
 * happen in PostgreSQL; the browser only receives one page of rows.
 */

import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';

export interface CmsArticleHit {
  id: string;
  title: string;
  slug: string;
  status: 'draft' | 'preview' | 'scheduled' | 'published' | 'archived';
  reviewStatus?: import('../../lib/editorialWorkflow').ReviewStatus;
  reviewerId?: string | null;
  sportSlug: string;
  sportName: string;
  eventSlug: string | null;
  editionYear: number | null;
  articleType: string;
  excerpt: string;
  publishedAt: string;
  reviewedAt: string | null;
  /** PHASE H: when a scheduled article goes live (null otherwise). */
  scheduledFor?: string | null;
  authorId: string;
  authorName: string;
  featuredImage: string;
  url: string;
}

export interface CmsArticleSearchParams {
  q?: string;
  status?: string;
  sport?: string;
  type?: string;
  author?: string;
  date?: string;
  sort?: string;
  page?: number;
  limit?: number;
  exclude?: string;
  publicOnly?: boolean;
  reviewStatus?: string;
  myDrafts?: boolean;
}

interface Response { items: CmsArticleHit[]; total: number; page: number; pageSize: number; totalPages: number; mode: string }

export function useArticleSearch(params: CmsArticleSearchParams, options: { debounceMs?: number; enabled?: boolean; reloadKey?: unknown } = {}) {
  const { apiCall } = useApp();
  const { debounceMs = 250, enabled = true, reloadKey } = options;
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)])
  ).toString();

  useEffect(() => {
    if (!enabled) return;
    const request = ++latest.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      const res = await apiCall<Response>(`/api/cms/articles/search?${query}`);
      // Ignore responses to superseded queries (typing quickly).
      if (request !== latest.current) return;
      setLoading(false);
      if (res.data) { setData(res.data); setError(null); } else setError(res.error || 'Search failed.');
    }, debounceMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, enabled, reloadKey]);

  return { data, loading, error };
}
