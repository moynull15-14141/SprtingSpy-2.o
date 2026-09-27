# SPORTINGSPY.COM — DEVELOPER HANDOFF & ARCHITECTURAL SPECIFICATION

## 1. Executive Summary & Vision

**SportingSpy.com** is a professional, multi-sport sports information and editorial platform. It delivers structured tournament dossiers, permanent event archives, verified yearly editions, session-by-session schedules, prize money tables, broadcast guides, and tactical rules analyses across global athletics.

### Key Architectural Principle
```
SPORT ──> PERMANENT EVENT ──> EVENT EDITION ──> ARTICLE
  └──> General Sport Guides (Rules, Formats, Scoring)
```

SportingSpy explicitly rejects the generic single-sport or live-score dashboard paradigm. It is **NOT** a live score ticker, live commentary blog, streaming host, podcast player, or social network.

---

## 2. Project File Structure

```
/
├── index.html                   # HTML entry point with Newsreader/Cinzel/Plus Jakarta Sans fonts & meta SEO
├── metadata.json                # AI Studio application metadata
├── package.json                 # React 19, Vite, Tailwind CSS v4, Lucide
├── tsconfig.json                # Strict TypeScript configuration
├── public/
│   ├── robots.txt               # Public search engine directives with sitemap reference
│   └── sitemap.xml              # XML Sitemap covering sports, events, editions, articles, authors
├── DEVELOPER_HANDOFF.md         # Comprehensive handoff guide for subsequent AI agents & engineers
├── src/
│   ├── assets/images/           # High-resolution sports editorial imagery generated via AI Studio tools
│   ├── config/
│   │   ├── assets.ts            # Central asset path registry
│   │   └── branding.ts          # Central replaceable branding (logos, taglines, fonts, colors)
│   ├── context/
│   │   └── AppContext.tsx       # Central state store, 301/302 redirect router, reactive CRUD & permission switcher
│   ├── data/
│   │   └── seedData.ts          # Initial seed data for 12 sports, events, editions, articles, and redirects
│   ├── types/
│   │   └── index.ts             # Strict TypeScript domain interfaces (Sport, Event, Edition, Article, Author, User, etc.)
│   ├── components/
│   │   ├── ui/                  # SportingSpy Design System primitives
│   │   │   ├── Button.tsx       # Single-line button with focus rings & variants
│   │   │   ├── MetadataRow.tsx  # Zero-pill unboxed text metadata with separators (·)
│   │   │   ├── Breadcrumbs.tsx  # Hierarchical breadcrumbs with Schema.org BreadcrumbList
│   │   │   ├── StructuredTable.tsx # Tabular figures (tabular-nums) for prize money, schedules, telemetry
│   │   │   └── AdSlot.tsx       # Reserved-height CLS-free ad slot architecture (Default: ADS = OFF)
│   │   ├── layout/
│   │   │   ├── Header.tsx       # 3-Zone Top Bar Contract with Mega Discovery menu & Role Switcher
│   │   │   ├── Footer.tsx       # Editorial footer with legal compliance and discipline directories
│   │   │   └── SeoHead.tsx      # Dynamic SEO document titles, meta descriptions, OpenGraph, JSON-LD
│   │   ├── editorial/
│   │   │   ├── ArticleCard.tsx  # Lead, standard (4:3), and compact archive tier cards
│   │   │   ├── EventCard.tsx    # Permanent event cards
│   │   │   └── CommentsSection.tsx # Moderated reader commenting with staff badge recognition
│   │   └── admin/               # Full Editorial CMS Console (/admin)
│   │       ├── AdminLayout.tsx  # 2-column sidebar console layout with desk badges
│   │       ├── AdminDashboard.tsx # Real-time metrics and publishing shortcuts
│   │       ├── AdminArticles.tsx # 10-step article workflow supporting all statuses (draft, preview, scheduled, published, archived)
│   │       ├── AdminSports.tsx  # Dynamic sports manager (hide/show, reorder, create/edit/delete sports)
│   │       ├── AdminEvents.tsx  # Permanent events & staged edition dossiers (Full CRUD)
│   │       ├── AdminAuthors.tsx # Byline correspondents, credentials, beats, and avatars
│   │       ├── AdminUsers.tsx   # User Accounts & RBAC role switcher (Admin, Editor, Author, Reader)
│   │       ├── AdminRedirects.tsx # 301/302 Redirect rules engine with VPS Nginx config export
│   │       ├── AdminComments.tsx # Queue for reader comments (Approve/Reject/Delete)
│   │       ├── AdminMedia.tsx   # Media library with licensing & creation provenance tags
│   │       ├── AdminAds.tsx     # Ad slot toggle & direct partner sponsorships
│   │       ├── AdminSeoAudit.tsx # SEO diagnostics, entity checklist, and character limits
│   │       └── AdminAuditLogs.tsx # Chronological system audit trail
│   ├── pages/
│   │   ├── HomePage.tsx         # Multi-sport homepage (Lead story + 12 sports + events)
│   │   ├── SportPage.tsx        # Topic hub for individual disciplines
│   │   ├── EventPage.tsx        # Permanent event hub (history, venue, past editions)
│   │   ├── EventEditionPage.tsx # Specific annual staging dossier with sport-specific quick facts
│   │   ├── ArticlePage.tsx      # Unified editorial reading canvas (all 18 article types + draft/preview support)
│   │   ├── SportsDirectoryPage.tsx # Catalog of all sports
│   │   ├── EventsDirectoryPage.tsx # Catalog of all permanent events
│   │   ├── LatestArticlesPage.tsx  # Paginated chronological publishing wire
│   │   ├── SearchPage.tsx       # Multi-criteria search across sports, events, editions, and types
│   │   ├── AuthorPage.tsx       # Author biography and published articles archive
│   │   └── StaticPages.tsx      # About, Contact, Privacy, Terms, DMCA
│   ├── App.tsx                  # Master routing resolution following the exact URL philosophy
│   ├── index.css                # Tailwind v4 setup with custom editorial typography layers
│   └── main.tsx                 # React DOM mount
```

