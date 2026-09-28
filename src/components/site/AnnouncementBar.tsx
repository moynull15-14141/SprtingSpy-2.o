/**
 * Site-wide announcements (PHASE F.1): active, in-window announcements from
 * the Site Experience, highest priority first (at most two, so the bar never
 * pushes the page down far). Breaking items are visually distinct.
 */
import React from 'react';
import type { ResolvedAnnouncement } from '../../../server/services/public/siteLayout';
import { SiteLink } from './SiteLink';

export function AnnouncementBar({ items }: { items: ResolvedAnnouncement[] }) {
  if (!items.length) return null;
  return (
    <div role="region" aria-label="Announcements" className="site-announcements border-b border-stone-200 dark:border-stone-800">
      {items.slice(0, 2).map((a) => {
        const breaking = a.variant === 'breaking';
        const body = (
          <span className="inline-flex flex-wrap items-center justify-center gap-2">
            {breaking && <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest">Breaking</span>}
            <span>{a.text}</span>
            {a.href && <span aria-hidden="true">→</span>}
          </span>
        );
        return (
          <div key={a.id} data-announcement={a.id} className={`px-4 py-2 text-center text-sm font-medium ${breaking ? 'bg-rose-700 text-white' : 'bg-amber-50 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100'}`}>
            {a.href ? <SiteLink href={a.href} className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded">{body}</SiteLink> : body}
          </div>
        );
      })}
    </div>
  );
}
