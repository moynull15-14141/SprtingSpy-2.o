/**
 * SportingSpy Homepage
 *
 * PHASE F.1: the homepage is a list of sections configured in the Site
 * Experience (order, visibility, titles, article sources, layouts). Each
 * section type renders the same markup the fixed homepage used; the default
 * configuration reproduces the original page. Disabled or empty sections are
 * not rendered.
 */

import React from 'react';
import Link from 'next/link';
import { ArticleCard } from '../components/editorial/ArticleCard';
import { EventCard } from '../components/editorial/EventCard';
import { AdSlot } from '../components/ui/AdSlot';
import { JsonLd } from '../components/seo/JsonLd';
import { GlobalBlock } from '../components/site/GlobalBlocks';
import { SiteLink } from '../components/site/SiteLink';
import { IntroBanner } from '../components/site/IntroBanner';
import { SportIcon } from '../components/ui/SportIcon';
import { BRANDING } from '../config/branding';
import { absoluteUrl } from '../lib/paths';
import type { ResolvedSection } from '../../server/services/public/siteLayout';
import type { HomeSection } from '../lib/siteExperience/types';
import { HOMEPAGE_H1 } from '../lib/siteExperience/defaults';

const eyebrowClass = 'text-xs uppercase tracking-wider font-bold text-amber-700 dark:text-amber-500';
const titleClass = 'font-serif text-2xl sm:text-3xl font-bold text-stone-900 dark:text-stone-100';

function SectionHeader({ id, eyebrow, title, link }: { id: string; eyebrow: string; title: string; link?: { label: string; href: string } | null }) {
  return (
    <div className="flex items-end justify-between mb-6 pb-2 border-b border-stone-200 dark:border-stone-800">
      <div>
        {eyebrow && <span className={eyebrowClass}>{eyebrow}</span>}
        <h2 id={`${id}-heading`} className={titleClass}>{title}</h2>
      </div>
      {link && (
        <SiteLink href={link.href} className="text-xs font-semibold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer">
          {link.label} &rarr;
        </SiteLink>
      )}
    </div>
  );
}

