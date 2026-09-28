/**
 * Site Experience (PHASE F.1): the structured, validated configuration of the
 * site-wide presentation areas editors control from the CMS. Each area is one
 * JSON document with draft / published / scheduled versions (Prisma model
 * SiteExperience). This is a structured news CMS, not a page builder: only
 * the section types, sources, layouts and link kinds below exist.
 */

export const SITE_AREAS = ['homepage', 'navigation', 'footer', 'announcements', 'blocks'] as const;
export type SiteArea = (typeof SITE_AREAS)[number];

// ── Homepage ──
export type AutoSource =
  | { kind: 'latest' }
  | { kind: 'sport'; value: string }
  | { kind: 'event'; value: string } // "<sportSlug>/<eventSlug>"
  | { kind: 'type'; value: string }; // article type (category)

export interface ArticleSource {
  /** manual = only the chosen articles; auto = the query; mixed = chosen first, then the query fills the rest. */
  mode: 'auto' | 'manual' | 'mixed';
  auto: AutoSource;
  articleIds: string[];
}

interface SectionBase { id: string; enabled: boolean }
export const INTRO_STYLES = ['editorial', 'stadium', 'bottom-caption', 'right-focus', 'glass', 'framed', 'split', 'spotlight', 'amber', 'minimal'] as const;
export interface IntroAppearance {
  mediaId: string;
  style: (typeof INTRO_STYLES)[number];
  focalX: number; focalY: number;
  mobileFocalX: number; mobileFocalY: number;
  zoom: number;
  overlay: number;
  height: 'compact' | 'standard' | 'tall';
  textSize: 'compact' | 'standard' | 'large';
  align: 'preset' | 'left' | 'center' | 'right';
  vertical: 'preset' | 'top' | 'center' | 'bottom';
  width: 'narrow' | 'medium' | 'wide';
}
export type HomeSection =
  | (SectionBase & { type: 'intro'; eyebrow: string; title: string; text: string; primaryCta: CtaLink | null; secondaryCta: CtaLink | null; appearance?: IntroAppearance })
  | (SectionBase & { type: 'featured'; label: string; source: ArticleSource; count: number; layout?: 'lead-grid' | 'grid' })
  | (SectionBase & { type: 'articles'; eyebrow: string; title: string; layout: 'lead-grid' | 'grid' | 'list'; source: ArticleSource; count: number; moreLink: CtaLink | null })
  | (SectionBase & { type: 'featuredEvents'; eyebrow: string; title: string; count: number })
  | (SectionBase & { type: 'sportsGrid'; eyebrow: string; title: string })
  | (SectionBase & { type: 'upcomingEditions'; eyebrow: string; title: string; count: number })
  | (SectionBase & { type: 'block'; blockId: string })
  | (SectionBase & { type: 'adSlot'; slot: 'HOMEPAGE_TOP' | 'HOMEPAGE_MIDDLE' });

export type HomeSectionType = HomeSection['type'];
export interface HomepageConfig { sections: HomeSection[] }

export interface CtaLink { label: string; href: string }

// ── Navigation ──
export interface NavItem {
  id: string;
  kind: 'sportsMenu' | 'link';
  label: string;
  /** Shown instead of label in the mobile menu, when set. */
  mobileLabel: string;
  href: string; // ignored for sportsMenu
  icon: 'none' | 'search';
  desktop: boolean;
  mobile: boolean;
  newTab: boolean; // external links only
}
export interface NavigationConfig { items: NavItem[] }

// ── Footer ──
export interface FooterLink { id: string; label: string; href: string; enabled: boolean; kind: 'link' | 'privacyChoices'; system: boolean }
export interface FooterColumn { id: string; title: string; enabled: boolean; kind: 'links' | 'sports'; sportsCount: number; links: FooterLink[] }
export const SOCIAL_PLATFORMS = ['x', 'facebook', 'instagram', 'youtube', 'linkedin', 'bluesky', 'tiktok'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export interface SocialLink { platform: SocialPlatform; url: string; enabled: boolean }
export interface FooterConfig {
  tagline: string;
  notes: string[];
  copyright: string;
  statusText: string;
  columns: FooterColumn[];
  social: SocialLink[];
}

// ── Announcements ──
export interface Announcement {
  id: string;
  enabled: boolean;
  variant: 'breaking' | 'info';
  text: string;
  /** Internal path or https URL, or empty. */
  href: string;
  articleId: string;
  priority: number;
  startAt: string | null; // ISO
  endAt: string | null;
}
export interface AnnouncementsConfig { items: Announcement[] }

// ── Global blocks ──
export const BLOCK_PLACEMENTS = ['homepage', 'article_end', 'sport_top', 'footer_top'] as const;
export type BlockPlacement = (typeof BLOCK_PLACEMENTS)[number];
export interface GlobalBlock {
  id: string;
  name: string; // internal
  type: 'message' | 'cta' | 'featuredStory';
  enabled: boolean;
  title: string;
  text: string;
  cta: CtaLink | null; // cta blocks
  articleId: string; // featuredStory blocks
  placements: BlockPlacement[];
  startAt: string | null;
  endAt: string | null;
}
export interface BlocksConfig { items: GlobalBlock[] }

export interface SiteExperienceDocs {
  homepage: HomepageConfig;
  navigation: NavigationConfig;
  footer: FooterConfig;
  announcements: AnnouncementsConfig;
  blocks: BlocksConfig;
}

/** Areas only Admins may publish/schedule (site structure); the rest Editors may publish too. */
export const ADMIN_ONLY_PUBLISH: SiteArea[] = ['navigation', 'footer'];

/** True when an item with an optional window is live at `now`. */
export const inWindow = (item: { startAt: string | null; endAt: string | null }, now = Date.now()) =>
  (!item.startAt || Date.parse(item.startAt) <= now) && (!item.endAt || Date.parse(item.endAt) > now);
