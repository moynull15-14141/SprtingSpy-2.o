/**
 * Default Site Experience documents (PHASE F.1). They reproduce the site as
 * it was before the Control Center existed, and are used whenever an area
 * has never been published or its stored document fails validation — so a
 * configuration problem can never take the public site down.
 */

import { BRANDING } from '../../config/branding';
import type { SiteExperienceDocs } from './types';

/** Spec v1.1 §7.1: the homepage H1 (PHASE H). */
export const HOMEPAGE_H1 = 'Latest Sports News & Events';
/** Spec v1.1 §7.1: short multi-sport introduction under the H1 (PHASE H). */
export const HOMEPAGE_INTRO =
  'Schedules, results, event guides and how-to-watch information across tennis, motorsport, golf, rugby, football and more — organised by sport, event and edition.';

/** The pre-Phase-H intro wording, used only to recognise an unedited homepage intro. */
export const LEGACY_HOMEPAGE_INTRO = {
  title: 'Authoritative sporting guides, verified schedules, and championship editions.',
  text: 'Independent, data-verified sports journalism across 12 core athletic disciplines. No automated clickbait—only structured tournament dossiers, venue mechanics, and rules analysis.',
  secondaryCtaLabel: 'Browse All 12 Sports',
};

export const DEFAULT_SITE_EXPERIENCE: SiteExperienceDocs = {
  homepage: {
    sections: [
      { id: 'ad-top', type: 'adSlot', enabled: true, slot: 'HOMEPAGE_TOP' },
      {
        id: 'intro', type: 'intro', enabled: true,
        eyebrow: 'Multi-Sport Intelligence Hub · Archival & Current Staging',
        title: HOMEPAGE_H1,
        text: HOMEPAGE_INTRO,
        primaryCta: { label: 'Explore Major Events', href: '/events/' },
        secondaryCta: { label: 'Browse All Sports', href: '/sports/' },
      },
      {
        id: 'latest', type: 'articles', enabled: true, eyebrow: 'Editorial Wire', title: 'Latest Analysis & Guides', layout: 'lead-grid',
        source: { mode: 'auto', auto: { kind: 'latest' }, articleIds: [] }, count: 8, moreLink: { label: 'View All Articles', href: '/latest/' },
      },
      { id: 'ad-middle', type: 'adSlot', enabled: true, slot: 'HOMEPAGE_MIDDLE' },
      { id: 'events', type: 'featuredEvents', enabled: true, eyebrow: 'Permanent Sporting Institutions', title: 'Iconic Global Events', count: 8 },
      { id: 'sports', type: 'sportsGrid', enabled: true, eyebrow: 'Comprehensive Coverage', title: 'Explore by Sport' },
      { id: 'upcoming', type: 'upcomingEditions', enabled: true, eyebrow: 'Calendar & Timetables', title: 'Upcoming Championship Staging', count: 3 },
    ],
  },
  navigation: {
    items: [
      { id: 'sports', kind: 'sportsMenu', label: 'Sports', mobileLabel: 'All Sports Directory', href: '/sports/', icon: 'none', desktop: true, mobile: true, newTab: false },
      { id: 'events', kind: 'link', label: 'Events', mobileLabel: 'Major Events', href: '/events/', icon: 'none', desktop: true, mobile: true, newTab: false },
      { id: 'latest', kind: 'link', label: 'Latest', mobileLabel: 'Latest Articles', href: '/latest/', icon: 'none', desktop: true, mobile: true, newTab: false },
      { id: 'search', kind: 'link', label: 'Search', mobileLabel: 'Search Database', href: '/search/', icon: 'search', desktop: true, mobile: true, newTab: false },
    ],
  },
  footer: {
    tagline: BRANDING.description,
    notes: ['Independent multi-sport editorial publication.', 'Manual journalistic curation · No automated live score feeds.'],
    copyright: `© ${BRANDING.foundedYear} ${BRANDING.name}. All sports data and editorial assets maintained for archival and informational reference.`,
    statusText: 'Editorial System Online',
    columns: [
      {
        id: 'sports', title: 'Sports Hubs', enabled: true, kind: 'sports', sportsCount: 6,
        links: [{ id: 'all-sports', label: 'All 12+ Sports →', href: '/sports/', enabled: true, kind: 'link', system: false }],
      },
      {
        id: 'editorial', title: 'Editorial', enabled: true, kind: 'links', sportsCount: 0,
        links: [
          { id: 'events', label: 'Permanent Events Index', href: '/events/', enabled: true, kind: 'link', system: false },
          { id: 'latest', label: 'Latest Editorial Articles', href: '/latest/', enabled: true, kind: 'link', system: false },
          { id: 'search', label: 'Search & Reference', href: '/search/', enabled: true, kind: 'link', system: false },
          { id: 'about', label: 'About SportingSpy', href: '/about/', enabled: true, kind: 'link', system: true },
          { id: 'contact', label: 'Contact Editorial Bureau', href: '/contact/', enabled: true, kind: 'link', system: true },
          { id: 'faq', label: 'FAQ', href: '/faq/', enabled: true, kind: 'link', system: false },
        ],
      },
      {
        id: 'legal', title: 'Legal & Standards', enabled: true, kind: 'links', sportsCount: 0,
        links: [
          { id: 'privacy', label: 'Privacy Policy', href: '/privacy-policy/', enabled: true, kind: 'link', system: true },
          { id: 'privacy-choices', label: 'Privacy choices', href: '', enabled: true, kind: 'privacyChoices', system: true },
          { id: 'terms', label: 'Terms of Service', href: '/terms-and-conditions/', enabled: true, kind: 'link', system: true },
          { id: 'dmca', label: 'DMCA & Copyright', href: '/dmca/', enabled: true, kind: 'link', system: true },
        ],
      },
    ],
    social: [
      { platform: 'x', url: BRANDING.socials.xTwitter, enabled: false },
      ...(BRANDING.socials.bluesky ? [{ platform: 'bluesky' as const, url: BRANDING.socials.bluesky, enabled: false }] : []),
      ...(BRANDING.socials.youtube ? [{ platform: 'youtube' as const, url: BRANDING.socials.youtube, enabled: false }] : []),
      ...(BRANDING.socials.instagram ? [{ platform: 'instagram' as const, url: BRANDING.socials.instagram, enabled: false }] : []),
    ],
  },
  announcements: { items: [] },
  blocks: { items: [] },
};