---

## 3. URL Philosophy & Route Resolution

SportingSpy implements short, human-readable, lowercase, hyphenated URLs without unnecessary numeric IDs:

| Route Pattern | Example | Component Rendered | Purpose |
|---|---|---|---|
| `/` | `/` | `HomePage` | Primary multi-sport editorial homepage |
| `/{sport}` | `/tennis` | `SportPage` | Discipline topic hub (events, guides, articles) |
| `/{sport}/{event}` | `/tennis/french-open` | `EventPage` | Permanent event hub & history |
| `/{sport}/{event}/{year}` | `/tennis/french-open/2027` | `EventEditionPage` | Specific annual staging dossier & quick facts |
| `/{sport}/{event}/{year}/{slug}` | `/tennis/french-open/2027/schedule` | `ArticlePage` | Article belonging to a specific edition |
| `/{sport}/{slug}` | `/tennis/tennis-scoring` | `ArticlePage` | General article belonging directly to a sport |
| `/sports` | `/sports` | `SportsDirectoryPage` | Comprehensive catalog of all sports |
| `/events` | `/events` | `EventsDirectoryPage` | Catalog of all permanent events |
| `/latest` | `/latest` | `LatestArticlesPage` | Paginated chronological publishing wire |
| `/search` | `/search` | `SearchPage` | Search across articles, events, and sports |
| `/author/{slug}` | `/author/alistair-vance` | `AuthorPage` | Author bio and published bibliography |
| `/about`, `/contact`, `/privacy`, `/terms`, `/dmca` | `/about` | `StaticPages` | Institutional and legal compliance documents |
| `/admin` | `/admin` | `AdminLayout` | Editorial CMS console with 12 desks |

---

## 4. Design System & Anti-Slop Discipline

The design system is governed by the Universal Frontend Design Constitution:
1. **Zero-Pill Discipline**: Metadata (categories, dates, reading times, bylines) is rendered as clean unboxed text with subtle typographic separators (`·` or `/`). Never wrapped in rounded colored capsules or chips.
2. **Typography Pairing**:
   - Display & Brand: `Cinzel` & `Newsreader` (high-character editorial serif)
   - Body Prose: `Plus Jakarta Sans` (refined readability at 1.75 line-height, constrained measure)
   - Telemetry & Numbers: `JetBrains Mono` and `tabular-nums` for dates, prize money, scores, and timetables.
3. **60-30-10 Color Budget**:
   - 60% Dominant Neutral Canvas (`#fbf9f5` in Light mode, `#0c0d0e` in Dark mode)
   - 30% Structural Surfaces (`#ffffff` / `#121417` with subtle hairline stone dividers)
   - 10% Warm Amber Accent (`#d97706` / `#f59e0b`) strictly for active states, key CTAs, and editorial highlights.
4. **Top Bar Contract**: Strict 1-row, 3-zone contract:
   `[Brand Title (SportingSpy)] — [4–6 Nav Links (Sports, Events, Latest, Search, CMS)] — [Theme Toggle + User Role Switcher]`.

---

## 5. Domain Model & Entities

