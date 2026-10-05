/**
 * SportingSpy Admin Dashboard
 * High-level overview of editorial metrics, pending moderation tasks, and recent audit activity.
 */

import React from 'react';
import { useApp } from '../../context/AppContext';
import { AdminTab } from './AdminLayout';
import { UNPLACED_AD_SLOTS } from '../../types';

interface AdminDashboardProps {
  setActiveTab: (tab: AdminTab) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ setActiveTab }) => {
  const { sports, events, editions, articles, authors, users, comments, auditLogs, adSlots, redirectRules, features, cmsDataLoaded } = useApp();

  const publishedCount = articles.filter((a) => a.status === 'published').length;
  const draftCount = articles.filter((a) => a.status === 'draft').length;
  const pendingArticles = articles.filter((article) => article.reviewStatus === 'in_review').length;
  const pendingComments = comments.filter((c) => c.status === 'pending');
  const activeAdsCount = adSlots.filter((s) => s.enabled && !UNPLACED_AD_SLOTS.includes(s.id)).length;

  // PHASE R UI/UX: never show zero counts while the dataset is still loading.
  if (!cmsDataLoaded) {
    return <p role="status" aria-live="polite" className="py-10 text-center text-sm text-stone-500 dark:text-stone-400">Loading the editorial overview…</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
          Editorial Overview & Health
        </h2>
        <p className="text-xs text-stone-500 mt-1 dark:text-stone-400">
          Real-time summary of sporting disciplines, tournament editions, and content workflow.
        </p>
      </div>

      {/* METRIC CARDS */}
      <button type="button" onClick={() => setActiveTab('articles')} className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-left text-xs font-semibold text-amber-900 focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{pendingArticles} article{pendingArticles === 1 ? '' : 's'} awaiting editorial review · Open Articles review queues →</button>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/40">
          <div className="text-[11px] text-stone-500 uppercase tracking-wider font-semibold dark:text-stone-400">Sports</div>
          <div className="mt-1 font-serif text-2xl font-bold text-stone-900 dark:text-stone-100 tabular-nums">
            {sports.filter((s) => s.isVisible).length}
          </div>
          <button
            onClick={() => setActiveTab('sports')}
            className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:underline block"
          >
            Manage &rarr;
          </button>
        </div>

        <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/40">
          <div className="text-[11px] text-stone-500 uppercase tracking-wider font-semibold dark:text-stone-400">Events / Editions</div>
          <div className="mt-1 font-serif text-2xl font-bold text-stone-900 dark:text-stone-100 tabular-nums">
            {events.length} <span className="text-xs font-normal text-stone-500 font-sans dark:text-stone-400">({editions.length} ed)</span>
          </div>
          <button
            onClick={() => setActiveTab('events')}
            className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:underline block"
          >
            Manage &rarr;
          </button>
        </div>

        <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/40">
          <div className="text-[11px] text-stone-500 uppercase tracking-wider font-semibold dark:text-stone-400">Articles</div>
          <div className="mt-1 font-serif text-2xl font-bold text-stone-900 dark:text-stone-100 tabular-nums">
            {publishedCount}
          </div>
          <span className="text-[10px] text-stone-500 block font-mono mt-1 dark:text-stone-400">
            {draftCount} in draft
          </span>
        </div>

        {features.comments && (
        <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/40">
          <div className="text-[11px] text-stone-500 uppercase tracking-wider font-semibold dark:text-stone-400">Pending Review</div>
          <div className="mt-1 font-serif text-2xl font-bold text-amber-700 dark:text-amber-500 tabular-nums">
            {pendingComments.length}
          </div>
          <button
            onClick={() => setActiveTab('comments')}
            className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:underline block"
          >
            Moderate &rarr;
          </button>
        </div>
        )}

        <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/40">
          <div className="text-[11px] text-stone-500 uppercase tracking-wider font-semibold dark:text-stone-400">Authors / Staff</div>
          <div className="mt-1 font-serif text-2xl font-bold text-stone-900 dark:text-stone-100 tabular-nums">
            {authors.length}
          </div>
          <button
            onClick={() => setActiveTab('authors')}
            className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:underline block"
          >
            Staff ({users.length}) &rarr;
          </button>
        </div>

        <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/40">
          <div className="text-[11px] text-stone-500 uppercase tracking-wider font-semibold dark:text-stone-400">Redirects (301)</div>
          <div className="mt-1 font-serif text-2xl font-bold text-stone-900 dark:text-stone-100 tabular-nums">
            {redirectRules.length}
          </div>
          <button
            onClick={() => setActiveTab('redirects')}
            className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:underline block"
          >
            Rules &rarr;
          </button>
        </div>
      </div>

      {/* QUICK ACTIONS BAR */}
      <div className="p-4 rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/60 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
            Publishing Shortcuts
          </h3>
          <p className="text-xs text-stone-600 dark:text-stone-400 mt-0.5">
            Quickly trigger the guided workflow for sports, events, and articles.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTab('articles')}
            className="px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold cursor-pointer"
          >
            + New Editorial Article
          </button>
          <button
            onClick={() => setActiveTab('events')}
            className="px-3 py-1.5 rounded-lg bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 text-stone-800 dark:text-stone-200 text-xs font-semibold hover:bg-stone-50 cursor-pointer"
          >
            + Create Event / Edition
          </button>
          <button
            onClick={() => setActiveTab('authors')}
            className="px-3 py-1.5 rounded-lg bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 text-stone-800 dark:text-stone-200 text-xs font-semibold hover:bg-stone-50 cursor-pointer"
          >
            + Add Author
          </button>
          <button
            onClick={() => setActiveTab('redirects')}
            className="px-3 py-1.5 rounded-lg bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 text-stone-800 dark:text-stone-200 text-xs font-semibold hover:bg-stone-50 cursor-pointer"
          >
            + URL Redirect
          </button>
          <button
            onClick={() => setActiveTab('ads')}
            className="px-3 py-1.5 rounded-lg bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 text-stone-800 dark:text-stone-200 text-xs font-semibold hover:bg-stone-50 cursor-pointer"
          >
            Ad Slots ({activeAdsCount} Active)
          </button>
        </div>
      </div>

      {/* RECENT AUDIT LOG PREVIEW */}
      <div className="space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-stone-200 dark:border-stone-800">
          <h3 className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100">
            Recent System Audit Trail
          </h3>
          <button
            onClick={() => setActiveTab('audit')}
            className="text-xs text-amber-700 dark:text-amber-400 font-semibold hover:underline"
          >
            View All Logs &rarr;
          </button>
        </div>
        <div className="divide-y divide-stone-100 dark:divide-stone-800 text-xs">
          {auditLogs.slice(0, 5).map((log) => (
            <div key={log.id} className="py-2.5 flex items-center justify-between">
              <div>
                <span className="font-semibold text-stone-900 dark:text-stone-100 mr-2">{log.action}:</span>
                <span className="text-stone-600 dark:text-stone-400">{log.details}</span>
              </div>
              <span className="text-stone-500 font-mono text-[11px] tabular-nums whitespace-nowrap ml-4 dark:text-stone-400">
                {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