function Section({ section, firstHeading }: { section: ResolvedSection; firstHeading: boolean }) {
  switch (section.type) {
    case 'adSlot':
      return <AdSlot id={section.slot} />;

    case 'block':
      return <GlobalBlock block={section.block} />;

    case 'intro':
      return <IntroBanner section={section.section} image={section.image} firstHeading={firstHeading} />;

    case 'featured': {
      const s = section.section as Extract<HomeSection, { type: 'featured' }>;
      const [lead, ...others] = section.articles;
      return (
        <section data-section={s.id} aria-label={s.label || 'Featured stories'}>
          {s.label && <p className={`${eyebrowClass} mb-3`}>{s.label}</p>}
          {s.layout === 'grid' ? <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">{section.articles.map((a) => <ArticleCard key={a.id} article={a} variant="standard" />)}</div> : <>
          <div className="mb-6"><ArticleCard article={lead} variant="lead" /></div>
          {others.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {others.map((a) => <ArticleCard key={a.id} article={a} variant="standard" />)}
            </div>
          )}
          </>}
        </section>
      );
    }

    case 'articles': {
      const s = section.section as Extract<HomeSection, { type: 'articles' }>;
      const link = s.moreLink ? { label: `${s.moreLink.label}${section.total ? ` (${section.total})` : ''}`, href: s.moreLink.href } : null;
      if (s.layout === 'lead-grid') {
        const [leadArticle, ...rest] = section.articles;
        const secondary = rest.slice(0, 3), compact = rest.slice(3);
        return (
          <section data-section={s.id} aria-labelledby={`${s.id}-heading`}>
            <SectionHeader id={s.id} eyebrow={s.eyebrow} title={s.title} link={link} />
            {leadArticle && <div className="mb-8"><ArticleCard article={leadArticle} variant="lead" /></div>}
            {rest.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {secondary.map((a) => <ArticleCard key={a.id} article={a} variant="standard" />)}
                </div>
                <div className="lg:col-span-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-stone-900 dark:text-stone-200 mb-4 pb-2 border-b border-stone-100 dark:border-stone-800">Quick Editorial Reference</h3>
                  <div className="divide-y divide-stone-100 dark:divide-stone-800/80">
                    {compact.length > 0
                      ? compact.map((a) => <ArticleCard key={a.id} article={a} variant="compact" />)
                      : <p className="text-xs text-stone-500 py-3 dark:text-stone-400">Explore additional sport sections below.</p>}
                  </div>
                  {s.moreLink && (
                    <SiteLink href={s.moreLink.href} className="block w-full mt-4 py-2 text-xs font-semibold text-center text-stone-700 dark:text-stone-300 hover:text-amber-600 dark:hover:text-amber-400 border border-stone-200 dark:border-stone-800 rounded-lg hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors">
                      Browse Full Editorial Archive &rarr;
                    </SiteLink>
                  )}
                </div>
              </div>
            )}
          </section>
        );
      }
      return (
        <section data-section={s.id} aria-labelledby={`${s.id}-heading`}>
          <SectionHeader id={s.id} eyebrow={s.eyebrow} title={s.title} link={link} />
          {s.layout === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {section.articles.map((a) => <ArticleCard key={a.id} article={a} variant="standard" />)}
            </div>
          ) : (
            <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] px-5 divide-y divide-stone-100 dark:divide-stone-800/80">
              {section.articles.map((a) => <ArticleCard key={a.id} article={a} variant="compact" />)}
            </div>
          )}
        </section>
      );
    }

    case 'featuredEvents': {
      const s = section.section;
      return (
        <section data-section={s.id} aria-labelledby={`${s.id}-heading`}>
          <SectionHeader id={s.id} eyebrow={s.eyebrow} title={s.title} link={{ label: 'All Permanent Events', href: '/events/' }} />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {section.events.map((evt) => <EventCard key={evt.id} event={evt} />)}
          </div>
        </section>
      );
    }

    case 'sportsGrid': {
      const s = section.section;
      return (
        <section data-section={s.id} aria-labelledby={`${s.id}-heading`}>
          <SectionHeader id={s.id} eyebrow={s.eyebrow} title={s.title} link={{ label: 'Full Sports Directory', href: '/sports/' }} />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {section.sports.map((sp) => (
              <Link key={sp.id} href={`/${sp.slug}/`} className="group p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] hover:border-amber-500/60 dark:hover:border-amber-500/60 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs text-stone-500 mb-2 dark:text-stone-400">
                    <SportIcon slug={sp.slug} name={sp.name} icon={sp.icon} size="lg" />
                    <span className="tabular-nums font-mono text-[11px]">{sp.eventCount} {sp.eventCount === 1 ? 'Event' : 'Events'}</span>
                  </div>
                  <h3 className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">{sp.name}</h3>
                  <p className="mt-1.5 text-xs text-stone-600 dark:text-stone-400 line-clamp-2 leading-relaxed">{sp.tagline}</p>
                </div>
                <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800/80 flex items-center justify-between text-[11px] text-stone-500 dark:text-stone-400">
                  <span>{sp.articleCount} Articles</span>
                  <span className="group-hover:translate-x-1 transition-transform text-amber-700 dark:text-amber-400 font-semibold">Explore &rarr;</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      );
    }

    case 'upcomingEditions': {
      const s = section.section;
      return (
        <section data-section={s.id} aria-labelledby={`${s.id}-heading`} className="rounded-2xl bg-stone-100 dark:bg-stone-900/60 p-6 sm:p-8 border border-stone-200 dark:border-stone-800">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-6 pb-2 border-b border-stone-200 dark:border-stone-800 gap-2">
            <div>
              {s.eyebrow && <span className={eyebrowClass}>{s.eyebrow}</span>}
              <h2 id={`${s.id}-heading`} className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">{s.title}</h2>
            </div>
            <span className="text-xs text-stone-600 dark:text-stone-400">Official tournament dates & session matrices</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {section.editions.map((ed) => (
              <Link key={ed.id} href={ed.url} className="group p-5 rounded-xl bg-white dark:bg-[#121417] border border-stone-200 dark:border-stone-800 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs text-amber-700 dark:text-amber-500 font-semibold mb-2">
                    <span>{ed.sportName}</span>
                    <span className="font-mono text-stone-500 text-[11px] dark:text-stone-400">{ed.status.toUpperCase()}</span>
                  </div>
                  <h3 className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">{ed.title}</h3>
                  <div className="mt-3 space-y-1 text-xs text-stone-600 dark:text-stone-400">
                    {(ed.startDate || ed.endDate) && <p className="tabular-nums"><strong className="text-stone-800 dark:text-stone-200">{ed.startDate && ed.endDate ? 'Dates:' : ed.startDate ? 'Start:' : 'End:'}</strong> {ed.startDate && ed.endDate ? `${ed.startDate} to ${ed.endDate}` : ed.startDate || ed.endDate}</p>}
                    {ed.venue && <p><strong className="text-stone-800 dark:text-stone-200">Venue:</strong> {ed.venue}</p>}
                    {ed.prizeMoneyTotal && <p className="tabular-nums"><strong className="text-stone-800 dark:text-stone-200">Purse:</strong> {ed.prizeMoneyTotal}</p>}
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800 flex items-center justify-between text-xs font-semibold text-amber-700 dark:text-amber-400">
                  <span>View Edition Guide</span>
                  <span>&rarr;</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      );
    }
  }
}

export const HomePage: React.FC<{ sections: ResolvedSection[]; identity?: { name: string; description: string } }> = ({ sections, identity = { name: BRANDING.name, description: BRANDING.description } }) => {
  // Schema.org Organization + WebSite (Spec §15); name/description from Admin → Settings (PHASE H).
  const structuredData = [
    { '@context': 'https://schema.org', '@type': 'Organization', name: identity.name, url: absoluteUrl('/'), description: identity.description },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: identity.name, url: absoluteUrl('/') },
  ];
  const firstIntro = sections.find((s) => s.type === 'intro')?.id;
  const hasH1 = !!firstIntro;

  return (
    <div className="space-y-12">
      <JsonLd data={structuredData} />
      {/* Without an intro section the page still has exactly one <h1> (Spec v1.1 §7.1 wording). */}
      {!hasH1 && <h1 className="sr-only">{HOMEPAGE_H1}</h1>}
      {sections.map((s) => <Section key={s.id} section={s} firstHeading={s.id === firstIntro} />)}
    </div>
  );
};
