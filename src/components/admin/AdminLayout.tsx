/**
 * SportingSpy Editorial CMS - Admin Layout
 * Clean, efficient editorial CMS for publishers, editors, and authors.
 */

import React, { useEffect, useState } from 'react';
import {
  PanelLeftClose, PanelLeftOpen, LayoutDashboard, FileText, Trophy, CalendarDays, UserSquare2, ShieldCheck,
  MessageSquare, Image, Megaphone, SearchCheck, ArrowLeftRight, ScrollText, Settings, PanelsTopLeft, HelpCircle, Inbox, Tags, ChartNoAxesCombined, Route, type LucideIcon,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

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
  | 'audit'
  | 'site'
  | 'faq'
  | 'inbox'
  | 'types'
  | 'insights'
  | 'migration'
  | 'settings';

interface AdminLayoutProps {
  children: (activeTab: AdminTab, setActiveTab: (tab: AdminTab) => void) => React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const { currentUser, navigate, comments, redirectRules, features } = useApp();
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  // Collapsing the desk navigation gives the article editor more width. The
  // preference is a per-browser convenience, so storage failures are ignored.
  const [savedCollapsed, setSavedCollapsed] = useState(false);
  useEffect(() => {
    try { setSavedCollapsed(localStorage.getItem('cms-nav-collapsed') === '1'); } catch { /* ignore */ }
  }, []);
  // PHASE R UI/UX: while an article is open in the editor the navigation folds
  // to its icon rail so the writing column keeps its width (Expand still works
  // and does not change the saved preference).
  const [editorFocus, setEditorFocus] = useState(false);
  const [focusExpanded, setFocusExpanded] = useState(false);
  useEffect(() => {
    const onFocus = (e: Event) => { setEditorFocus(!!(e as CustomEvent<{ active: boolean }>).detail?.active); setFocusExpanded(false); };
    window.addEventListener('sportingspy:cms-editor', onFocus);
    return () => window.removeEventListener('sportingspy:cms-editor', onFocus);
  }, []);
  const navCollapsed = editorFocus ? !focusExpanded : savedCollapsed;
  const toggleNav = () => {
    if (editorFocus) { setFocusExpanded((v) => !v); return; }
    setSavedCollapsed((value) => {
      try { localStorage.setItem('cms-nav-collapsed', value ? '0' : '1'); } catch { /* ignore */ }
      return !value;
    });
  };

  const pendingCommentsCount = comments.filter((c) => c.status === 'pending').length;

  // Line icons from the same set as the editor toolbar (lucide), one per desk.
  const NAV_ITEMS: { id: AdminTab; label: string; badge?: number; icon: LucideIcon }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'articles', label: 'Articles', icon: FileText },
    // PHASE R: database-backed Article Types (Admin edits; Editor/Author can view).
    ...(['Admin', 'Editor'].includes(currentUser.role) ? [{ id: 'types' as AdminTab, label: 'Article Types', icon: Tags }] : []),
    ...(['Admin', 'Editor'].includes(currentUser.role) ? [{ id: 'site' as AdminTab, label: 'Site Experience', icon: PanelsTopLeft }] : []),
    // PHASE H: FAQ content and the contact-form inbox (APIs are Admin/Editor only).
    ...(['Admin', 'Editor'].includes(currentUser.role) ? [{ id: 'faq' as AdminTab, label: 'FAQ', icon: HelpCircle }, { id: 'inbox' as AdminTab, label: 'Contact Inbox', icon: Inbox }] : []),
    { id: 'sports', label: 'Sports', icon: Trophy },
    { id: 'events', label: 'Events & Editions', icon: CalendarDays },
    { id: 'authors', label: 'Authors / Beats', icon: UserSquare2 },
    { id: 'users', label: 'User Roles & RBAC', icon: ShieldCheck },
    ...(features.comments ? [{ id: 'comments' as AdminTab, label: 'Comments', badge: pendingCommentsCount, icon: MessageSquare }] : []),
    { id: 'media', label: 'Media Library', icon: Image },
    { id: 'ads', label: 'Ad Placements', icon: Megaphone },
    { id: 'seo', label: 'SEO Intelligence', icon: SearchCheck },
    // PHASE R: content / search / performance insights (separate from ad placement management).
    ...(['Admin', 'Editor'].includes(currentUser.role) ? [{ id: 'insights' as AdminTab, label: 'Analytics & Insights', icon: ChartNoAxesCombined }, { id: 'migration' as AdminTab, label: 'Site Migration', icon: Route }] : []),
    { id: 'redirects', label: 'URL Redirects (301/302)', badge: redirectRules.length, icon: ArrowLeftRight },
    { id: 'audit', label: 'Audit Logs', icon: ScrollText },
    ...(currentUser.role === 'Admin' ? [{ id: 'settings' as AdminTab, label: 'Settings', icon: Settings }] : []),
  ];

  return (
    <div className="cms-shell space-y-4">

      {/* Admin Top Status Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3 dark:border-stone-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-500">
              Editorial CMS Console
            </span>
            <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">·</span>
            <span className="text-[11px] text-stone-500 dark:text-stone-400">Role: {currentUser.role}</span>
          </div>
          <h1 className="font-serif text-xl font-bold text-stone-900 dark:text-stone-100 sm:text-2xl">
            Content Management System
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button data-cms-navigation onClick={() => navigate('/account')} className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors">My account</button>
          <button
            data-cms-navigation
            onClick={() => navigate('/')}
            className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-medium text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          >
            &larr; View Public Website
          </button>
        </div>
      </div>

      {/* CMS Two-Column Workspace: on desktop the navigation and the content
          pane are independent, viewport-bound regions (see index.css). */}
      <div className={`cms-workspace-frame grid min-w-0 grid-cols-1 gap-4 xl:gap-5 ${navCollapsed ? 'lg:grid-cols-[4rem_minmax(0,1fr)]' : 'lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]'}`} data-nav-collapsed={navCollapsed || undefined}>
        {/* Navigation Sidebar */}
        <aside className="cms-admin-nav min-w-0 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-2 shadow-sm lg:p-3" aria-label="CMS navigation">
          <div className={`hidden items-center gap-2 pb-2 lg:flex ${navCollapsed ? 'justify-center' : 'justify-between pl-3'}`}>
            {!navCollapsed && <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">Publishing Desks</span>}
            <button
              type="button"
              onClick={toggleNav}
              aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
              aria-expanded={!navCollapsed}
              title={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:bg-stone-800 dark:hover:text-stone-100 dark:text-stone-400"
            >
              {navCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>
          <nav className="cms-admin-nav-list flex gap-1 overflow-x-auto lg:block lg:space-y-1 lg:overflow-visible">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              data-cms-navigation
              onClick={() => setActiveTab(item.id)}
              aria-current={activeTab === item.id ? 'page' : undefined}
              aria-label={navCollapsed ? item.label : undefined}
              title={navCollapsed ? item.label : undefined}
              className={`relative flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 lg:w-full lg:min-w-0 lg:py-2.5 ${navCollapsed ? 'lg:justify-center lg:px-0' : 'lg:justify-between'} ${
                activeTab === item.id
                  ? 'bg-amber-700 text-white font-semibold shadow-sm'
                  : 'text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'
              }`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <item.icon size={17} strokeWidth={1.9} aria-hidden="true" className={`shrink-0 ${activeTab === item.id ? 'text-white' : 'text-stone-500 dark:text-stone-400'}`} />
                <span className={`whitespace-nowrap text-left leading-snug lg:min-w-0 lg:whitespace-normal lg:break-words ${navCollapsed ? 'lg:sr-only' : ''}`}>{item.label}</span>
              </span>
              {item.badge !== undefined && item.badge > 0 && (
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${navCollapsed ? 'lg:absolute lg:-right-1 lg:-top-1 lg:px-1.5' : ''} ${
                    activeTab === item.id ? 'bg-white text-stone-900' : 'bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          ))}
          </nav>
        </aside>

        {/* Main Content Workspace */}
        <div className="cms-main min-w-0 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-4 sm:p-5 shadow-sm">
          {children(activeTab, setActiveTab)}
        </div>
      </div>
    </div>
  );
};
