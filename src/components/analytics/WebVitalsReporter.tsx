'use client';

/**
 * Real-user monitoring reporter (PHASE R, Spec §25.6–25.8).
 *
 * Sends, to this site's own /api/rum endpoint only:
 *   - one page-view count per page (path without query string, page type, device class)
 *   - Core Web Vitals (LCP, INP, CLS) measured by Next.js, when the page is hidden
 * No cookies are set and no identifier is sent; the server stores daily
 * aggregate counters only. Staff, account and preview pages are never measured.
 */

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useReportWebVitals } from 'next/web-vitals';

const MEASURED = new Set(['LCP', 'INP', 'CLS']);
const PRIVATE = /^\/(admin|account|reset-password)(\/|$)/;

const csrfToken = () => document.cookie.split('; ').find((c) => c.startsWith('csrf_token='))?.split('=')[1] ?? '';
const device = () => (window.matchMedia('(max-width: 767px), (pointer: coarse)').matches ? 'mobile' : 'desktop');
const pageType = () => document.querySelector<HTMLElement>('[data-ss-page-type]')?.dataset.ssPageType || 'static';

function send(body: Record<string, unknown>) {
  try {
    void fetch('/api/rum', {
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
      body: JSON.stringify(body),
    }).catch(() => undefined);
  } catch {
    // Measurement must never affect the page.
  }
}

export function WebVitalsReporter({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const metrics = useRef(new Map<string, number>());
  // Vitals belong to the page that was loaded (LCP/CLS are measured for the hard load).
  const loaded = useRef<{ path: string; type: string } | null>(null);
  const flushRef = useRef(() => {});

  useReportWebVitals((metric) => {
    if (!enabled || !MEASURED.has(metric.name)) return;
    metrics.current.set(metric.name, metric.value);
    // The library reports final LCP/CLS/INP from its own page-hide handler, which
    // can run after ours: anything arriving while hidden is sent straight away.
    if (document.visibilityState === 'hidden') flushRef.current();
  });

  // One view per page, including client-side navigations.
  useEffect(() => {
    if (!enabled || !pathname || PRIVATE.test(pathname)) return;
    const timer = window.setTimeout(() => {
      const type = pageType();
      if (!loaded.current) loaded.current = { path: pathname, type };
      send({ view: true, path: pathname, pageType: type, device: device() });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [enabled, pathname]);

  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      if (!metrics.current.size || !loaded.current || PRIVATE.test(loaded.current.path)) return;
      send({ path: loaded.current.path, pageType: loaded.current.type, device: device(), metrics: [...metrics.current].map(([name, value]) => ({ name, value })) });
      metrics.current.clear();
    };
    flushRef.current = flush;
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    };
  }, [enabled]);

  return null;
}
