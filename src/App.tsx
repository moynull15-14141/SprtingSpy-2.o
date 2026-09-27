/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { HomePage } from './pages/HomePage';
import { SportPage } from './pages/SportPage';
import { EventPage } from './pages/EventPage';
import { EventEditionPage } from './pages/EventEditionPage';
import { ArticlePage } from './pages/ArticlePage';
import { SportsDirectoryPage } from './pages/SportsDirectoryPage';
import { EventsDirectoryPage } from './pages/EventsDirectoryPage';
import { LatestArticlesPage } from './pages/LatestArticlesPage';
import { SearchPage } from './pages/SearchPage';
import { AuthorPage } from './pages/AuthorPage';
import { AccountPage } from './pages/AccountPage';
import { AboutPage, ContactPage, DmcaPage, PrivacyPage, TermsPage } from './pages/StaticPages';
import { AdminLayout } from './components/admin/AdminLayout';
import { AdminAccessGate } from './components/admin/AdminAccessGate';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { AdminArticles } from './components/admin/AdminArticles';
import { AdminSports } from './components/admin/AdminSports';
import { AdminEvents } from './components/admin/AdminEvents';
import { AdminComments } from './components/admin/AdminComments';
import { AdminMedia } from './components/admin/AdminMedia';
import { AdminAds } from './components/admin/AdminAds';
import { AdminSeoAudit } from './components/admin/AdminSeoAudit';
import { AdminAuditLogs } from './components/admin/AdminAuditLogs';
import { AdminAuthors } from './components/admin/AdminAuthors';
import { AdminUsers } from './components/admin/AdminUsers';
import { AdminRedirects } from './components/admin/AdminRedirects';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

const AppContent: React.FC = () => {
  const { currentPath, sports, events, editions, articles, notification, clearNotification } = useApp();

  // Normalize path removing trailing slash
  const path = currentPath === '' ? '/' : currentPath;
  const pathParts = path.split('/').filter(Boolean);

  const renderView = () => {
    if (path === '/account') return <AccountPage />;
    // 1. Root Homepage
    if (path === '/') {
      return <HomePage />;
    }

    // 2. Named Directories & Static Pages
    if (path === '/sports') {
      return <SportsDirectoryPage />;
    }
    if (path === '/events') {
      return <EventsDirectoryPage />;
    }
    if (path === '/latest') {
      return <LatestArticlesPage />;
    }
    if (path === '/search') {
      return <SearchPage />;
    }
    if (path === '/about') {
      return <AboutPage />;
    }
    if (path === '/contact') {
      return <ContactPage />;
    }
    if (path === '/privacy') {
      return <PrivacyPage />;
    }
    if (path === '/terms') {
      return <TermsPage />;
    }
    if (path === '/dmca') {
      return <DmcaPage />;
    }

    // 3. Author Profile: /author/:slug
    if (pathParts[0] === 'author' && pathParts[1]) {
      return <AuthorPage authorSlug={pathParts[1]} />;
    }

    // 4. Admin CMS Console: /admin
    // PHASE 3: gated by AdminAccessGate — unauthenticated visitors see a
    // login prompt, authenticated non-staff (Reader) see Access Denied, and
    // only Admin/Editor/Author ever reach AdminLayout itself. This is a
    // frontend UX guard only; every mutation the panel can trigger is still
    // independently authorized server-side.
    if (pathParts[0] === 'admin') {
      return (
        <AdminAccessGate>
        <AdminLayout>
          {(activeTab, setActiveTab) => {
            switch (activeTab) {
              case 'dashboard':
                return <AdminDashboard setActiveTab={setActiveTab} />;
              case 'articles':
                return <AdminArticles />;
              case 'sports':
                return <AdminSports />;
              case 'events':
                return <AdminEvents />;
              case 'authors':
                return <AdminAuthors />;
              case 'users':
                return <AdminUsers />;
              case 'comments':
                return <AdminComments />;
              case 'media':
                return <AdminMedia />;
              case 'ads':
                return <AdminAds />;
              case 'seo':
                return <AdminSeoAudit />;
              case 'redirects':
                return <AdminRedirects />;
              case 'audit':
                return <AdminAuditLogs />;
              default:
                return <AdminDashboard setActiveTab={setActiveTab} />;
            }
          }}
        </AdminLayout>
        </AdminAccessGate>
      );
    }

    // 5. Hierarchical Sport URLs:
    // Pattern A: /{sport}
    if (pathParts.length === 1) {
      const sportSlug = pathParts[0];
      const sport = sports.find((s) => s.slug === sportSlug);
      if (sport) {
        return <SportPage sportSlug={sportSlug} />;
      }
    }

    // Pattern B: /{sport}/{event} OR /{sport}/{general-article-slug}
    if (pathParts.length === 2) {
      const [sportSlug, secondSegment] = pathParts;

      // Check if secondSegment is a permanent event
      const event = events.find((e) => e.sportSlug === sportSlug && e.slug === secondSegment);
      if (event) {
        return <EventPage sportSlug={sportSlug} eventSlug={secondSegment} />;
      }

      // Check if secondSegment is an article belonging directly to the sport
      const article = articles.find(
        (a) => a.sportSlug === sportSlug && a.slug === secondSegment && !a.eventSlug
      );
      if (article) {
        return <ArticlePage article={article} />;
      }
    }

    // Pattern C: /{sport}/{event}/{year}
    if (pathParts.length === 3) {
      const [sportSlug, eventSlug, yearStr] = pathParts;
      const year = parseInt(yearStr, 10);
      if (!isNaN(year)) {
        return <EventEditionPage sportSlug={sportSlug} eventSlug={eventSlug} year={year} />;
      }
    }

    // Pattern D: /{sport}/{event}/{year}/{article-slug}
    if (pathParts.length === 4) {
      const [sportSlug, eventSlug, yearStr, articleSlug] = pathParts;
      const year = parseInt(yearStr, 10);
      const article = articles.find(
        (a) =>
          a.sportSlug === sportSlug &&
          a.eventSlug === eventSlug &&
          a.editionYear === year &&
          a.slug === articleSlug
      );
      if (article) {
        return <ArticlePage article={article} />;
      }
    }

    // 404 Fallback
    return (
      <div className="py-20 text-center max-w-lg mx-auto space-y-4">
        <h1 className="font-serif text-4xl font-bold text-stone-900 dark:text-stone-100">404</h1>
        <p className="text-base text-stone-600 dark:text-stone-400">
          The requested sports dossier or URL was not found in the SportingSpy registry.
        </p>
        <p className="font-mono text-xs text-stone-400">{currentPath}</p>
        <div className="pt-4">
          <a
            href="/"
            className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 transition-colors inline-block"
          >
            Return to SportingSpy Home
          </a>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-stone-50 dark:bg-[#0c0d0e] text-stone-900 dark:text-stone-100 font-sans selection:bg-amber-500 selection:text-white transition-colors relative">
      {/* Toast Notification Container */}
      {notification && (
        <div className="fixed top-5 right-5 z-50 max-w-md w-full shadow-2xl rounded-xl border p-4 backdrop-blur-md transition-all duration-200 animate-in fade-in slide-in-from-top-4 flex items-start space-x-3 bg-white/95 dark:bg-stone-900/95 border-stone-200 dark:border-stone-800">
          {notification.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />}
          {notification.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />}
          {notification.type === 'info' && <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />}
          <div className="flex-1 text-sm font-medium leading-snug">
            {notification.message}
          </div>
          <button
            onClick={clearNotification}
            className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 p-0.5 rounded transition-colors"
            title="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <Header />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {renderView()}
      </main>
      <Footer />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
