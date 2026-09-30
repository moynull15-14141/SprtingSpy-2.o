'use client';

/**
 * The editorial CMS, mounted only at /admin (PHASE B). It is a client-heavy
 * area by design: interactive forms over the staff-only CMS dataset. The
 * access gate is a UX guard; every CMS read and write is authorized by the
 * server regardless of what this bundle does.
 */

import React from 'react';
import { AppProvider } from '../../context/AppContext';
import { AdminAccessGate } from './AdminAccessGate';
import { AdminLayout } from './AdminLayout';
import { AdminDashboard } from './AdminDashboard';
import { AdminArticles } from './AdminArticles';
import { AdminSports } from './AdminSports';
import { AdminEvents } from './AdminEvents';
import { AdminComments } from './AdminComments';
import { AdminMedia } from './AdminMedia';
import { AdminAds } from './AdminAds';
import { AdminSeoAudit } from './AdminSeoAudit';
import { AdminAuditLogs } from './AdminAuditLogs';
import { AdminAuthors } from './AdminAuthors';
import { AdminUsers } from './AdminUsers';
import { AdminRedirects } from './AdminRedirects';
import { AdminSettings } from './AdminSettings';
import { AdminSiteExperience } from './site/AdminSiteExperience';
import { AdminFaq } from './AdminFaq';
import { AdminInbox } from './AdminInbox';

export function AdminApp() {
  return (
    <div data-admin-shell className="min-w-0">
    <AdminAccessGate>
      <AppProvider>
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
                return <AdminSeoAudit setActiveTab={setActiveTab} />;
              case 'redirects':
                return <AdminRedirects />;
              case 'audit':
                return <AdminAuditLogs />;
              case 'settings':
                return <AdminSettings />;
              case 'site':
                return <AdminSiteExperience />;
              case 'faq':
                return <AdminFaq />;
              case 'inbox':
                return <AdminInbox />;
              default:
                return <AdminDashboard setActiveTab={setActiveTab} />;
            }
          }}
        </AdminLayout>
      </AppProvider>
    </AdminAccessGate>
    </div>
  );
}
