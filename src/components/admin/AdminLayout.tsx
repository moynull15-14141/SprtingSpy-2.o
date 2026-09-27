/**
 * SportingSpy Editorial CMS - Admin Layout
 * Clean, efficient editorial CMS for publishers, editors, and authors.
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { SeoHead } from '../layout/SeoHead';

export type AdminTab =
  | 'dashboard'
  | 'articles'
  | 'sports'
  | 'events'
  | 'authors'
  | 'users'
  | 'comments'
  | 'media'
  | 'ads'
  | 'seo'
  | 'redirects'
  | 'audit';

interface AdminLayoutProps {
  children: (activeTab: AdminTab, setActiveTab: (tab: AdminTab) => void) => React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const { currentUser, navigate, comments, redirectRules } = useApp();
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');

  const pendingCommentsCount = comments.filter((c) => c.status === 'pending').length;

  const NAV_ITEMS: { id: AdminTab; label: string; badge?: number; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'articles', label: 'Articles', icon: '✍️' },
    { id: 'sports', label: 'Sports', icon: '⚽' },
    { id: 'events', label: 'Events & Editions', icon: '🏆' },
    { id: 'authors', label: 'Authors / Beats', icon: '🧑‍💼' },
    { id: 'users', label: 'User Roles & RBAC', icon: '👥' },
    { id: 'comments', label: 'Comments', badge: pendingCommentsCount, icon: '💬' },
    { id: 'media', label: 'Media Library', icon: '🖼️' },
    { id: 'ads', label: 'Ad Placements', icon: '📢' },
    { id: 'seo', label: 'SEO Diagnostics', icon: '🔍' },
    { id: 'redirects', label: 'URL Redirects (301/302)', badge: redirectRules.length, icon: '🔀' },
    { id: 'audit', label: 'Audit Logs', icon: '📜' },
  ];

  return (
    <div className="space-y-6">
      <SeoHead title="Editorial CMS & Content Manager | SportingSpy" canonicalPath="/admin" />

      {/* Admin Top Status Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-stone-200 dark:border-stone-800 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-500">
              Editorial CMS Console
            </span>
            <span className="text-stone-300 dark:text-stone-700">·</span>
            <span className="text-xs text-stone-500">Role: {currentUser.role}</span>
          </div>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900 dark:text-stone-100">
            Content Management System
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/account')} className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-medium">My account</button>
          <button
            onClick={() => navigate('/')}
            className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          >
            &larr; View Public Website
          </button>
        </div>
      </div>

      {/* Role Notice */}
      {currentUser.role === 'Reader' && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between">
          <span>
            <strong>Reader Role Active:</strong> You are viewing the CMS in read-only inspection mode. Log in with an
            Admin, Editor, or Author account via the staff login menu in the top bar to unlock CMS actions.
          </span>
        </div>
      )}

      {/* CMS Two-Column Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Navigation Sidebar */}
        <aside className="lg:col-span-3 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-3 space-y-1 shadow-sm">
          <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-stone-400">
            Publishing Desks
          </div>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                activeTab === item.id
                  ? 'bg-amber-600 text-white font-semibold shadow-sm'
                  : 'text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </div>
              {item.badge !== undefined && item.badge > 0 && (
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                    activeTab === item.id ? 'bg-white text-stone-900' : 'bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </aside>

        {/* Main Content Workspace */}
        <main className="lg:col-span-9 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-6 lg:p-8 shadow-sm min-h-[500px]">
          {children(activeTab, setActiveTab)}
        </main>
      </div>
    </div>
  );
};
