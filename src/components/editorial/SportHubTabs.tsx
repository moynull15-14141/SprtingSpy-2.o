'use client';

import React, { useState } from 'react';

type Tab = 'all' | 'articles' | 'events' | 'guides';

/**
 * Client-side content filter for the sport hub. Every section is rendered on
 * the server and present in the initial HTML; this only toggles visibility.
 * Section order follows Spec §6.2.
 */
export function SportHubTabs(props: {
  hero: React.ReactNode;
  /** Optional decorative image on the right of the header card (fades into the card from the left). */
  backdrop?: React.ReactNode;
  ad: React.ReactNode;
  featuredSection: React.ReactNode;
  upcomingSection: React.ReactNode;
  articlesSection: React.ReactNode;
  eventsSection: React.ReactNode;
  guidesSection: React.ReactNode;
  exploreSection: React.ReactNode;
  faqSection: React.ReactNode;
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
      <div className="relative isolate overflow-hidden rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-6 sm:p-8 lg:p-10 shadow-sm">
        {props.backdrop && (
          // The image fills the right part of the card; a gradient from the card colour (left) to
          // transparent (right) keeps the text readable and leaves the far right of the image clear.
          // On phones the fade stays strong across the whole width so the text remains legible.
          <div aria-hidden="true" data-testid="sport-hero-backdrop" className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-full sm:w-[70%] lg:w-[58%] [&_img]:h-full [&_img]:w-full [&_img]:object-cover [&_picture]:block [&_picture]:h-full">
            {props.backdrop}
            <div className="absolute inset-0 bg-gradient-to-r from-white via-white/75 to-white/0 max-sm:via-white/90 max-sm:to-white/55 dark:from-[#121417] dark:via-[#121417]/75 dark:to-[#121417]/0 max-sm:dark:via-[#121417]/90 max-sm:dark:to-[#121417]/55" />
          </div>
        )}
        {props.hero}

        <div className="mt-8 pt-6 border-t border-stone-100 dark:border-stone-800/80 flex flex-wrap gap-2" role="group" aria-label="Filter this hub">
          <button type="button" aria-pressed={activeTab === 'all'} onClick={() => setActiveTab('all')} className={tabClass('all')}>All content ({props.counts.all})</button>
          <button type="button" aria-pressed={activeTab === 'events'} onClick={() => setActiveTab('events')} className={tabClass('events')}>Events ({props.counts.events})</button>
          <button type="button" aria-pressed={activeTab === 'articles'} onClick={() => setActiveTab('articles')} className={tabClass('articles')}>Event articles ({props.counts.articles})</button>
          <button type="button" aria-pressed={activeTab === 'guides'} onClick={() => setActiveTab('guides')} className={tabClass('guides')}>Guides &amp; information ({props.counts.guides})</button>
        </div>
      </div>

      {props.ad}

      <React.Fragment key="featured">{show('events') && props.featuredSection}</React.Fragment>
      <React.Fragment key="upcoming">{show('events') && props.upcomingSection}</React.Fragment>
      <React.Fragment key="articles">{show('articles') && props.articlesSection}</React.Fragment>
      <React.Fragment key="events">{show('events') && props.eventsSection}</React.Fragment>
      <React.Fragment key="guides">{show('guides') && props.guidesSection}</React.Fragment>
      <React.Fragment key="explore">{activeTab === 'all' && props.exploreSection}</React.Fragment>
      <React.Fragment key="faq">{activeTab === 'all' && props.faqSection}</React.Fragment>
    </>
  );
}
