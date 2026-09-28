/**
 * SportingSpy Domain Types & Data Contracts
 * Defines the core hierarchical domain:
 * SPORT -> EVENT -> EVENT EDITION -> ARTICLE
 */

export type Role = 'Admin' | 'Editor' | 'Author' | 'Reader';

// Spec v1.1 §5: the standard article types. "How to Watch" is one normal
// type; there are deliberately no "viewing/streaming/TV guide" variants.
export const ARTICLE_TYPES = [
  'Event Guide',
  'Schedule',
  'Results',
  'How to Watch',
  'Preview',
  'Update',
  'News',
  'Past Winners',
  'Records',
  'Prize Money',
  'Players',
  'Teams',
  'Venue',
  'Qualification',
  'Rules & Format',
  'History',
  'Analysis',
  'General Information',
  'Other',
] as const;

export type ArticleType = (typeof ARTICLE_TYPES)[number];

// Spec v1.1 §4.3: Event Edition lifecycle.
export const EDITION_STATUSES = ['upcoming', 'active', 'completed', 'archived'] as const;

export type EditionStatus = (typeof EDITION_STATUSES)[number];

export interface SeoMetadata {
  metaTitle?: string;
  metaDescription?: string;
  canonicalUrl?: string;
  keywords?: string[];
  noIndex?: boolean;
  // Social metadata (Spec v1.1 §4.4). Each falls back to the SEO title /
  // description / featured image when empty. Twitter/X reads these same
  // Open Graph values, so no separate twitter* fields are stored.
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
}

export interface Sport {
  id: string;
  slug: string; // e.g. "tennis"
  name: string; // e.g. "Tennis"
  tagline: string;
  description: string;
  order: number;
  isVisible: boolean;
  featuredEventIds: string[];
  colorTheme?: string;
  heroImage?: string;
  seo: SeoMetadata;
  /** Chosen from src/config/sportIcons.ts; null/undefined = suggested from the name. */
  icon?: string | null;
}

export interface SportEvent {
  id: string;
  sportSlug: string; // e.g. "tennis"
  slug: string; // e.g. "french-open"
  name: string; // e.g. "French Open"
  shortName: string; // e.g. "Roland-Garros"
  description: string;
  history?: string;
  frequency: string; // e.g. "Annual (May-June)"
  defaultVenue: string; // e.g. "Stade Roland Garros"
  defaultLocation: string; // e.g. "Paris, France"
  currentEditionYear: number; // e.g. 2027
  allEditionYears: number[]; // e.g. [2027, 2026, 2025]
  featured: boolean;
  isVisible: boolean;
  featuredImage?: string;
  officialSourceUrl?: string; // official event website/source (Spec v1.1 §4.2)
  eventType?: string; // e.g. "Grand Slam", "League", "Major", "Grand Prix"
  seo: SeoMetadata;
}

export interface QuickFact {
  label: string;
  value: string;
}

export interface EventEdition {
  id: string; // e.g. "french-open-2027"
  eventSlug: string; // e.g. "french-open"
  sportSlug: string; // e.g. "tennis"
  year: number; // e.g. 2027
  title: string; // e.g. "2027 French Open"
  startDate: string; // ISO date e.g. "2027-05-23"
  endDate: string; // ISO date e.g. "2027-06-06"
  venue: string; // e.g. "Stade Roland Garros"
  location: string; // e.g. "Paris, France"
  status: EditionStatus;
  quickFacts: QuickFact[];
  prizeMoneyTotal?: string; // e.g. "€53,500,000"
  defendingChampions?: {
    category: string;
    name: string;
  }[];
  qualificationInfo?: string;
  participantsCount?: number;
  officialSourceUrl?: string;
  description: string;
  featuredImage: string;
  seo: SeoMetadata;
}

export interface StructuredTable {
  title: string;
  headers: string[];
  rows: string[][];
  caption?: string;
}

export interface Article {
  id: string;
  slug: string; // e.g. "schedule" or "tennis-scoring"
  title: string;
  subtitle?: string;
  sportSlug: string;
  eventSlug?: string; // Optional: articles can belong directly to sport
  editionYear?: number; // Optional: general articles or event-level articles
  articleType: ArticleType;
  excerpt: string;
  content: string; // rich markdown / structured editorial HTML
  featuredImage: string;
  authorId: string;
  publishedAt: string; // ISO date
  updatedAt?: string;
  /** Last explicit editorial freshness review; does not pretend content changed. */
  reviewedAt?: string;
  scheduledFor?: string; // ISO date for scheduled publication
  status: 'draft' | 'preview' | 'scheduled' | 'published' | 'archived';
  readingTimeMinutes: number;
  featured?: boolean;
  tables?: StructuredTable[];
  references?: { title: string; url: string }[];
  seo: SeoMetadata;
  /** PHASE C: rich-text body (see src/lib/richText.ts); null/absent = legacy plain-text `content`. */
  body?: import('../lib/richText').RichDoc | null;
  /** PHASE C: featured image as a Media Library item. */
  featuredMediaId?: string | null;
}

