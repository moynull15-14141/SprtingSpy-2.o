/**
 * SportingSpy Admin Dashboard
 * High-level overview of editorial metrics, pending moderation tasks, and recent audit activity.
 */

import React from 'react';
import { useApp } from '../../context/AppContext';
import { AdminTab } from './AdminLayout';

interface AdminDashboardProps {
  setActiveTab: (tab: AdminTab) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ setActiveTab }) => {
  const { sports, events, editions, articles, authors, users, comments, auditLogs, adSlots, redirectRules } = useApp();

  const publishedCount = articles.filter((a) => a.status === 'published').length;
  const draftCount = articles.filter((a) => a.status === 'draft').length;
  const pendingComments = comments.filter((c) => c.status === 'pending');
  const activeAdsCount = adSlots.filter((s) => s.enabled).length;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
          Editorial Overview & Health
        </h2>
        <p className="text-xs text-stone-500 mt-1">
          Real-time summary of sporting disciplines, tournament editions, and content workflow.
        </p>
      </div>

      {/* METRIC CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/40">
          <div className="text-[11px] text-stone-500 uppercase tracking-wider font-semibold">Sports</div>
          <div className="mt-1 font-serif text-2xl font-bold text-stone-900 dark:text-stone-100 tabular-nums">
            {sports.filter((s) => s.isVisible).length}
          </div>
          <button
            onClick={() => setActiveTab('sports')}
            className="mt-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:underline block"
          >
            Manage &rarr;
          </button>
        </div>

        <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/40">
          <div className="text-[11px] text-stone-500 uppercase tracking-wider font-semibold">Events / Editions</div>
          <div className="mt-1 font-serif text-2xl font-bold text-stone-900 dark:text-stone-100 tabular-nums">
            {events.length} <span className="text-xs font-normal text-stone-400 font-sans">({editions.length} ed)</span>
          </div>
          <button
            onClick={() => setActiveTab('events')}
            className="mt-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:underline block"
          >
            Manage &rarr;
          </button>
        </div>

        <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/40">
          <div className="text-[11px] text-stone-500 uppercase tracking-wider font-semibold">Articles</div>
          <div className="mt-1 font-serif text-2xl font-bold text-stone-900 dark:text-stone-100 tabular-nums">
            {publishedCount}
          </div>
          <span className="text-[10px] text-stone-400 block font-mono mt-1">
            {draftCount} in draft
          </span>
        </div>

        <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/40">
          <div className="text-[11px] text-stone-500 uppercase tracking-wider font-semibold">Pending Review</div>
          <div className="mt-1 font-serif text-2xl font-bold text-amber-600 dark:text-amber-500 tabular-nums">
            {pendingComments.length}
          </div>
          <button
            onClick={() => setActiveTab('comments')}
            className="mt-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:underline block"
          >
            Moderate &rarr;
          </button>
        </div>

        <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/40">
          <div className="text-[11px] text-stone-500 uppercase tracking-wider font-semibold">Authors / Staff</div>
          <div className="mt-1 font-serif text-2xl font-bold text-stone-900 dark:text-stone-100 tabular-nums">
            {authors.length}
          </div>
          <button
            onClick={() => setActiveTab('authors')}
            className="mt-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:underline block"
          >
            Staff ({users.length}) &rarr;
          </button>
        </div>

        <div className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/40">
          <div className="text-[11px] text-stone-500 uppercase tracking-wider font-semibold">Redirects (301)</div>
          <div className="mt-1 font-serif text-2xl font-bold text-stone-900 dark:text-stone-100 tabular-nums">
            {redirectRules.length}
          </div>
          <button
            onClick={() => setActiveTab('redirects')}
            className="mt-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:underline block"
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
            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer"
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
            className="text-xs text-amber-600 dark:text-amber-400 font-semibold hover:underline"
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
              <span className="text-stone-400 font-mono text-[11px] tabular-nums whitespace-nowrap ml-4">
                {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
