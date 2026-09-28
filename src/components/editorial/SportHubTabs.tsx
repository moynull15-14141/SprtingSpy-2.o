'use client';

import React, { useState } from 'react';

type Tab = 'all' | 'articles' | 'events' | 'guides';

/**
 * Client-side content filter for the sport hub. Every section is rendered on
 * the server and present in the initial HTML; this only toggles visibility.
 */
export function SportHubTabs(props: {
  hero: React.ReactNode;
  ad: React.ReactNode;
  eventsSection: React.ReactNode;
  articlesSection: React.ReactNode;
  guidesSection: React.ReactNode;
  editionsSection: React.ReactNode;
  counts: { all: number; events: number; articles: number; guides: number };
}) {
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const tabClass = (tab: Tab) =>
    `px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
      activeTab === tab
        ? 'bg-amber-700 text-white font-semibold'
        : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200'
    }`;
  const show = (tab: Tab) => activeTab === 'all' || activeTab === tab;

  return (
    <>
      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-8 lg:p-10 shadow-sm">
        {props.hero}

        {/* Quick Hub Filter Bar */}
        <div className="mt-8 pt-6 border-t border-stone-100 dark:border-stone-800/80 flex flex-wrap gap-2">
          <button onClick={() => setActiveTab('all')} className={tabClass('all')}>
            All Content ({props.counts.all})
          </button>
          <button onClick={() => setActiveTab('events')} className={tabClass('events')}>
            Permanent Events ({props.counts.events})
          </button>
          <button onClick={() => setActiveTab('articles')} className={tabClass('articles')}>
            Tournament Articles ({props.counts.articles})
          </button>
          <button onClick={() => setActiveTab('guides')} className={tabClass('guides')}>
            General Guides & Scoring ({props.counts.guides})
          </button>
        </div>
      </div>

      {props.ad}

      {show('events') && props.eventsSection}
      {show('articles') && props.articlesSection}
      {show('guides') && props.guidesSection}
      {props.editionsSection}
    </>
  );
}