export interface Author {
  id: string;
  slug: string;
  name: string;
  roleTitle: string; // e.g. "Chief Tennis Correspondent"
  bio: string;
  avatar: string;
  twitter?: string;
  email?: string;
  articleCount?: number;
  // Phase 1 (Authentication & Staff Identity): links this public-facing byline
  // to the staff User account allowed to edit its articles. `undefined` means
  // "not yet checked by the migration"; `null` means "checked, no matching
  // staff account exists" (a byline with no login, e.g. a freelance credit).
  // This is the smallest clean Author<->User relationship, designed to become
  // a straightforward foreign key once a real database exists.
  userId?: string | null;
}

// Phase 1: staff account status. Deactivated staff can no longer log in or
// hold a session, but their historical audit/content attribution is preserved.
export type UserStatus = 'active' | 'inactive';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatar: string;
  joinedAt: string; // acts as this account's createdAt
  updatedAt?: string;
  status?: UserStatus; // defaults to 'active' via server-side migration if absent
  // Server-only. NEVER sent to the client — see server/password.ts and the
  // sanitizeUser() serializer in server.ts, which strips this before any
  // response leaves the server. Optional so this shared type can still
  // describe the safe, client-facing shape of a User.
  passwordHash?: string;
}

/** The client-safe projection of User — never carries passwordHash. */
export type SafeUser = Omit<User, 'passwordHash'>;

export type AccountProfile = SafeUser & { authorProfile: Pick<Author, 'id' | 'slug' | 'name' | 'roleTitle' | 'bio' | 'avatar' | 'twitter' | 'email'> | null };
export interface AccountSession {
  reference: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

// Phase 1: a server-side session record, persisted in data/db.json (sessions
// collection) so logins survive a server restart. The cookie sent to the
// browser holds ONLY this record's `id` (a random opaque token) — never the
// userId or role directly — so the server remains the sole source of truth
// for who a session belongs to and what they're allowed to do.
export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface Comment {
  id: string;
  articleId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  userRole?: Role;
  content: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
}

export type MediaCreationType =
  | 'Original'
  | 'AI-created'
  | 'AI-assisted'
  | 'Licensed'
  | 'Official Source'
  | 'Creative Commons'
  | 'Other';

export type CopyrightReview = 'pending' | 'reviewed' | 'restricted';

export interface MediaItem {
  id: string;
  title: string;
  url: string;
  altText: string;
  caption?: string | null;
  credit?: string | null;
  source?: string | null;
  /** Spec §16 "License/Usage Notes". */
  license?: string | null;
  creationType: MediaCreationType;
  uploadedAt: string;
  fileSize?: string | null;
  dimensions?: string | null;
  // PHASE C: stored file (null for URL-only items)
  storageKey?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | null;
  variants?: import('../lib/media').MediaVariant[] | null;
  // PHASE C: Spec §16 metadata
  aiTool?: string | null;
  humanEditing?: string | null;
  copyrightReview: CopyrightReview;
  updatedAt?: string | null;
}

/** PHASE C: where a media item is used. */
export interface MediaUsage {
  kind: 'article' | 'event' | 'edition' | 'sport' | 'site';
  id: string;
  title: string;
  role: 'featured' | 'body' | 'image';
}

export type AdSlotId =
  | 'ARTICLE_TOP'
  | 'ARTICLE_MIDDLE'
  | 'ARTICLE_BOTTOM'
  | 'SIDEBAR_TOP'
  | 'SIDEBAR_MIDDLE'
  | 'HOMEPAGE_TOP'
  | 'HOMEPAGE_MIDDLE'
  | 'EVENT_TOP'
  | 'EVENT_BOTTOM';

export interface AdSlotConfig {
  id: AdSlotId;
  name: string;
  placementDescription: string;
  enabled: boolean;
  sponsorName?: string;
  bannerText?: string;
  linkUrl?: string;
  dimensions: string; // e.g. "728x90" or "300x250"
  /** PHASE F: "house" = sponsor/partner banner (no third party); "adsense" = Google AdSense unit (advertising consent required). */
  provider?: AdProvider;
  /** The provider's ad unit ID (AdSense: numeric data-ad-slot). */
  providerSlotId?: string | null;
  creativeId?: string | null;
  creative?: AdCreative | null;
  creativeAlt?: string | null;
  creativeFit?: string;
}

export interface AdCreative {
  id: string; title: string; url: string; kind: string; mimeType: string;
  width: number; height: number; sizeBytes: number; durationSeconds?: number | null;
}

export const AD_PROVIDERS = ['house', 'adsense'] as const;
export type AdProvider = (typeof AD_PROVIDERS)[number];

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  entityType: 'Sport' | 'Event' | 'Edition' | 'Article' | 'Comment' | 'Setting' | 'User' | 'Author' | 'Redirect';
  entityId: string;
  timestamp: string;
  details: string;
}

export interface RedirectRule {
  id: string;
  sourceUrl: string;
  targetUrl: string;
  statusCode: 301 | 302;
  createdAt: string;
  isActive: boolean;
  /** PHASE C: "manual" or "article-slug" (automatic on article URL change). */
  origin?: 'manual' | 'article-slug';
  notes?: string | null;
  updatedAt?: string | null;
}

// Launch feature flags, decided server-side from environment variables and
// sent to the client for display only. The server enforces every flag
// independently; flipping these in the browser cannot enable anything.
export interface FeatureFlags {
  readerAccounts: boolean;
  comments: boolean;
}