- **Sport**: `id`, `slug`, `name`, `tagline`, `description`, `order`, `isVisible`, `seo`.
- **SportEvent**: `id`, `sportSlug`, `slug`, `name`, `shortName`, `description`, `history`, `frequency`, `defaultVenue`, `defaultLocation`, `currentEditionYear`, `allEditionYears`, `featured`, `isVisible`, `seo`.
- **EventEdition**: `id`, `eventSlug`, `sportSlug`, `year`, `title`, `startDate`, `endDate`, `venue`, `location`, `status`, `quickFacts` (flexible sport-calibrated key-value pairs), `prizeMoneyTotal`, `defendingChampions`, `qualificationInfo`, `officialSourceUrl`, `seo`.
- **Article**: `id`, `slug`, `title`, `subtitle`, `sportSlug`, `eventSlug?`, `editionYear?`, `articleType` (18 types), `excerpt`, `content`, `featuredImage`, `authorId`, `publishedAt`, `updatedAt`, `status` (`draft`, `preview`, `scheduled`, `published`, `archived`), `readingTimeMinutes`, `tables?`, `references?`, `seo`.
- **Author**: `id`, `slug`, `name`, `roleTitle`, `bio`, `avatar`, `twitter`, `email`, `articleCount`.
- **User & Roles**: `id`, `name`, `email`, `role` (`Admin`, `Editor`, `Author`, `Reader`), `avatar`.
- **RedirectRule**: `id`, `sourceUrl`, `targetUrl`, `statusCode` (`301` | `302`), `isActive`, `createdAt`.
- **Comment**: `id`, `articleId`, `userId`, `userName`, `content`, `createdAt`, `status` (`pending`, `approved`, `rejected`).
- **MediaItem**: `id`, `title`, `url`, `altText`, `caption`, `credit`, `source`, `license`, `creationType` (`Original`, `AI-created`, `AI-assisted`, `Licensed`, `Official Source`, `Creative Commons`, `Other`).
- **AdSlotConfig**: `id` (e.g. `ARTICLE_TOP`, `HOMEPAGE_MIDDLE`), `enabled` (default `false`), `sponsorName`, `bannerText`, `linkUrl`, `dimensions`.

---

## 6. How Demo Data & Roles Work

- Seed data is loaded in `src/data/seedData.ts` and managed reactively in `src/context/AppContext.tsx`.
- The top bar includes a **Role Switcher** dropdown (`Admin`, `Editor`, `Author`, `Reader`):
  - In `Admin` mode: Full CMS editing, publishing, user role configuration, author registration, 301/302 redirect rules management, and comment moderation.
  - In `Editor` mode: Can edit/publish articles, stage editions, and moderate comments.
  - In `Author` mode: Can compose and edit articles and view media assets.
  - In `Reader` mode: The CMS is protected in read-only inspection mode, and user comments are automatically placed in the `pending` queue until reviewed by staff.

---

## 7. What is Implemented vs. What Remains for VPS Production

### Fully Implemented:
- [x] Complete reactive hierarchical routing matching all URL patterns
- [x] Full Design System with Light/Dark mode and anti-slop compliance
- [x] 12 initial sports with topics, events, and general guides
- [x] Reusable permanent event templates and staged edition dossiers
- [x] Reusable article template supporting all 18 article formats with tables and citations
- [x] Multi-criteria search engine with live discipline and format filters
- [x] Editorial CMS Console with complete article workflow, sports management, comment moderation, media provenance, and ad configuration
- [x] Complete CRUD for permanent events and staged tournament editions
- [x] Dedicated Author management desk and User RBAC desk
- [x] URL Redirects desk (301/302) with live router interception and Nginx configuration export
- [x] Pagination foundation on `/latest` articles wire
- [x] Robots.txt and XML Sitemap generation foundation in `/public`
- [x] CLS-safe advertisement architecture (default: ADS = OFF)
- [x] Dynamic SEO Head with OpenGraph and Schema.org JSON-LD (SportsEvent, NewsArticle, BreadcrumbList)

### For VPS Production Migration:
1. **Persistent Relational Database**: Connect PostgreSQL schema (e.g. Drizzle ORM) matching `/src/types/index.ts`.
2. **Server-Side Rendering (SSR) / Static Site Generation (SSG)**: Mount Express/Vite SSR or Next.js layout engine.
3. **Session Authentication**: Replace the client-side role toggle with standard JWT / session cookie auth (e.g. Lucia / NextAuth / Passport).
4. **Object Storage**: Point `/src/components/admin/AdminMedia.tsx` file uploads to an S3-compatible bucket (e.g. Cloudflare R2, MinIO, or AWS S3).
5. **Caching & CDN**: Configure Cache-Control headers on article routes (e.g. 1 hour cache with stale-while-revalidate).
