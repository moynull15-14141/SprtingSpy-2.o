# SPORTINGSPY.COM — PROJECT BRAIN
### Ground-truth technical handoff document, derived from direct source inspection
Generated: 2026-09-26 | Method: manual code reading (package.json, server.ts, src/**, data/db.json, public/*, config files). No claim below rests on DEVELOPER_HANDOFF.md or README.md content — those are cross-checked in Section 26 and flagged where they oversell reality.

---

## 1. PROJECT OVERVIEW--------------

SportingSpy is a **single Vite + React 19 SPA with a thin Express server**, exported from Google AI Studio (`metadata.json` declares `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`; `@google/genai` is an installed dependency). It is **not** a monorepo, has **no relational database**, **no ORM**, **no authentication system**, and **no test suite**. It is a well-structured front-end prototype/demo with a working but non-production "persistence" layer (a single JSON file on disk) and a permission model that is simulated client-side and only nominally checked server-side (trivially spoofable HTTP headers, not real auth).

This is materially smaller in scope than the 40-section brief implies. Sections below are answered against what exists; anything resembling "PostgreSQL," "Drizzle," "S3," "JWT," etc. in the brief does **NOT** exist in this codebase — it exists only as aspirational text in `DEVELOPER_HANDOFF.md`, item 171 ("For VPS Production Migration").

---

## 2. REPOSITORY STRUCTURE (verified via `find`)

```
/
├── index.html                     # Vite HTML entry, static <head> SEO tags, Google Fonts
├── metadata.json                  # AI Studio app metadata (name, description, Gemini capability flag)
├── package.json                   # deps/scripts (see Section 3)
├── server.ts                      # Express server: JSON-file "DB", REST API, redirect engine, sitemap/robots, header-based RBAC
├── vite.config.ts                 # React + Tailwind v4 plugins, HMR toggle for AI Studio agent edits
├── tsconfig.json                  # strict-ish TS config, noEmit, bundler resolution
├── .env.example                   # GEMINI_API_KEY, APP_URL (AI-Studio-injected; UNUSED in current src/)
├── .gitignore                     # node_modules, build, dist, coverage, .env*
├── .qodo/                         # empty subfolders: agents/, workflows/ (no files — tool scaffold, inert)
├── data/
│   └── db.json                    # 63,870 bytes — LIVE runtime datastore (created by server.ts on first boot, currently populated)
├── public/
│   ├── robots.txt                 # static fallback (server.ts also generates one dynamically at runtime — see Section 18)
│   └── sitemap.xml                # static fallback (server.ts also generates one dynamically at runtime)
├── DEVELOPER_HANDOFF.md           # prior AI agent's own summary — NOT verified, treat as claims (see Section 26)
├── README.md                      # generic AI Studio boilerplate ("Run and deploy your AI Studio app")
└── src/
    ├── main.tsx                   # ReactDOM.createRoot mount
    ├── App.tsx                    # hand-rolled router (string-matching on currentPath, no react-router)
    ├── index.css                  # Tailwind v4 + custom typography layer (not read in full; not load-bearing for architecture)
    ├── assets/images/             # local generated JPGs, referenced by src/config/assets.ts
    ├── config/
    │   ├── assets.ts              # central image path registry (5 hardcoded local image paths)
    │   └── branding.ts            # central BRANDING object (name, colors, fonts, socials) — genuinely centralized
    ├── context/
    │   └── AppContext.tsx         # SOLE global state store (React Context, no Redux/Zustand/Query). Owns theme, routing, auth-simulation, all CRUD, notifications, search state
    ├── data/
    │   └── seedData.ts            # 1,190 lines — hardcoded INITIAL_SPORTS/EVENTS/EDITIONS/ARTICLES/AUTHORS/USERS/COMMENTS/MEDIA_ITEMS/REDIRECT_RULES/AD_SLOTS. This is the ONLY source of "real" content; server.ts seeds data/db.json from it on first run.
    ├── types/
    │   └── index.ts                # single file, all domain interfaces (231 lines) — the closest thing to a "schema"
    ├── components/
    │   ├── ui/                     # Button, MetadataRow, Breadcrumbs, StructuredTable, AdSlot — presentational primitives
    │   ├── layout/                 # Header, Footer, SeoHead
    │   ├── editorial/               # ArticleCard, EventCard, CommentsSection
    │   └── admin/                  # 12 admin desk components (see Section 10)
    └── pages/                      # 10 route-level page components (see Section 7)
```

No `apps/`, no `packages/`, no `server/` vs `client/` split beyond `server.ts` at root, no `migrations/`, no `prisma/drizzle` folder, no `tests/`, no `Dockerfile`, no `nginx.conf`, no `docker-compose.yml` — **all confirmed absent by direct filesystem search.**

`node_modules/` is **not installed** in this working copy (confirmed: `ls node_modules` → not found). The app has not been run in this environment; `data/db.json` was carried over from wherever it last ran (AI Studio), meaning it holds whatever seed/edit state existed there — treat it as pre-existing runtime state, not something this environment produced.

---

## 3. TECH STACK & DEPENDENCY INVENTORY

From `package.json` (verified verbatim):

### Frontend
| Package | Version | Actual use |
|---|---|---|
| react / react-dom | 19.0.1 | UI runtime |
| vite | 8.3.0 | Dev server + build, also mounted as **middleware inside Express** (see Section 6) |
| @vitejs/plugin-react | 6.1.1 | JSX/Fast Refresh |
| @tailwindcss/vite | 4.3.3 | Tailwind v4 (CSS-first config, no tailwind.config.js needed) |
| tailwindcss | 4.3.3 | Styling — no CSS-in-JS, no component library (no MUI/shadcn/Chakra) |
| lucide-react | 0.546.0 | Icon set — used in `App.tsx` toast icons; most nav icons are hand-drawn inline SVG instead |
| motion | 12.23.24 (Framer Motion successor) | **Installed; NOT found used anywhere in `src/`** during inspection (no `motion(` / `<motion.` matches surfaced) — candidate unused dependency, verify with a full grep before removing |

No router library (no react-router, no wouter) — routing is a **hand-rolled path-matcher** in `App.tsx` fed by `AppContext`'s `currentPath`/`navigate`/popstate listener. No form library (no react-hook-form/Formik), no validation library (no zod/yup), no data-fetching library (no TanStack Query/SWR) — all `fetch` calls are hand-written in `AppContext.apiCall`.

### Backend
| Package | Version | Actual use |
|---|---|---|
| express | 4.21.2 | HTTP server, REST API, redirect middleware, static/Vite-middleware mounting |
| dotenv | 17.2.3 | Loads `.env` (not read in depth for actual invocation site, but standard) |
| tsx | 4.21.0 | Runs `server.ts` directly in dev (`npm run dev` = `tsx server.ts`) |

**No auth library** (no passport, no lucia, no next-auth, no jsonwebtoken, no bcrypt/argon2). **No ORM/DB driver** (no pg, no drizzle-orm, no prisma, no mongoose, no better-sqlite3). **No object storage SDK** (no aws-sdk, no @aws-sdk/client-s3). **No image processing** (no sharp). **No search engine client** (no elasticsearch, no meilisearch, no algoliasearch). **No email SDK** (no nodemailer, no resend, no sendgrid). **No monitoring/analytics SDK** (no sentry, no posthog, no @vercel/analytics). **No rate-limiting middleware** (no express-rate-limit).

### AI
`@google/genai` (2.4.0) is installed and `.env.example` documents `GEMINI_API_KEY`, and `metadata.json` flags `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` — but a grep across `src/` for `genai`/`GEMINI`/`GoogleGenAI` returned **zero matches**. **Conclusion: Gemini/AI integration is scaffolded at the platform level (AI Studio) but not wired into any application code.** No AI-assisted writing, no AI SEO suggestions, no AI image generation call sites exist despite `MediaCreationType` having `'AI-created' | 'AI-assisted'` as selectable (manual, human-entered) tags.

### Dev tooling
| Package | Use |
|---|---|
| typescript 7.0.2 | `tsc --noEmit` is the entire "lint" script — **no ESLint, no Prettier config found** |
| @types/node, @types/react, @types/react-dom, @types/express | type defs |
| autoprefixer 10.4.21 | present but Tailwind v4 typically doesn't need it explicitly — likely vestigial |
| esbuild 0.25.0 | transitive/Vite internal, not directly invoked by scripts |

### package.json scripts
```
dev / start  → tsx server.ts        (both identical — dev and "prod start" run the same command)
build        → vite build
preview      → vite preview
clean        → rm -rf dist server.js
lint         → tsc --noEmit
```
**No `test` script exists.**

---

## 4. DATABASE — CRITICAL SECTION

**Database type: none (relational or otherwise).** SportingSpy persists all state to a single flat file: `data/db.json`, read/written wholesale on every request via Node's `fs` module (`getDb()` / `saveDb()` in `server.ts`). There is no SQL, no query engine, no transactions, no connection pooling, no migrations, no ORM.

- **Schema files:** none. The closest artifact is `src/types/index.ts` (TypeScript interfaces) and the `DatabaseSchema` interface hardcoded at the top of `server.ts` — these are compile-time contracts only, not enforced at runtime (no Zod/JSON-schema validation on API bodies; `req.body` fields are read with simple `if (!body.x)` presence checks and passed through largely as-is).
- **Migrations:** NOT IMPLEMENTED. Schema changes require manually editing `server.ts`, `src/types/index.ts`, and `src/data/seedData.ts` in lockstep, then deleting `data/db.json` to reseed (or writing an ad-hoc migration script — none exists).
- **Seed scripts:** `src/data/seedData.ts` is the seed source; `initDb()` in `server.ts` writes it to `data/db.json` **only if the file doesn't already exist**. Since `data/db.json` already exists (63KB, populated) in this checkout, restarting the server will **not** re-seed — it will load the existing file as-is.
- **Reset:** no dedicated script. Manually deleting `data/db.json` and restarting the server is the de facto reset mechanism (confirmed by reading `initDb()` logic — it recreates the file from seed data if missing, and also self-heals with a fallback re-seed if the JSON fails to parse).
- **Dev vs prod database behavior:** identical — same file path (`data/db.json`), same code path, no environment branching for storage. This is a correctness risk for any real deployment (single file, no concurrency control, no backup story).
- **Connection configuration:** none — it's local disk I/O, not a client/server database, so there is no connection string, pooling, or environment-based DB URL. `.env.example` does **not** contain any `DATABASE_URL` or DB credentials, confirming no relational DB is even configured for provisioning.

### 4.1 Complete Model Inventory (from `src/types/index.ts` + `server.ts DatabaseSchema`)

All 11 top-level collections in `data/db.json`:

**Sport**
- Fields: `id, slug, name, tagline, description, order, isVisible, featuredEventIds: string[], colorTheme?, heroImage?, seo: SeoMetadata`
- PK: `id` (string, e.g. `sport-{slug}-{timestamp}` on creation via API; seed IDs are handwritten, e.g. likely `sport-tennis`)
- Unique constraint enforced in code (not DB-level, since there's no DB): `slug` — checked in `POST /api/sports` (`db.sports.some(s => s.slug === body.slug)` → 409 if exists)
- No indexes (flat array, linear `.find`/`.filter` scans)
- No FK enforcement at storage layer — `featuredEventIds` references `SportEvent.id` by convention only, never validated
- No soft delete — `DELETE /api/sports/:id` is a hard `.filter()` removal, but is guarded: refuses delete if any `SportEvent` or `Article` references the sport's `slug` (orphan prevention is real, implemented in `server.ts`)
- No timestamps (no `createdAt`/`updatedAt` on Sport)

**SportEvent** ("permanent event")
- Fields: `id, sportSlug, slug, name, shortName, description, history?, frequency, defaultVenue, defaultLocation, currentEditionYear, allEditionYears: number[], featured, isVisible, featuredImage?, seo`
- PK: `id`; composite uniqueness enforced in code: `(sportSlug, slug)` pair checked in `POST /api/events`
- FK: `sportSlug` references `Sport.slug`, not validated for existence on write (you can create an event under a non-existent sport slug — **no referential integrity check found**)
- Delete guarded: refuses if `EventEdition`s or `Article`s reference it (orphan prevention implemented)
- No timestamps, no soft delete

**EventEdition**
- Fields: `id ("{eventSlug}-{year}"), eventSlug, sportSlug, year, title, startDate, endDate, venue, location, status: 'upcoming'|'ongoing'|'completed', quickFacts: QuickFact[], prizeMoneyTotal?, defendingChampions?: {category,name}[], qualificationInfo?, participantsCount?, officialSourceUrl?, description, featuredImage, seo`
- PK: `id`, composite uniqueness enforced in code: `(sportSlug, eventSlug, year)`
- FK to `SportEvent`/`Sport` by slug string, not validated for existence
- Delete: **NOT orphan-guarded** — `DELETE /api/editions/:id` removes it with no check for dependent Articles (an article with `editionYear` pointing at a deleted edition becomes an orphan; this IS a real risk, verified by reading the delete handler, which has no `associatedArticles` check unlike the Sport/Event deletes)
- No timestamps

**Article**
- Fields: `id, slug, title, subtitle?, sportSlug, eventSlug?, editionYear?, articleType (18-value enum), excerpt, content: string, featuredImage, authorId, publishedAt, updatedAt?, scheduledFor?, status: 'draft'|'preview'|'scheduled'|'published'|'archived', readingTimeMinutes, featured?, tables?: StructuredTable[], references?: {title,url}[], seo`
- PK: `id` (`art-{timestamp}` on create)
- Uniqueness: `slug` unique within `(sportSlug, eventSlug, editionYear)` scope, enforced in `POST /api/articles`
- FK: `authorId` → `Author.id`, `sportSlug`/`eventSlug` → Sport/Event slugs — **none validated for existence on write**
- Content format: **plain string** — the admin form (`AdminArticles.tsx`) is a raw `<textarea>`. Comments in code call it "rich markdown / structured editorial HTML" but there is **no rich-text editor, no Markdown renderer, no sanitizer** wired in — whatever the author types is stored verbatim and (per `ArticlePage.tsx`, not fully read but implied by absence of a markdown lib in dependencies) most likely rendered as raw text/HTML. **This is a live XSS risk if `content` is ever rendered via `dangerouslySetInnerHTML`** — flagged for verification in Section 21.
- Status lifecycle: `draft → preview → scheduled → published → archived` all exist as literal values; the **scheduled→published transition is a real, working feature** — `server.ts` runs `setInterval(publishScheduledArticles, 30000)` (every 30s) plus calls `publishScheduledArticles()` inline before serving `/api/data`, `/api/articles`, and `/sitemap.xml`, so scheduled articles do flip to `published` automatically once `scheduledFor` has passed. This is a genuinely implemented feature, not a mock.
- No soft delete (hard delete, Admin/Editor only)

**Author**
- Fields: `id, slug, name, roleTitle, bio, avatar, twitter?, email?, articleCount?`
- PK: `id`; no enforced slug uniqueness check found in `POST /api/authors` (only presence-checked, not collision-checked) — **UNKNOWN/gap**: duplicate author slugs are possible via API even though the URL scheme `/author/{slug}` assumes uniqueness
- `articleCount` is set to `0` on creation and **never incremented anywhere found** in `server.ts` — likely always stale/0 for API-created authors (seed data may hardcode a nonzero value)

**User**
- Fields: `id, name, email, role: Role, avatar, joinedAt`
- PK: `id`
- **No password field, no hashed credential, no session token.** This is not an authentication table in any real sense — it's a role-tagging directory.
- `PUT /api/users/:id/role` is the only mutation endpoint (Admin-gated); `POST` to create a user has **no server API route at all** — `AdminUsers.tsx`'s `addUser()` only calls the local `setUsers` state setter in `AppContext`, never `apiCall`. **New "staff users" created via the admin UI are never persisted to `data/db.json` and vanish on refresh.** This is a concretely MOCKED feature, verified by absence of `app.post('/api/users'` in `server.ts`.

**Comment**
- Fields: `id, articleId, userId, userName, userAvatar?, userRole?, content, createdAt, status: 'pending'|'approved'|'rejected'`
- PK: `id`
- FK: `articleId` → `Article.id`, not validated for existence
- Moderation: real — `PUT /api/comments/:id` (Admin/Editor only) changes status; `DELETE` hard-removes
- Auto-approve rule: comments from Admin/Editor are auto-`approved`; everyone else (including Author/Reader) → `pending`. Verified directly in `server.ts POST /api/comments`.
- No rate limiting, no spam detection, no CAPTCHA, no edit capability for the comment author (only create/moderate/delete)

**MediaItem**
- Fields: `id, title, url, altText, caption?, credit?, source?, license?, creationType (7-value enum), uploadedAt, fileSize?, dimensions?`
- PK: `id`
- No FK to Article (media is a flat, unlinked registry — nothing associates a `MediaItem` with the `Article.featuredImage` it may have been used for; `featuredImage` on Article is just a raw URL string, not a `MediaItem` reference)
- "Upload" is a **URL text field**, not a file upload — confirmed in `AdminMedia.tsx` (`<input type="text" ... placeholder="/src/assets/images/... or https://">`). No file is ever transferred to the server; no Sharp/processing/thumbnailing/CDN exists.

**AdSlotConfig**
- Fields: `id: AdSlotId (9 fixed slot names), name, placementDescription, enabled (default false), sponsorName?, bannerText?, linkUrl?, dimensions`
- Not a dynamic table — slot IDs are a closed TypeScript union (`ARTICLE_TOP`, `ARTICLE_MIDDLE`, etc.), seeded once, only their config fields are editable. Real persistence via `PUT /api/ads/:id` (Admin only).

**AuditLog**
- Fields: `id, userId, userName, action, entityType (9-value enum), entityId, timestamp, details`
- Append-only in practice (`db.auditLogs.unshift(...)`) — **no delete endpoint exists**, so logs are effectively immutable/permanent from the API surface, though nothing prevents direct file editing.
- Logged operations (verified by grep of `auditLogs.unshift` call sites in `server.ts`): Create/Update/Delete Article, Create/Update/Delete Sport, Create/Update/Delete Event, Create/Update/Delete Edition, Submit/Moderate/Delete Comment, Create/Update Redirect + Delete, Create/Update Author (no delete endpoint for authors), Change User Role, Upload/Update/Delete Media, Configure Ad Slot, System Boot/Seed, Auto-Published Scheduled Article.
- **Not logged:** Reads, failed permission attempts (403s are returned but not audit-logged), user creation (since it's not even server-persisted).

**RedirectRule**
- Fields: `id, sourceUrl, targetUrl, statusCode: 301|302, createdAt, isActive`
- PK: `id`; no uniqueness constraint on `sourceUrl` (could create duplicate/conflicting rules; first match wins per `.find()` order)
- Server-side real 301/302 issuance via Express middleware (see Section 18) — genuinely implemented, not just a client-side illusion.

### 4.2 Models Requested in the Brief That Do NOT Exist
- **Static Page** as a data model: NOT IMPLEMENTED — About/Contact/Privacy/Terms/DMCA are hardcoded React components (`StaticPages.tsx`) with copy baked into JSX, not editable from any admin desk or stored in `data/db.json`.
- **Permission** as a distinct entity: NOT IMPLEMENTED — permissions are hardcoded role-array checks (`requireRoles(['Admin','Editor'])`) scattered inline in `server.ts`, not a data-driven permission table.
- **Settings** (a general site-settings model): NOT IMPLEMENTED as its own collection — `BRANDING` (name/colors/fonts) lives in a static TypeScript config file (`src/config/branding.ts`), not the database, and is not editable from any admin UI.

---

## 5. DATABASE RELATIONSHIP MAP

```
Sport (slug)
├── SportEvent[] (via sportSlug, string match, NOT a DB foreign key)
│    ├── EventEdition[] (via eventSlug+sportSlug)
│    │    └── Article[] (via sportSlug+eventSlug+editionYear)
│    └── Article[] directly under event with no edition (eventSlug set, editionYear undefined — supported by the Article type, not fully exercised in App.tsx routing, which expects a year segment when eventSlug is present per Pattern C/D)
└── Article[] directly under sport (sportSlug set, eventSlug undefined — "general guides")

Author (id) ← Article.authorId (string ref)
User (id/role) ← Comment.userId, AuditLog.userId (string refs)
Article (id) ← Comment.articleId (string ref)
MediaItem — orphaned/unlinked (no FK anywhere)
RedirectRule — standalone
AdSlotConfig — standalone
AuditLog — append-only ledger, references various entityType/entityId pairs generically
```

- **Relationship type:** all are **one-to-many by convention (string slug/ID matching)**, never enforced by a real foreign key, constraint, or ORM relation. This is a JSON file, not a relational database — "relationships" exist only in the sense that application code filters arrays by matching string fields.
- **Cascade behavior:** partial. Sport and SportEvent deletes are guarded against orphaning (blocked with a 400 if dependents exist). **EventEdition delete is NOT guarded** — deleting an edition that has articles pointing at it via `editionYear` will silently orphan those articles (they'll keep rendering under a URL segment, `/{sport}/{event}/{year}`, that the edition-lookup page (`EventEditionPage`) can no longer resolve, likely producing a broken page or a 404-like state — not independently verified by running the app, since `node_modules` isn't installed here).
- **Orphan risk summary:** EventEdition→Article is the one real gap; Author, MediaItem, and User references are never validated on write at all (you can create an Article with a bogus `authorId` with no server-side rejection).
- **Referential integrity is NOT enforced at write time** for any FK-like field except the slug-uniqueness checks noted above. This is a structural risk for a future migration to a real RDBMS: expect to find dangling references in `data/db.json` if the app has been used extensively.

---

## 6. DATA SOURCE ANALYSIS (per feature)

| Feature | Classification | Evidence |
|---|---|---|
| Sports/Events/Editions/Articles/Authors/Comments/Media/Ads/Redirects listing | **REAL DATABASE** (JSON-file-backed, via `/api/data` and per-entity REST endpoints) | `server.ts`, `AppContext.refreshData()` |
| Article scheduled publishing | **REAL** (background interval + on-read lazy trigger) | `server.ts: setInterval(publishScheduledArticles, 30000)` |
| Sitemap.xml / robots.txt served at runtime | **REAL DATABASE-DRIVEN** (dynamically generated per request from `data/db.json`), distinct from the static files in `public/` | `server.ts` routes `/sitemap.xml`, `/robots.txt` |
| RBAC / current user / role switching | **LOCAL STATE / SIMULATED** — `currentUser` lives in React state + `localStorage`, switched via a UI dropdown with **no credential check whatsoever** | `AppContext.switchUserRole`, `Header.tsx` role switcher |
| Server-side permission enforcement | **PARTIALLY REAL** — Express middleware does check role before allowing mutations, but it trusts a client-supplied `x-user-id`/`x-user-role` HTTP header with zero verification (no signature, no session, no password) | `server.ts: getRequestUser()`, `requireRoles()` |
| New staff user creation (Admin desk) | **MOCK / LOCAL STATE ONLY** — never reaches the server, lost on refresh | `AppContext.addUser` (no `apiCall`) vs. absence of `POST /api/users` in `server.ts` |
| Search | **LOCAL STATE / CLIENT-SIDE FILTER** over already-fetched in-memory arrays — no server search endpoint, no FTS, no external engine | `SearchPage.tsx` (`Array.filter` + `.includes()`) |
| Media "upload" | **HARDCODED URL ENTRY**, not an upload — no file transmitted, no storage backend | `AdminMedia.tsx` |
| SEO Diagnostics ("SEO Intelligence") | **MOCK / STATIC HEURISTIC UI** — client-side string-length checks on already-loaded article data; "Schema Entity Compliance: 100%" and "Canonical URL Resolution: Unified" are **hardcoded literal strings**, not computed | `AdminSeoAudit.tsx` lines ~57–75 |
| Ads system | **REAL PERSISTENCE, OFF BY DEFAULT** — slot config is genuinely stored/toggled via API, but no real ad network/creative-serving integration exists (self-hosted sponsor text/banner only) | `AdminAds.tsx`, `AdSlot.tsx`, `server.ts /api/ads/:id` |
| Redirect engine | **REAL** — genuine Express middleware issuing true HTTP 301/302 with loop/chain detection, plus a duplicate client-side simulation in `AppContext` for SPA navigation | `server.ts` middleware (lines ~185–234), `AppContext.navigate` |
| Audit logs | **REAL**, file-persisted, append-only in practice | `server.ts`, every mutation handler |
| Branding (name/logo/colors) | **STATIC CONFIG FILE**, not database-backed, not admin-editable | `src/config/branding.ts` |
| Static pages (About/Contact/Privacy/Terms/DMCA) | **HARDCODED JSX**, not database-backed | `src/pages/StaticPages.tsx` |
| AI/Gemini features (mentioned in metadata/env) | **NOT IMPLEMENTED** — no code path invokes `@google/genai` | grep confirmed zero matches |

---

## 7. FRONTEND ARCHITECTURE

- **Entry point:** `src/main.tsx` → `ReactDOM.createRoot` mounts `<App />`.
- **Routing:** No router library. `App.tsx`'s `AppContent` component reads `currentPath` from `AppContext`, splits it into segments, and uses an explicit if/else cascade to decide which page component to render (patterns A–D per the URL philosophy). Browser history is manipulated manually (`window.history.pushState`/`replaceState`) and a `popstate` listener syncs back into React state. This is a **hand-rolled SPA router**, functionally comparable to a simple router but without code-splitting, without route guards as a formal concept (permission checks happen inside admin components themselves, not at the router level), and without server-side rendering — the initial HTML (`index.html`) has no injected content; **this is a pure client-rendered SPA**, meaning it has poor default SEO/crawlability unless combined with the server-only sitemap/robots/redirect features which run independent of the SPA's JS bundle.
- **Layouts:** Single layout wraps everything (`Header` + `<main>` + `Footer`) in `AppContent`; `AdminLayout` is a second, separate 2-column shell used only when `pathParts[0] === 'admin'`.
- **Global state:** One React Context (`AppContext`) holds literally everything — theme, routing, current user, every data collection, every CRUD action, notifications, and search/filter state. No Redux, Zustand, Jotai, or React Query. All server sync happens via a hand-written `apiCall` helper and a `refreshData()` that re-fetches `/api/data` after every mutation (optimistic local update + full refetch, not incremental cache updates).
- **Providers:** Only `AppProvider` (wraps the whole tree in `App.tsx`'s default export).
- **API client:** `AppContext.apiCall<T>()` — raw `fetch` wrapper adding `x-user-id`/`x-user-role` headers from `currentUser`, JSON body serialization, and error-to-toast-notification handling. No retries, no caching, no request de-duplication.
- **Theme system:** Light/dark via a `dark` class on `<html>`, persisted to `localStorage['sportingspy_theme']`, defaulting to OS preference (`prefers-color-scheme`) on first load.
- **Component reuse:** `ui/` (Button, Breadcrumbs, MetadataRow, StructuredTable, AdSlot) are the shared design-system primitives; `editorial/` (ArticleCard, EventCard, CommentsSection) are content-presentation components; `admin/` are self-contained "desk" screens, each independently managing its own form state and talking directly to `useApp()`.

---

## 8. PUBLIC WEBSITE ROUTES (verified against `App.tsx`'s `renderView()`)

| Route | Component | Data source | SEO | Auth | Status |
|---|---|---|---|---|---|
| `/` | `HomePage` | context arrays | `SeoHead` (per-page, client-injected) | None | Implemented |
| `/sports` | `SportsDirectoryPage` | context | yes | None | Implemented |
| `/events` | `EventsDirectoryPage` | context | yes | None | Implemented |
| `/latest` | `LatestArticlesPage` | context, filtered to `published` (client-side; note the raw `articles` array in context may include drafts if the current simulated role allows preview — see Section 13) | yes | None | Implemented, "pagination foundation" per handoff doc — not independently verified beyond component existing |
| `/search` | `SearchPage` | context, client-side `.filter()` | yes | None | Implemented (see Section 15 for limits) |
| `/{sport}` | `SportPage` | context, matched by slug | yes | None | Implemented |
| `/{sport}/{event}` | `EventPage` | context | yes | None | Implemented |
| `/{sport}/{event}/{year}` | `EventEditionPage` | context | yes | None | Implemented |
| `/{sport}/{event}/{year}/{article}` | `ArticlePage` | context, matched by all 4 fields | yes | None (drafts are filterable — see gap below) | Implemented |
| `/{sport}/{article}` (general article, no event) | `ArticlePage` | context, matched where `!a.eventSlug` | yes | None | Implemented |
| `/author/{slug}` | `AuthorPage` | context | yes | None | Implemented |
| `/about`, `/contact`, `/privacy`, `/terms`, `/dmca` | `StaticPages` variants | hardcoded JSX | yes | None | Implemented (static copy only) |
| `/admin` (+ internal tab state) | `AdminLayout` + 11 desk components | context | N/A (correctly `Disallow`'d in robots.txt) | **UI-level only** — no route guard blocks navigation to `/admin` for a Reader; individual desk components conditionally hide buttons (e.g., `AdminUsers.tsx` only shows "Add Staff User" if `currentUser.role === 'Admin'`), but there is no top-level redirect/gate stopping a Reader-role browser session from viewing `/admin` and its screens. Real enforcement only exists **server-side**, per API call, not at the page level. | Implemented, weakly gated |
| any unmatched path | inline 404 block in `App.tsx` | — | minimal (`<h1>404</h1>`, no `noindex` meta actually forced — UNKNOWN/NOT VERIFIED whether `SeoHead` is invoked on this fallback; reading `renderView()` shows the 404 branch does **not** render a `<SeoHead>`, so the previous page's title tag likely persists in the browser tab) | None | Implemented, minimal |

No routes exist outside the requirements list; nothing extraneous found.

---

## 9. HEADER / MENU / NAVIGATION (verified: `src/components/layout/Header.tsx`)

**Desktop, 3-zone contract exactly as documented:**
1. **Brand zone:** `BRANDING.shortName` text wordmark + small amber dot, clicking navigates home. No image logo — text-only, sourced from `src/config/branding.ts` (centrally changeable).
2. **Nav zone (hardcoded links + one dynamic dropdown):**
   - **"Sports"** — a dropdown/mega-menu button. Its **contents are dynamic**: `sports.filter(s => s.isVisible).map(...)` pulled live from `AppContext.sports`, which is populated from `/api/data`. **Confirmed: adding a new Sport via the Admin > Sports desk and marking it visible WILL appear in this menu automatically** on the next data refresh (which happens on every `currentUser.role` change and after every mutation's `refreshData()` call) — no manual menu wiring needed.
   - **"Events"**, **"Latest"**, **"Search"**, **"Editorial CMS"** — four **hardcoded** static links (not database-driven), always shown regardless of role (the "Editorial CMS" link is visible to Readers too — see admin-gating gap in Section 8/13).
3. **Actions zone:** theme toggle (sun/moon inline SVG) + a user-menu button showing avatar + role, which opens a dropdown containing a **"Test Access Levels"** role-switcher (Admin/Editor/Author/Reader) that calls `switchUserRole()` — this is explicitly a testing/demo affordance, not a login flow.

**Mobile:** hamburger toggles a stacked drawer with: "All Sports Directory" link, a 2-column grid of the **first 8 sports only** (`sports.slice(0,8)`, not filtered by `isVisible` — a minor inconsistency vs. desktop's `isVisible` filter, worth flagging as a bug), then "Major Events," "Latest Articles," "Search Database," "Editorial CMS."

**Active-state logic:** `isActive(path)` does exact match for `/` and `startsWith` for everything else — simple, functional, no nested-route highlighting complexity.

**No footer verified in depth** (`Footer.tsx`, 139 lines, not fully read — noted as UNKNOWN/NOT VERIFIED for exact link list, but its existence and general purpose as a legal/discipline-directory footer is confirmed by the file's docblock).

---

## 10. DESIGN SYSTEM

Verified via `branding.ts`, `index.html`, `Header.tsx`, and component classNames (Tailwind utility-first, no separate design-token JSON/CSS-variables file beyond what's baked into Tailwind classes and the `BRANDING.colors` object):

- **Fonts:** Cinzel (display/brand), Newsreader (serif/editorial body-adjacent), Plus Jakarta Sans (sans/body), JetBrains Mono (implied for tabular/mono data — loaded in `index.html`'s Google Fonts link but not independently confirmed as applied via a `font-mono` custom mapping; Tailwind's default `font-mono` stack would need this configured in the Tailwind theme, which was not directly inspected — mark as **PARTIALLY VERIFIED**).
- **Colors:** 60-30-10 budget as documented — light canvas `#fbf9f5`, dark canvas `#0c0d0e`, amber accent `#d97706`/`#f59e0b`. Centralized in `BRANDING.colors`, though most components use raw Tailwind classes (`bg-stone-50`, `text-amber-600`, etc.) rather than referencing `BRANDING.colors` programmatically — meaning **the "centralized" branding colors are documentation-only for Tailwind's own `stone`/`amber` palettes**, not actually piped through a single token source at runtime. Changing `BRANDING.colors.primaryAccent` would **not** automatically re-theme the app; someone would have to also update every `amber-*` Tailwind class reference or introduce a Tailwind theme extension. **This is a real gap between the "centralized branding" claim and actual mechanics.**
- **Zero-pill discipline:** confirmed by absence of pill/badge/chip classes in the components read; metadata uses plain text with `·` separators (implied by `MetadataRow.tsx`'s existence and naming, not fully read).
- **Dark mode:** class-based (`dark:` Tailwind variant), toggled via `document.documentElement.classList`.
- **Responsive breakpoints:** standard Tailwind (`sm:`, `md:`, `lg:`) used throughout; no custom breakpoint config confirmed.
- **Branding centralization verdict:** name/tagline/domain/social links/font-family strings ARE centrally swappable via `branding.ts`. Colors are only "centrally documented," not centrally enforced.

---

## 11. ADMIN PANEL (verified: `App.tsx` admin switch + each component read or confirmed to exist)

| Desk | Route (tab) | CRUD reality | Backing API | Permission gate | Verdict |
|---|---|---|---|---|---|
| Dashboard | `dashboard` | read-only metrics (not read in depth) | `/api/data` | none enforced client-side | UNKNOWN/NOT VERIFIED (component not opened) — likely real aggregate counts over context data |
| Articles | `articles` | Full C/U/D via `AdminArticles.tsx` | `/api/articles` POST/PUT/DELETE | server: Admin/Editor/Author (create/update), Admin/Editor (delete); Author restricted to own articles on update | **Real** |
| Sports | `sports` | not opened in full, but wired to `addSport/updateSport/deleteSport` per `AppContext` | `/api/sports` | Admin only (server) | **Real** (CRUD confirmed via context + server route pairing) |
| Events | `events` | `addEvent/updateEvent/deleteEvent` + Editions nested (per handoff doc claim; edition CRUD confirmed via `addEdition` etc. in context, actual `AdminEvents.tsx` UI not opened) | `/api/events`, `/api/editions` | Admin/Editor (create/update), Admin (delete) | **Real** (API-level), UI details UNKNOWN/NOT VERIFIED |
| Authors | `authors` | Create/Update (no delete endpoint exists server-side) | `/api/authors` POST/PUT only | Admin/Editor | **Real for create/update; delete NOT IMPLEMENTED** |
| Users | `users` | **Role change only is real; user creation is a client-only mock** | `/api/users/:id/role` PUT only | Admin only for role change UI/API | **Partial/Mock** — confirmed above in Section 4 |
| Comments | `comments` | moderate/delete confirmed via context+server | `/api/comments/:id` PUT/DELETE | Admin/Editor | **Real** |
| Media | `media` | Create (URL-entry) + Update/Delete via context; no actual file upload | `/api/media` POST/PUT/DELETE | Admin/Editor/Author (create), Admin/Editor (update), Admin (delete) | **Foundation/Mock** for upload; real for metadata CRUD |
| Ads | `ads` | Update only (slots are fixed, not creatable/deletable) | `/api/ads/:id` PUT | Admin only | **Real**, limited scope by design |
| SEO | `seo` (`AdminSeoAudit`) | Read-only diagnostics; some numbers are hardcoded literals, not computed | none (pure client derivation over already-loaded `articles`) | none | **Mock/Foundation** — confirmed hardcoded "100%" and "Unified" strings |
| Redirects | `redirects` | Full C/U(toggle)/D | `/api/redirects` | Admin only | **Real**, plus a genuinely useful Nginx `rewrite` config **text generator** (`generateNginxConf()` — client-side string templating, not wired to any deployment automation, purely a copy-paste export) |
| Audit Logs | `audit` | Read-only | `/api/audit-logs` GET | Admin/Editor | **Real** |

**General admin security note:** none of these desks perform their own role redirect/gate at the page level — the `/admin` route itself is reachable by anyone in any role; only the underlying API calls are permission-checked, and only via a spoofable header (see Section 13).

---

## 12. ARTICLE SYSTEM (lifecycle, verified against `server.ts` + `AdminArticles.tsx`)

- **Statuses:** `draft`, `preview`, `scheduled`, `published`, `archived` — all literal type values exist; **`archived` has no distinct behavior found** beyond being a filterable status string (no archive-listing page, no restore button located in the portion of `AdminArticles.tsx` read — UNKNOWN/NOT VERIFIED beyond line 120 of that file, which was truncated during inspection).
- **Creation:** via `AdminArticles.tsx` form → `addArticle()` → `POST /api/articles`. 10-step guided flow as documented (sport → is-it-about-an-event toggle → event → edition-year → type → content fields → image URL → author → SEO fields → status).
- **Editing:** `updateArticle()` → `PUT /api/articles/:id`; Authors can only edit their own (`existing.authorId !== user.id` check, with a **hardcoded escape hatch**: `existing.authorId !== 'auth-alistair'` — a specific seeded author ID is exempted from the ownership check, letting any Author role edit that one seeded author's articles. This looks like a leftover demo/debug shortcut, not deliberate design — **flag as technical debt/possible bug**).
- **Scheduled publication:** genuinely automated (30-second interval + on-demand trigger before reads), described in Section 4.
- **Deletion:** hard delete, Admin/Editor only, audit-logged. **No restore/undo mechanism** — NOT IMPLEMENTED.
- **Content format:** plain string, entered via a raw textarea in the admin UI — **not Markdown-rendered, not TipTap/rich-text JSON, not HTML-sanitized** based on available evidence. Whatever is typed is stored as-is in `Article.content`. How `ArticlePage.tsx` renders it (raw text vs. `dangerouslySetInnerHTML`) was **not directly inspected** — flag as a priority verification item given the XSS implications (Section 21).
- **Structured tables:** `StructuredTable[]` field exists in the type and is checked by the SEO audit ("Tables/Structured" column), but the admin article form (lines 1–120 read) does **not** expose a UI for building `tables` — UNKNOWN/NOT VERIFIED whether a table editor exists further down in `AdminArticles.tsx` (file is 100+ lines beyond what was read).
- **References/citations:** `references?: {title,url}[]` field exists on the type; not confirmed to have UI in the truncated read.

---

## 13. AUTHENTICATION, USERS, AND RBAC — VERIFIED IN DETAIL

**There is no authentication system.** No login form, no password field on `User`, no session cookie, no JWT, no OAuth. What exists instead:

1. **Client-side "identity":** `AppContext.currentUser` is just a `User` object cached in `localStorage['sportingspy_user']`, defaulted to `INITIAL_USERS[0]` (whichever user is first in `seedData.ts` — almost certainly the seeded Admin, "Julian Hayes" per the seed audit log text). Anyone opening the site in a browser is **already "logged in" as this default user** with no credential prompt.
2. **Role switching:** a UI dropdown (`Header.tsx`, `AdminUsers.tsx`) lets the current browser session instantly become Admin, Editor, Author, or Reader with one click — genuinely a testing/demo feature, explicitly documented as such in `DEVELOPER_HANDOFF.md`, and confirmed by code with no gate on who can do this switch.
3. **Server-side enforcement mechanism:** `getRequestUser(req)` in `server.ts` reads `x-user-id`/`x-user-role` **HTTP headers** (or equivalent query params) sent by the client, looks up a matching seeded `User`, and if none matches, silently defaults to the first Reader in the DB (or a synthetic guest Reader). `requireRoles([...])` middleware then checks this derived role against an allow-list before permitting mutation endpoints.
4. **Security verdict:** This is **enforcement against accidental misuse from the app's own UI, not against a malicious actor.** Any HTTP client (curl, Postman, browser devtools `fetch` override) can set `x-user-role: Admin` and pass every `requireRoles` check with **zero proof of identity**. There is no signature, no server-issued session, no verification that the caller is actually who the header claims. **This satisfies "B) frontend + API enforcement" only in the sense that the API does check a role value — it does NOT satisfy real authorization, because the role value is entirely client-supplied and unverified.** This must be called out explicitly to any team planning to expose this server publicly: **as currently written, `x-user-role: Admin` in a request header is sufficient to perform any Admin action against the live JSON database, including deleting sports/events/editions/articles/comments/media, changing user roles, and configuring redirects.**
5. **Roles and their real (server-checked) permissions:**
   - **Admin:** everything (all POST/PUT/DELETE across all resources) — confirmed by route-by-route reading of `requireRoles(...)` arrays.
   - **Editor:** articles (create/update, not delete on... actually delete IS `['Admin','Editor']` for articles), events (create/update, not delete — delete is Admin-only), editions (create/update, not delete), comments (moderate/delete), authors (create/update), media (create/update, not delete).
   - **Author:** articles (create/update own only), media (create only).
   - **Reader:** comments (create — auto-pending), nothing else server-side; can still create User-facing UI interactions like theme toggle, search, browsing.
6. **No registration/password-reset/email-verification flow exists** — expected, since there's no password system at all.
7. **No test of "direct unauthorized requests"** was performed against a live server in this investigation (server not started — `node_modules` not installed in this environment) — the analysis above is derived entirely from static code reading of `server.ts`'s middleware logic, which is unambiguous and doesn't require runtime confirmation to assess.

---

## 14. COMMENTS SYSTEM

**Classification: PARTIALLY IMPLEMENTED (real CRUD + moderation, no safety features).**

- Model, creation, moderation, deletion all real and file-persisted (Section 4).
- Auto-approval for staff, pending-queue for Readers — real, server-enforced.
- **No edit-by-author capability** (Comment has no `updateComment`-by-owner path; only Admin/Editor `PUT` exists, used for moderation, not content edits).
- **No rate limiting** — a Reader (or even an anonymous spoofed identity, since there's no login) could POST unlimited comments in a loop; nothing in `server.ts` throttles this.
- **No spam/profanity filtering.**
- **Deleted-user behavior:** since `userId`/`userName`/`userAvatar` are denormalized onto the `Comment` at creation time (copied, not referenced live), a comment survives even if its `User` were somehow removed — though `User` deletion isn't even an implemented feature (no `DELETE /api/users` route exists), so this is moot in practice.

---

## 15. SEARCH SYSTEM

**Classification: CLIENT-SIDE FILTERING, NOT a search engine.**

- No PostgreSQL FTS (no Postgres at all), no external search service, no server-side `/api/search` endpoint.
- `SearchPage.tsx` runs `Array.prototype.filter` + `.toLowerCase().includes()` substring matching across already-fetched in-memory `sports`, `events`, `editions`, and `articles` arrays (the full dataset must already be loaded client-side via `/api/data` for search to work at all — this won't scale past a small seed dataset).
- Searches: Sport name/description, Event name/shortName/description/venue, Edition title/year/venue, Article title/subtitle/excerpt/**full content string** (`a.content.toLowerCase().includes(q)` — a real full-text-ish substring match, just done in JS on the client, not indexed).
- Filters: Discipline (sport) dropdown, Article Type dropdown — both simple `<select>` elements, real and functional.
- **No pagination** on search results (renders everything matched in one grid).
- **No typo tolerance / fuzzy matching / relevance ranking** — pure substring containment, first-match-order.
- **No autocomplete/type-ahead** — search only runs on the dedicated `/search` page against the live `searchQuery` state (which does appear to be shared globally via context, so a search typed elsewhere could theoretically pre-populate this page, though no obvious search box exists in the header itself; the header's "Search" nav link just navigates to `/search`).

---

## 16. MEDIA SYSTEM

**Classification: FOUNDATION ONLY (metadata registry with no real asset pipeline).**

| Capability | Status |
|---|---|
| Upload (drag/drop or file picker) | NOT IMPLEMENTED — text URL input only |
| Storage (local disk / S3 / R2) | NOT IMPLEMENTED — items just store whatever URL string was typed (could be a `/src/assets/images/...` local path or any external `https://` URL, including the seed data's heavy reliance on Unsplash hotlinks, e.g. `images.unsplash.com/...`) |
| Image processing (resize/optimize) | NOT IMPLEMENTED — no Sharp, no processing pipeline |
| Responsive images / WebP/AVIF / thumbnails / CDN | NOT IMPLEMENTED |
| Alt text, caption, credit, source, license | **IMPLEMENTED** as manually-entered metadata fields, genuinely persisted |
| Creation-type provenance tagging (Original/AI-created/AI-assisted/Licensed/Official Source/Creative Commons/Other) | **IMPLEMENTED** as a manual dropdown — this is a metadata label the human enters, not an automatically detected/verified property |
| Duplicate detection | NOT IMPLEMENTED |
| Usage tracking (which articles use which media) | NOT IMPLEMENTED — `MediaItem` has no back-reference to `Article`; `Article.featuredImage` is a disconnected raw URL string, not a `MediaItem.id` foreign key |

---

## 17. SEO SYSTEM

**Classification: PARTIAL — real dynamic meta tags + JSON-LD scaffold; the "SEO Intelligence" admin desk is mostly cosmetic.**

- `SeoHead.tsx` (real, generic, reusable): imperatively updates `document.title`, `<meta name="description">`, `<meta property="og:title/description">`, and `<link rel="canonical">` on mount/update via `useEffect` + direct DOM manipulation (not React Helmet or a metadata API) — functional but happens client-side after JS execution, meaning **crawlers that don't execute JavaScript will only see the static tags baked into `index.html`**, not the per-page dynamic ones. This is a genuine SEO limitation of the pure-CSR architecture (no SSR/SSG, confirmed absent in Section 6/2).
- **JSON-LD structured data:** `SeoHead` accepts a `structuredData` prop and renders a `<script type="application/ld+json">` — the actual JSON-LD payloads (SportsEvent, NewsArticle, BreadcrumbList schemas claimed in the handoff doc) were **not independently verified** by opening every page component that would pass this prop — flag as UNKNOWN/NOT VERIFIED whether all claimed schema types are actually populated correctly, though the mechanism to do so is real and wired.
- **Twitter card tags:** static only, baked into `index.html`, not dynamically updated per-page by `SeoHead.tsx` (only OG title/description are updated, not `twitter:title`/`twitter:description` — confirmed by reading the full `SeoHead.tsx` source, which has no `twitter:` selector logic).
- **Breadcrumbs:** `Breadcrumbs.tsx` exists and is used across pages (confirmed via imports in `SearchPage.tsx`, `StaticPages.tsx`); claimed to emit `BreadcrumbList` schema — not independently verified (component not opened).
- **SEO Intelligence / Audit desk (`AdminSeoAudit.tsx`):** **real, computed** metrics for meta-description length and title length (character-count thresholds against actual article data); **fake/hardcoded** metrics for "Schema Entity Compliance: 100%" and "Canonical URL Resolution: Unified" — these are literal strings in JSX, not derived from any actual check. This is a clear case of **UI that looks like a diagnostic tool but partially just asserts success unconditionally.**
- **No actual crawl, no Lighthouse integration, no Search Console/Bing Webmaster integration** (confirmed absent from dependencies and `.env.example`).

---

## 18. SITEMAP, ROBOTS, REDIRECTS

**Sitemap:** TWO versions exist —
1. `public/sitemap.xml` — a static, presumably stale snapshot file, served as a plain static asset if ever requested directly bypassing the dynamic route (Vite/Express static serving order would need runtime verification to know which wins; in production mode `express.static('dist')` serves built files, and since `public/` assets get copied into `dist/` by Vite's build, there could be a **route collision** between the static `dist/sitemap.xml` and the dynamic `app.get('/sitemap.xml', ...)` handler — **NOT VERIFIED which one wins in production**, though in dev mode the Express route handler is registered before Vite middleware mounts, so the dynamic version should win in `npm run dev`).
2. **Dynamic generation** in `server.ts` (`app.get('/sitemap.xml', ...)`) — genuinely rebuilds XML from live `data/db.json` on every request: static pages, visible sports, all events, all editions, **published-only** articles, and all authors. Sets `Cache-Control: public, max-age=3600`. This is a real, working feature.

**Robots.txt:** same dual-file situation — `public/robots.txt` is static (`Disallow: /admin` only, no `/api/` disallow, no sitemap reference visible in the snippet read... actually it does have `Sitemap:` line); the **dynamic** `server.ts` version additionally disallows `/api/` and is otherwise identical in intent. Both point to `https://sportingspy.com/sitemap.xml` (hardcoded production domain, not environment-driven — will be wrong on any staging/dev deployment unless manually edited).

**Redirects:** real database model (`RedirectRule`), real Admin CRUD, **real server-side 301/302 enforcement** via Express middleware that runs **before** the SPA/Vite middleware and before any React code executes — this means redirects genuinely happen "before page rendering," satisfying a true server-level redirect (not a client-side-only `history.replaceState` trick, though a redundant client-side check also exists in `AppContext.navigate`/`popstate` for in-app SPA navigation consistency). Loop detection: checks direct self-redirect and walks up to 5 hops of chained redirects looking for a cycle back to the origin path, logging a warning and breaking the chain if found — a real, if simplistic, safeguard.

---

## 19. ADS SYSTEM

- **Default state: confirmed OFF.** Every seeded `AdSlotConfig.enabled` is presumably `false` (not individually verified per slot in `seedData.ts`, but `AdminAds.tsx`'s UI and the "Default: ADS = OFF" comments throughout the codebase, plus `AdSlot.tsx`'s `if (!config || !config.enabled) return null;` guard, all corroborate this).
- 9 fixed slot IDs (`ARTICLE_TOP/MIDDLE/BOTTOM`, `SIDEBAR_TOP/MIDDLE`, `HOMEPAGE_TOP/MIDDLE`, `EVENT_TOP/BOTTOM`) — closed set, not admin-creatable/deletable, only configurable.
- Reserved-height containers (`min-h-[90px]`/`min-h-[250px]`/`min-h-[300px]`) genuinely prevent layout shift when a slot IS enabled.
- **No real ad network integration** (no Google AdSense/GAM script, no header-bidding, no ad server SDK) — "ads" here means **manually configured sponsor text + a link**, essentially a native/direct-sponsorship banner, not programmatic advertising.
- **I did not enable any ad slot** during this investigation, per instructions.

---

## 20. AUDIT LOGGING

Covered in Section 4 (AuditLog model). Summary: real, append-only-in-practice, file-persisted, records actor (`userId`/`userName` — note: **derived from the same spoofable header identity**, so audit trail integrity is only as strong as the (currently absent) authentication system), action label, entity type/ID, timestamp, and a free-text `details` string. **No IP address or user-agent capture.** **No admin UI to search/filter audit logs was confirmed** beyond a presumed table render in `AdminAuditLogs.tsx` (not opened in detail — UNKNOWN/NOT VERIFIED for filtering/pagination/export features).

---

## 21. SECURITY ARCHITECTURE

| Concern | Finding |
|---|---|
| Authentication | NOT IMPLEMENTED (Section 13) |
| Authorization | Header-based, unverified, spoofable (Section 13) — **critical gap for any real deployment** |
| Input validation | Minimal — presence checks only (`if (!body.title...)`), no schema validation (no Zod/Joi), no length limits, no type coercion safety beyond basic `parseInt` |
| XSS | **UNKNOWN/NOT VERIFIED** whether `Article.content` (raw user-entered string) is ever rendered via `dangerouslySetInnerHTML` in `ArticlePage.tsx` — this file was not opened in this pass and is the single highest-priority follow-up read for security purposes. The `SeoHead.tsx` component DOES use `dangerouslySetInnerHTML` for its JSON-LD `<script>` tag, but that content is `JSON.stringify()`'d and thus not directly attacker-controlled HTML in the way `Article.content` could be. |
| CSRF | No CSRF tokens anywhere — moot in the sense that there's no real session/cookie-based auth to hijack, but any state-changing endpoint is reachable cross-origin by anything that can guess/replay the `x-user-role` header (which is trivial) |
| SQL injection | N/A — no SQL database exists |
| File upload security | N/A — no file upload exists (Section 16) |
| Rate limiting | NOT IMPLEMENTED anywhere in `server.ts` |
| Password handling | N/A — no passwords exist |
| Sessions | N/A — no sessions exist |
| Secrets | `.env.example` only references `GEMINI_API_KEY` and `APP_URL`; no `.env`/`.env.local` file present in this checkout (only `.env.example`, correctly gitignored alongside real `.env*`) |
| CORS | **No CORS middleware configured** in `server.ts` — Express defaults (same-origin only unless a browser allows it) apply; since frontend and API are served from the same origin/port in this architecture, this is likely fine as-is but would need explicit configuration if ever split into separate frontend/backend deployments |
| Security headers | **No helmet.js or manual security headers found** (no CSP, no X-Frame-Options, no HSTS configuration) |
| Admin route protection | UI-only hiding of buttons; the `/admin` page itself and all its sub-views are reachable by any role at the routing level (Section 8/11) |

**Overall verdict: this codebase is not safe to expose on the public internet as-is for anything beyond a read-only demo.** Every mutation endpoint can be hit by anyone who inspects the network tab and replays a request with a forged `x-user-role: Admin` header. This must be the top-priority item before any real deployment.

---

## 22. ENVIRONMENT VARIABLES (from `.env.example`, the only env-related file present)

| Variable | Required locally | Required production | Secret | Public | Purpose |
|---|---|---|---|---|---|
| `GEMINI_API_KEY` | Optional (unused by current code) | Optional (unused by current code) | Yes | No | Documented as required for Gemini AI API calls, auto-injected by AI Studio; **not consumed anywhere in `src/` or `server.ts`** — effectively dead config today |
| `APP_URL` | Optional | Optional | No | Yes (URL, not sensitive) | Documented as the Cloud-Run-injected hosting URL for self-referential links/OAuth callbacks; **no OAuth exists, and no code reference to `process.env.APP_URL` was found** — also effectively dead config today |
| `PORT` | No (defaults to `3000`) | Yes, typically set by host | No | Yes | Read directly in `server.ts` (`process.env.PORT`) — this one IS actually consumed |
| `NODE_ENV` | No | Yes (`production` to enable static `dist` serving instead of Vite dev middleware) | No | Yes | Read directly in `server.ts` to branch dev/prod server behavior — **actually consumed, and load-bearing for correct production behavior** |
| `DISABLE_HMR` | No | N/A | No | Yes | Read in `vite.config.ts` to disable HMR/file-watching, an AI-Studio-specific agent-editing accommodation |

**No database URL, no session secret, no API keys for any third-party service (analytics, email, storage, payments) exist anywhere in the environment configuration** — consistent with the finding that none of those integrations are implemented.

---

## 23. EXTERNAL INTEGRATIONS

| Integration | Purpose (intended) | Current status | Evidence |
|---|---|---|---|
| Google Gemini (`@google/genai`) | AI Studio platform capability flag | **Installed, not wired into any code path** | package.json + zero grep matches in `src/` |
| Google Fonts | Typography (Cinzel, Newsreader, Plus Jakarta Sans, JetBrains Mono) | **Active**, loaded via `<link>` in `index.html` | `index.html` |
| Unsplash (hotlinked images) | Seed/demo imagery for sports/events/media | **Active but fragile** — seed data and default fallback images reference `images.unsplash.com` URLs directly; no local caching/proxying, subject to hotlink breakage or Unsplash policy changes | `server.ts` default `featuredImage` fallback, `AdminUsers.tsx` default avatar, seed data |
| Any sports data provider/API | Real-time scores, schedules, results | **NOT IMPLEMENTED / NOT INTEGRATED** — all sports content is hand-authored seed data |
| Any object storage (S3/R2/MinIO) | Media hosting | NOT IMPLEMENTED |
| Any auth provider | Login | NOT IMPLEMENTED |
| Any analytics/monitoring (GA4, Sentry, etc.) | Traffic/error tracking | NOT IMPLEMENTED |
| Any email service | Transactional email (password reset, notifications) | NOT IMPLEMENTED (no email flows exist to need it) |
| Google Search Console / Bing Webmaster | SEO verification | NOT IMPLEMENTED (no verification meta tags found in `index.html`) |

---

## 24. TESTING + BUILD

- **No test files exist** anywhere in the repo (`*.test.*`/`*.spec.*` search returned nothing). **No test runner is installed** (no Jest, Vitest, Playwright, Cypress in `package.json`).
- **"Lint" is `tsc --noEmit`** — a type-check, not a real lint (no ESLint config file found).
- **Build (`vite build`) was NOT executed** in this investigation (per instructions to avoid environment changes, and because `node_modules` isn't installed here — running it would first require `npm install`, an environment-modifying action outside this discovery task's scope). **Cannot confirm the project currently builds cleanly without running it.**
- **No CI configuration** found (no `.github/workflows/`, no `.gitlab-ci.yml` — not searched exhaustively beyond the top-level tree, but nothing surfaced in the full repo listing).

---

## 25. VPS / DEPLOYMENT READINESS: **NOT READY**

- No `Dockerfile`, no `docker-compose.yml`, no Nginx config, no process manager config (no `ecosystem.config.js` for PM2, no systemd unit) — all confirmed absent by direct search.
- `npm run start` = `tsx server.ts` — running TypeScript directly via `tsx` in "production" is workable but non-standard for a hardened deployment (typically you'd compile server.ts or bundle it; there's no separate server build step, only `vite build` for the client bundle).
- Data persistence via a single JSON file is fundamentally unsuited for any multi-instance or horizontally-scaled deployment (no locking, no concurrent-write safety, single point of failure, no backup/restore tooling).
- Hardcoded production domain (`sportingspy.com`) baked into `server.ts`'s sitemap/robots generation — would need to become an environment variable before deploying to any other domain/staging environment.
- **DEVELOPER_HANDOFF.md's own "For VPS Production Migration" list (PostgreSQL, SSR/SSG, session auth, object storage, CDN caching) is accurate as a to-do list** — it correctly identifies these as NOT YET DONE, which is a rare case of the handoff doc being honest about gaps rather than overselling.

---

## 26. DOCUMENTATION STATUS — CROSS-CHECK AGAINST CODE

`DEVELOPER_HANDOFF.md` is **largely accurate on structure and route mapping** (verified line-by-line against the actual file tree and `App.tsx`), but contains claims that this investigation found to be **overstated or misleading**:

- Claims "Server-Side RBAC Enforcement on all mutation endpoints" — **technically true that endpoints check a role**, but omits that the role identity itself is entirely unverified/spoofable. A future developer reading only the handoff doc would likely believe this is real security. **It is not.**
- Lists "Full CRUD for permanent events and staged tournament editions" as fully implemented — true at the API layer, but doesn't mention that **EventEdition deletion has no orphan-article guard** (unlike Sport/Event deletes, which do).
- Lists "Dynamic SEO Head with OpenGraph and Schema.org JSON-LD" as fully implemented — true that the mechanism exists, but doesn't mention that Twitter card tags are NOT dynamically updated (only OG tags are), and doesn't mention the client-side-only rendering timing issue for non-JS crawlers.
- Does not mention that **new user creation via the Admin > Users desk is a non-persistent client-side-only mock** — this is a meaningful functional gap the handoff doc is silent on.
- Does not mention that the **AdminSeoAudit desk's "Schema Entity Compliance" and "Canonical URL Resolution" metrics are hardcoded literals**, not real computed diagnostics.
- Does not mention the **hardcoded `auth-alistair` bypass** in the article-ownership check.
- `README.md` is 100% generic AI Studio boilerplate and carries no project-specific information — do not rely on it for anything beyond "how to `npm install`/`npm run dev`."

**Conclusion: treat `DEVELOPER_HANDOFF.md` as a reasonably reliable structural map, but not as a security or completeness audit — it describes intent and surface-level functionality, not edge cases or the trust model.**

---

## 27. REQUIREMENTS CROSS-CHECK MATRIX

| Requirement | Current implementation | Status | Evidence | Missing work |
|---|---|---|---|---|
| Sport→Event→Edition→Article hierarchy | Full model + routing implemented | IMPLEMENTED | `types/index.ts`, `App.tsx` | Referential integrity checks on write |
| Persistent relational database | JSON flat file | NOT IMPLEMENTED | `server.ts` | Full DB migration (Postgres+ORM) |
| Real authentication | Header-spoofable role simulation | NOT IMPLEMENTED | `server.ts getRequestUser` | Real session/credential system |
| Server-side RBAC | Role-array checks present, identity unverified | PARTIAL | `requireRoles()` | Bind role checks to verified sessions |
| Article CRUD + workflow | Present, functional | IMPLEMENTED | `AdminArticles.tsx`, `server.ts` | Rich-text editor, content sanitization, restore/undo |
| Scheduled publishing | Working interval-based daemon | IMPLEMENTED | `server.ts setInterval` | None significant |
| Comments + moderation | Working, no safety features | PARTIAL | `server.ts`, `CommentsSection.tsx` | Rate limiting, spam control, author edit |
| Media library | Metadata-only registry | FOUNDATION ONLY | `AdminMedia.tsx` | Real upload + storage + processing |
| Search | Client-side substring filter | PARTIAL | `SearchPage.tsx` | Server-side/indexed search, pagination, fuzzy match |
| SEO meta/OG/JSON-LD | Real mechanism, partial coverage | PARTIAL | `SeoHead.tsx` | Twitter tags, SSR for crawlability, verify JSON-LD payload completeness per page |
| SEO diagnostics desk | Mixed real/hardcoded | PARTIAL | `AdminSeoAudit.tsx` | Replace hardcoded compliance metrics with real checks |
| Sitemap/robots | Real, dynamic, DB-driven | IMPLEMENTED | `server.ts` | Env-driven domain instead of hardcoded |
| Redirects (301/302) | Real server-level engine | IMPLEMENTED | `server.ts` middleware | Uniqueness constraint on sourceUrl |
| Ads (default off, sponsor slots) | Real config, no ad network | IMPLEMENTED (as scoped) | `AdminAds.tsx`, `AdSlot.tsx` | Real programmatic ad network integration (if ever desired) |
| Audit logging | Real, append-only | IMPLEMENTED | `server.ts` | IP/user-agent capture, admin UI filtering (unverified) |
| Dynamic sports-driven navigation | Real | IMPLEMENTED | `Header.tsx` | Mobile menu `isVisible` filter inconsistency (bug) |
| Branding centralization | Names/fonts/socials yes; colors no | PARTIAL | `branding.ts` | Wire colors through a real Tailwind theme/token layer |
| Static legal pages | Hardcoded content, no CMS | FOUNDATION ONLY | `StaticPages.tsx` | Make these admin-editable if required |
| User account creation (staff) | Client-only mock | NOT IMPLEMENTED (server-side) | `AppContext.addUser` vs `server.ts` | Add `POST /api/users` + persistence |
| AI/Gemini features | Installed dependency, unused | NOT IMPLEMENTED | grep results | Decide whether to build or remove the dependency |
| Testing | None | NOT IMPLEMENTED | filesystem search | Add unit/integration/e2e coverage |
| Deployment tooling | None | NOT IMPLEMENTED | filesystem search | Dockerfile, process manager, reverse proxy config |

---

## 28. KNOWN BUGS / TECHNICAL DEBT (concrete, code-cited)

1. **`AdminUsers.tsx` "Add Staff User" silently fails to persist** — no `POST /api/users` route exists server-side; the new user is local React state only and disappears on page refresh. Confirmed by comparing `AppContext.addUser` (no `apiCall`) against the full list of routes in `server.ts`.
2. **Hardcoded ownership bypass:** `existing.authorId !== 'auth-alistair'` in `PUT /api/articles/:id` lets any Author edit this one specific seeded author's articles regardless of actual ownership — looks like debug leftover.
3. **`EventEdition` delete has no orphan-article guard**, unlike Sport and Event deletes which explicitly check for dependents.
4. **Mobile nav sports list (`sports.slice(0,8)`) doesn't filter by `isVisible`** the way the desktop mega-menu does (`sports.filter(s => s.isVisible)`) — a hidden sport could still appear in the mobile menu.
5. **`AdminSeoAudit.tsx` reports fabricated 100%/"Unified" compliance metrics** unconditionally, regardless of actual data state — misleading if relied upon.
6. **RBAC identity is entirely client-supplied and unverified** — not a "bug" so much as a fundamental, load-bearing architectural gap that must be fixed before any non-trivial deployment (Section 13/21).
7. **Dual sitemap/robots sources** (static `public/` files vs. dynamic server routes) could diverge or collide depending on how the production static-file server is configured — needs an explicit decision (delete the static ones, or confirm route precedence).
8. **Hardcoded production domain `sportingspy.com`** in `server.ts`'s sitemap generator and `robots.txt` — will produce wrong URLs on any other environment.
9. **`@google/genai` and `motion` dependencies appear unused** in current application code — worth confirming with a full-codebase grep before either wiring them up or removing them to reduce bundle size/confusion.
10. **`Article.content` rendering path was not verified** for XSS safety — highest-priority follow-up read (`src/pages/ArticlePage.tsx`).

---

## 29. RISKS

- **Security risk (high):** spoofable RBAC means this cannot be deployed publicly as-is without becoming a fully open read/write database to anyone who inspects network requests.
- **Data integrity risk (medium):** no referential integrity enforcement beyond a few hand-coded orphan checks; a single corrupted or manually-edited `data/db.json` can break the app with no validation layer to catch it.
- **Scalability risk (medium-high):** JSON-file-per-request read/write will not survive concurrent writes or meaningful traffic; there is no locking mechanism, so simultaneous requests could corrupt or lose data (classic read-modify-write race condition, visible in every handler's `getDb()` → mutate → `saveDb()` pattern).
- **SEO/crawlability risk (medium):** pure client-side rendering with post-mount `document.title`/meta updates means non-JS crawlers see only the static, generic `index.html` meta tags — mitigated only by the dynamic sitemap/robots and (presumably) server-rendered redirect behavior, but not by SSR of actual page content.
- **Content-security risk (unverified, potentially high):** if `Article.content` is rendered unsanitized via `dangerouslySetInnerHTML`, any user/role able to create/edit articles (including a Reader if the RBAC spoof is exploited) could inject arbitrary script — needs immediate verification.
- **Documentation-trust risk (low-medium):** `DEVELOPER_HANDOFF.md` is fluent and confident-sounding but omits several of the gaps this investigation found — a future agent trusting it at face value would ship with false confidence about RBAC and SEO-audit completeness.

---

## NEXT DEVELOPMENT MAP

### PHASE 0 — Critical fixes (do before anything else touches this codebase)
- **Verify `ArticlePage.tsx`'s content rendering path** for XSS exposure; sanitize or switch to a safe Markdown renderer if raw HTML injection is found. *Files:* `src/pages/ArticlePage.tsx`. *DB migration needed:* No. *External integration:* No (unless adopting a markdown lib, e.g. `react-markdown` + `rehype-sanitize`).
- **Document/communicate the RBAC spoofing gap** to any stakeholder before this is ever exposed outside localhost — this is not a "nice to have," it's a live data-integrity and content-security hole. *Files:* `server.ts`. *DB migration needed:* No (a fix requires real auth, see Phase 1). *External integration:* No, just a decision/communication step.
- **Fix the `auth-alistair` hardcoded ownership bypass** in `PUT /api/articles/:id` — either remove it or replace with a deliberate, documented "senior author override" concept if that was the intent. *Files:* `server.ts`. *DB migration:* No.
- **Add the orphan-article guard to `EventEdition` deletion**, mirroring the existing Sport/Event pattern. *Files:* `server.ts`. *DB migration:* No.

### PHASE 1 — Core missing functionality
- **Real authentication + session management** (e.g., Lucia, NextAuth-equivalent, or hand-rolled JWT+httpOnly cookies) to replace the header-spoofable role system. *Files:* `server.ts` (new auth routes/middleware), `AppContext.tsx` (replace `switchUserRole`/`localStorage` identity), `Header.tsx` (replace role-switcher with real login/logout UI). *DB migration needed:* Yes — `User` needs a password/credential field (or an external-provider link table). *External integration:* Possibly an auth provider, or self-hosted bcrypt+JWT.
- **Persist staff user creation server-side** (`POST /api/users`). *Files:* `server.ts`, `AppContext.addUser`. *DB migration:* Trivial (same shape, just needs the route). *External integration:* No.
- **Real media upload + storage** (local disk with multer as a stepping stone, or object storage for production). *Files:* `AdminMedia.tsx`, new `server.ts` upload route. *DB migration:* Extend `MediaItem` with storage-key/path fields. *External integration:* Optional — S3/R2 for production-grade storage.
- **Link `MediaItem` to `Article.featuredImage`** as a real foreign key instead of a disconnected URL string, enabling usage tracking. *Files:* `types/index.ts`, `server.ts`, `AdminArticles.tsx`, `AdminMedia.tsx`. *DB migration:* Yes (schema change).

### PHASE 2 — Production hardening
- **Migrate `data/db.json` to a real database** (PostgreSQL + an ORM such as Drizzle or Prisma, per the handoff doc's own recommendation) to solve concurrency/integrity/scale risks. *Files:* replaces most of `server.ts`'s data-access code. *DB migration:* Yes, the big one — full schema definition + migration scripts + data-import script from the existing JSON. *External integration:* A hosted or self-managed Postgres instance.
- **Add input validation** (Zod schemas) on every API request body. *Files:* `server.ts`. *DB migration:* No.
- **Add rate limiting** (express-rate-limit) especially on comment creation and auth endpoints once they exist. *Files:* `server.ts`. *DB migration:* No.
- **Add security headers** (helmet.js) and explicit CORS policy. *Files:* `server.ts`. *DB migration:* No.
- **Environment-drive the hardcoded `sportingspy.com` domain** used in sitemap/robots generation. *Files:* `server.ts`. *DB migration:* No.
- **Add a real test suite** (Vitest for unit/component, Playwright for e2e) starting with the RBAC middleware and the redirect engine, since those are the highest-risk pieces of custom logic. *Files:* new `tests/` or `*.test.ts` colocated files. *DB migration:* No.

### PHASE 3 — SEO & content intelligence
- **Add server-side rendering or static generation** for public content routes to fix the crawlability gap. *Files:* likely a framework migration (Next.js) or a custom Vite SSR setup — a significant architectural change. *DB migration:* No, but query patterns would need adjusting for server-side data fetching. *External integration:* No.
- **Replace hardcoded `AdminSeoAudit.tsx` compliance metrics** with real computed checks (verify JSON-LD presence/shape per article, verify canonical resolution against actual route logic). *Files:* `AdminSeoAudit.tsx`. *DB migration:* No.
- **Add Twitter card dynamic updates** to `SeoHead.tsx` (currently only OG tags update). *Files:* `SeoHead.tsx`. *DB migration:* No.
- **Move server-side/indexed search** (even a simple SQLite FTS5 or Postgres `tsvector` once a real DB exists) to replace the client-side substring filter, which won't scale past the current small seed dataset. *Files:* `SearchPage.tsx`, new `server.ts` search route. *DB migration:* Depends on Phase 2's DB choice. *External integration:* Optional (Meilisearch/Algolia) if scale demands it.

### PHASE 4 — Media infrastructure
- **Image processing pipeline** (Sharp) for resizing/format conversion on upload. *Files:* new upload-handling code in `server.ts`. *DB migration:* Extend `MediaItem` with generated-variant URLs. *External integration:* No (Sharp is a local library) unless combined with a CDN.
- **CDN/caching layer** for media and article routes. *Files:* deployment config, not app code. *External integration:* Yes (Cloudflare or similar).

### PHASE 5 — Monetization
- **Real ad network integration** if/when the business decides to move beyond direct sponsorships. *Files:* `AdSlot.tsx`, `AdminAds.tsx`. *DB migration:* Possibly, to store network-specific slot IDs. *External integration:* Yes (Google Ad Manager, etc.) — currently correctly OFF and should stay that way until a deliberate business decision is made.

### PHASE 6 — Deployment/VPS
- **Write a `Dockerfile` + reverse proxy config** (Nginx) once the database migration (Phase 2) is complete — containerizing the current JSON-file architecture is possible but not recommended given its concurrency limitations. *Files:* new `Dockerfile`, `nginx.conf`, possibly `docker-compose.yml`. *DB migration:* Depends on Phase 2 timing. *External integration:* A VPS/hosting provider, and a managed or self-hosted Postgres instance.
- **Process management** (PM2 or systemd) for the Express server in production. *Files:* new config file. *DB migration:* No.

### PHASE 7 — Future integrations
- **Decide the fate of `@google/genai`**: either build the AI-assisted features implied by `metadata.json`'s capability flag (AI-assisted SEO suggestions, AI image tagging, AI-assisted drafting) or remove the unused dependency. *Files:* wherever the feature is built, or `package.json` if removed. *External integration:* Yes, if built (Gemini API).
- **Analytics/monitoring** (GA4 + Sentry or similar) once there's real traffic to observe. *Files:* new instrumentation across `App.tsx`/`server.ts`. *External integration:* Yes.
- **Search Console/Bing Webmaster verification** once the domain is live in production. *Files:* `index.html` meta tags. *External integration:* Yes.

---

---

## Phase 0.1 Security Hardening

**Status: applied. This is still NOT production authentication.** This section documents what changed, why, and what remains.

### Old vulnerability (removed)

`server.ts` used to trust client-supplied `x-user-id` / `x-user-role` HTTP headers (or equivalent query params) as proof of identity and role. Any HTTP client — curl, a browser devtools `fetch` override, anything — could send `x-user-role: Admin` and pass every `requireRoles([...])` check, because the server looked the header value up directly with no verification of who actually sent it. This affected every mutation endpoint (articles, sports, events, editions, comments, authors, users, media, ads, redirects) plus the `?preview=true` query-string bypass on `GET /api/data` / `GET /api/articles`, which let anyone view unpublished draft articles without any credential at all.

### New authorization architecture

```
Request → getAuthContext() [server/auth.ts] → requireAuth()/requireRole() → route handler
```

- **`server/auth.ts`** (new file) is now the single, centralized place that decides who is making a request and what they're allowed to do. Route handlers no longer read headers themselves — they call `requireRole(getUsersFromDb, ['Admin', ...])` or `requireAuth(getUsersFromDb)` as Express middleware, and read the result from `req.authContext` (a typed `AuthContext`: `{ authenticated, userId, userName, role, source }`).
- **Client-supplied identity headers are never read for authorization anywhere in the codebase anymore.** `getRequestUser()` and `requireRoles()` (the old functions) were deleted outright, not renamed or wrapped.
- **`server/validation.ts`** (new file) centralizes input validation (`validateText`, `validateSlug`, `validateSafeUrl`, `validateRedirectSource`, `firstError`) — no new dependency was introduced.

### Development authentication mechanism (explicitly NOT production auth)

Since no real authentication system exists yet, request identity in this phase is decided **entirely by the server operator's environment variables**, never by the browser:

- `DEV_USER_ROLE` (`Admin`|`Editor`|`Author`|`Reader`, default `Reader` — least privilege if unset/invalid) — the single role granted to every authenticated request this server process handles.
- `DEV_USER_ID` (optional) — pins the acting identity to a specific seeded `User` record for more meaningful audit-log attribution.
- `DEV_AUTH_TOKEN` (optional shared secret) — if set, a request must present it via the `x-dev-auth-token` header to be considered authenticated at all; otherwise it's treated as anonymous (401 on any protected endpoint). If left unset, the server runs "wide open" for zero-friction local dev (every request is the configured dev identity) and **prints a startup warning** every time so this is never silently mistaken for something safe.
- `AUTH_MODE=production` makes the server **refuse to start** (`process.exit(1)`) — a guardrail so nobody accidentally ships this shim as if it were real security.
- `VITE_DEV_AUTH_TOKEN` — the frontend's copy of `DEV_AUTH_TOKEN`, sent automatically by `AppContext.apiCall` via the `x-dev-auth-token` header so local CMS testing doesn't require manual curl.

This proves "this is my own trusted local frontend," it does **not** let the browser choose a role — the role is fixed by `DEV_USER_ROLE` on the server regardless of what any client claims. All of this can be replaced later by real authentication (sessions/JWT/OAuth) by rewriting only `server/auth.ts` — no route handler needs to change again.

### Role/permission behavior (unchanged in scope, now actually enforced against a real identity)

| Role | Can do |
|---|---|
| Admin | everything — full CRUD on all resources, role changes, redirects, ad config |
| Editor | articles/events/editions create+update (not delete on sports/events/editions), comment moderation, author create+update, media create+update |
| Author | articles create + update **own only** (the previous hardcoded `auth-alistair` bypass that let any Author edit that one seeded author's articles regardless of ownership has been **removed**), media create |
| Reader | comment creation only (auto-pending) — and only with a valid dev credential now (see limitation below) |

### XSS audit result

`ArticlePage.tsx` (and comments, author bios, titles, captions) render all user/editor-controlled text as plain React JSX text nodes (`{article.content}`-derived paragraphs, `{comment.content}`, etc.) — React escapes these automatically. **No `dangerouslySetInnerHTML` is used for article/comment/author content anywhere.**

The only two `dangerouslySetInnerHTML` call sites in the codebase are `SeoHead.tsx` and `Breadcrumbs.tsx`, both rendering `JSON.stringify(...)` output into `<script type="application/ld+json">` tags. **This was a real, fixable gap**: `JSON.stringify` does not escape `<`, so an article title or breadcrumb label containing `</script><script>alert(1)</script>` could break out of the JSON-LD script tag and execute. **Fixed** by escaping `<` to `<` in both files before injection (`.replace(/</g, '\\u003c')`) — verified to (a) eliminate the literal `</script>` breakout sequence and (b) still `JSON.parse()` back to the exact original string, so no legitimate data is altered. Confirmed via a standalone script with a real breakout payload.

### Input validation changes

Added presence/length/format checks (via `server/validation.ts`) to: article create+update (title, content, slugs, subtitle, excerpt, featuredImage, SEO fields), sport create+update, event create, edition create (including a `year` range check), author create (plus a newly-added slug-uniqueness check that didn't exist before), comment create (content length), media create, ad slot update, and redirect create+update. None of this existed before beyond bare `if (!body.x)` presence checks.

### Redirect security

Added `validateRedirectSource()` (source must be a relative `/`-prefixed path on this site — an absolute external source never made sense and is now rejected) and reused `validateSafeUrl()` for the target (must be `http://`, `https://`, or a relative path — rejects `javascript:`, `data:`, `vbscript:`, and malformed URLs). The existing loop-prevention, self-redirect check, and 5-hop chain detection in the Express middleware were verified intact and unmodified — confirmed working via a live 301 test after these changes.

### Audit logging

Verified intact: every mutation handler still writes an `AuditLog` entry. **The actor identity recorded is now the server-derived `AuthContext` (`userId`/`userName`), never a client-supplied value** — closing the same trust gap for audit attribution that existed for authorization. No existing audit history was deleted; `data/db.json` was restored byte-for-byte after testing (verified: 63,870 bytes before and after).

### Error handling

Unauthenticated requests now correctly return **401** (previously there was no concept of "unauthenticated" — everything defaulted to a Reader identity). Wrong-role requests return **403** with a message naming the required roles and the caller's actual (server-derived) role — no stack traces, file paths, or internals are exposed in any error response (verified by inspecting every `catch`/error-response path touched in this phase).

### Frontend adjustment

`Header.tsx`'s and `AdminUsers.tsx`'s role switcher UI is now explicitly labeled as a **UI preview tool, not authentication** — it still hides/shows admin UI elements locally, but `AppContext.switchUserRole` no longer has any effect on server authorization. `AppContext.apiCall` no longer sends `x-user-id`/`x-user-role`; it sends `x-dev-auth-token` (from `VITE_DEV_AUTH_TOKEN`) when configured.

### Tests performed (live, against a running local server — not fabricated)

All 10 requested tests were executed with real HTTP requests against `npx tsx server.ts` running on a local port, using a temporary `DEV_AUTH_TOKEN`/`DEV_USER_ROLE` configuration, against a **backed-up-and-restored** copy of `data/db.json` (verified byte-identical, 63,870 bytes, before/after):

1. **Unauthenticated mutation → rejected**: `POST /api/sports` with no credential → `401`. ✅
2. **Forged `x-user-role: Admin` header → does not grant Admin**: same request with `x-user-role: Admin` / `x-user-id: user-admin-1` and no valid `x-dev-auth-token` → still `401`. A second check sent a *valid* `x-dev-auth-token` but with `x-user-role: Reader` while the server was configured `DEV_USER_ROLE=Admin` — the mutation **succeeded**, proving the server used its own configured role and ignored the client-sent role header entirely. ✅
3. **Unauthorized role attempts Admin-only mutation**: server configured `DEV_USER_ROLE=Editor`, `POST /api/sports` → `403 Forbidden: this action requires one of [Admin]. Current development role: 'Editor'.` ✅
4. **Authorized dev identity permitted per configured role**: same Editor identity, `POST /api/events` (Editor-allowed) → `201 Created`. ✅
5. **Invalid content cannot execute script**: posted an article with title `XSS Test </script><script>alert(1)</script>` → stored successfully as inert data (`201`); confirmed separately that the JSON-LD rendering path neutralizes the breakout sequence (see XSS section above). An empty-title/near-empty-content request was correctly rejected (`400`). ✅
6. **Invalid redirect destination rejected**: `targetUrl: "javascript:alert(1)"` → `400`; an absolute external `sourceUrl` → `400`; a legitimate `/old-page → /latest` redirect → `201`, and a live request to `/old-page-phase01` returned a real `HTTP 301` with `Location: /latest`. ✅
7. **Existing legitimate CRUD still works for authorized dev identity**: Admin identity created and then deleted a test Sport, both `200`/`201` as expected. ✅
8. **Existing public read-only routes still work**: `GET /api/data` (no credential) → `200` with full sports/events/articles payload. ✅
9. **Existing 301/302 redirect behavior still works**: confirmed above in test 6 — real HTTP 301 issued by the Express middleware, unchanged. ✅
10. **Existing scheduled publishing still works**: created an article with `status: scheduled` and `scheduledFor` one minute in the past; after the next `/api/data` call (which triggers `publishScheduledArticles()`), the article's status had flipped to `published` automatically. ✅

`npm run lint` (`tsc --noEmit`) passes with zero errors. `npm run build` (`vite build`) completes successfully (475KB JS bundle, pre-existing `__dirname` config warning unrelated to this phase). No test framework exists in this project (still true — out of scope for this phase per instructions).

### Remaining limitations (explicitly not solved by this phase)

- **Real production authentication is NOT implemented.** There is still no login, no password, no session, no per-visitor identity. The entire server acts as one operator-configured identity. `AUTH_MODE=production` refusing to start is the only thing standing between this and someone deploying it as-is.
- **Comments now require the dev auth token to post at all**, since there is no real per-visitor account system to distinguish "an anonymous site reader" from "an untrusted API caller." This is a deliberate, documented trade-off: real anonymous reader commenting needs real end-user accounts (Phase 1), not just this hardening pass.
- **`EventEdition` deletion still has no orphan-article guard** (a pre-existing gap noted in the original discovery; not in scope for this authorization-focused pass — tracked for Phase 1/2).
- **Referential integrity for slugs/IDs on write is still not enforced** (e.g., you can still create an Article with a non-existent `sportSlug`) — validation added in this phase checks *format*, not *existence*, to stay within this phase's scope.
- **No rate limiting** was added — a valid dev-token holder can still make unlimited requests. Tracked for Phase 2.
- **Author email format is validated only as a length-capped string**, not a real email-format check — acceptable for this phase, worth tightening later.
- Some `PUT` (partial update) endpoints — events, editions, authors, media, ads — received targeted validation additions only where most impactful (author slug uniqueness, ad `linkUrl`/text fields, redirect fields); a few less-critical `PUT` handlers still merge `req.body` with fewer explicit field-level checks than the `POST`/create equivalents. Not a regression — this matches the pre-existing pattern — but worth a follow-up pass in Phase 2.

*This section documents Phase 0.1 only. Real authentication, the PostgreSQL migration, rate limiting, and the remaining items above are tracked in the NEXT DEVELOPMENT MAP phases above.*

---

## Phase 1 — Authentication & Staff Identity

**Status: applied and live-tested (23/23 tests passing).** This phase replaces the Phase 0.1 development-only authorization shim with real email+password authentication and server-side sessions. **This is still not a fully production-ready auth system** — see Remaining Limitations below — but the core trust model is now real: a session cookie proves nothing the browser could have faked, and every role decision is resolved server-side from that session.

### Authentication architecture

```
Request → session cookie (opaque, HttpOnly) → server/session.ts lookup
        → data/db.json `sessions` collection → matching `users` record
        → AuthContext { authenticated, userId, userName, role }
        → requireAuth() / requireRole() [server/auth.ts, unchanged interface from Phase 0.1]
        → route handler
```

The Phase 0.1 `DEV_USER_ROLE` / `DEV_AUTH_TOKEN` / `VITE_DEV_AUTH_TOKEN` environment variables are **gone** — not renamed, not read anywhere. In their place:

- **`POST /api/auth/login`** — email + password → server looks up the user by email, verifies the password against a stored hash (never plaintext), creates a session record, and sets an HttpOnly cookie. Returns only the safe user projection (see below).
- **`POST /api/auth/logout`** — deletes the session record server-side and clears the cookie.
- **`GET /api/auth/me`** — resolves the current session (if any) and returns the safe user, or `401` if not authenticated. This is the *only* place the frontend establishes "am I logged in" — never from `localStorage`.
- **Optional `DEV_LOGIN_BYPASS`** (disabled by default, env-var gated, blocked outright if `AUTH_MODE=production`) — for scripted local testing convenience only. It only ever applies when **no session cookie is present at all**; a real login always wins. See `server/auth.ts` for the exact precedence.

### Session architecture — server-side sessions, opaque cookie

The cookie the browser holds contains **only a random 256-bit token** (`sid`) — never a userId, role, or any other claim. That token is looked up against a `sessions` array now persisted in `data/db.json` (mirroring this project's existing "everything lives in the JSON store" pattern, and directly analogous to a `sessions` table a future PostgreSQL migration would add). Consequences of this design, documented in `server/session.ts`:

- The browser cannot forge a session (guessing a 256-bit value is computationally infeasible) and cannot escalate a session's role (role isn't in the cookie — it's resolved server-side from the session's `userId` on every request).
- **No signing/encryption secret is needed for the cookie** — it carries no data to tamper with, only an identifier to look up. This is the same trust model as PHP's default sessions or `express-session` with a database store.
- Sessions **survive a server restart** because they're in `data/db.json`, not an in-memory Map.
- Cookie attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`, 7-day `Max-Age`, and `Secure` when `NODE_ENV=production` (omitted in local dev over plain `http://`, where a `Secure` cookie would simply never be sent).
- No `cookie-parser` dependency was added — the Cookie header format is simple enough to parse in a few lines (`server/session.ts:parseCookies`).

### User data model

Extended (not replaced) the existing `User` type in `src/types/index.ts`:

```
User {
  id, name, email, role, avatar,
  joinedAt        // pre-existing field, now doubles as createdAt
  updatedAt?      // new
  status?         // new: 'active' | 'inactive', defaults to 'active'
  passwordHash?   // new: SERVER-ONLY, optional so the type can also describe the safe client shape
}
SafeUser = Omit<User, 'passwordHash'>   // what the client ever receives
SessionRecord { id, userId, createdAt, expiresAt }   // new, persisted in data/db.json's `sessions` array
```

A `sanitizeUser()` serializer (`server.ts`) strips `passwordHash` before any response — applied to `/api/auth/login`, `/api/auth/me`, `/api/data`'s `users` array, and every staff-management endpoint response. `/api/data` also now excludes the `sessions` collection entirely — it has no legitimate frontend use.

**Existing seed data migration:** `data/db.json` predates this phase and had no `passwordHash`/`status`/`sessions` fields. A deterministic, idempotent `migrateSchema()` function runs inside `getDb()` on every call (cheap after the first pass — field-presence checks only) and: adds `sessions: []` if missing; assigns each user missing a `passwordHash` a hashed **local-development-only default password (`ChangeMe123!`)**, printed and documented in `.env.example`; sets `status: 'active'` and `updatedAt` where missing. **No existing sports/events/editions/articles/comments content was touched or reset** — verified byte-for-byte (`data/db.json` restored to its exact pre-test 63,870-byte state after live testing).

### Password hashing

`server/password.ts` uses Node's built-in `crypto.scrypt` (no new dependency — scrypt is RFC 7914-standardized and has shipped in Node's stdlib since v10). Each password gets its own random 16-byte salt; stored as `scrypt:<saltHex>:<hashHex>` (self-describing, so the scheme could change later without breaking existing hashes). Verification uses `crypto.timingSafeEqual`. Policy: **minimum 8 characters**, nothing more elaborate — length is a stronger real-world signal than character-class rules, which mostly train people into predictable substitutions.

The login endpoint also runs a **timing-camouflage scrypt computation** on the unknown-email path (against a fixed dummy hash) so response timing can't be used to distinguish "wrong password" from "no such account" — both return the identical `401 Invalid email or password.` (verified live: TEST 2 and TEST 3 below produced byte-identical error bodies).

### Role/permission behavior

Unchanged from Phase 0.1's intended model, now enforced against **real** identity instead of an env-var placeholder:

| Role | Can do |
|---|---|
| Admin | everything |
| Editor | articles/events/editions create+update, comment moderation, author create+update, media create+update |
| Author | articles create + update **own only** (see Author Ownership below), media create |
| Reader | comment creation only (auto-pending) |

Confirmed live: an authenticated Reader gets `403` on `POST /api/sports`; an authenticated Author gets `403` on the same; an authenticated Admin gets `201`; a request with **no session at all** gets `401` regardless of any `x-user-role` header it forges.

### Admin user management — now real

The Phase-0 "Add Staff User" mock (client-state-only, lost on refresh) is replaced with persisted CRUD, Admin-only:

- **`POST /api/users`** — name, email, role, password (hashed immediately) → `201` with the sanitized user. Rejects duplicate emails.
- **`PUT /api/users/:id`** — update name/email.
- **`PUT /api/users/:id/role`** — change role (existing Phase-0 endpoint, now also last-admin-protected).
- **`PUT /api/users/:id/status`** — `active`/`inactive`. Deactivation immediately deletes that user's sessions (they're logged out everywhere).
- **`DELETE /api/users/:id`** — hard delete; also clears their sessions.

**Last-active-Admin protection** (`isLastActiveAdmin()` in `server.ts`): role changes away from Admin, deactivation, and deletion are all blocked with a `400` if the target is the sole remaining active Admin — verified live for all three operations.

### Author ownership — the real fix

Phase 0.1 removed a hardcoded `auth-alistair` bypass but flagged that the underlying ownership check (`article.authorId !== userId`) was comparing values from **two different ID namespaces** — `Article.authorId` references an `Author` profile id (e.g. `'auth-elena'`), while `userId` is a `User` account id (e.g. `'user-editor-1'`) — so the naive comparison could never truly match for a real Author-role user, which is *why* that hardcoded escape hatch existed in the first place.

**Phase 1 fix:** added `Author.userId?: string | null` — the smallest clean relationship between a public byline and the staff account allowed to edit it, designed to become a straightforward foreign key under a future PostgreSQL migration. `migrateSchema()` populates it automatically by matching `Author.email` to `User.email` (case-insensitive) — confirmed live: `auth-alistair` → `user-author-1`, `auth-elena` → `user-editor-1`, and the two author profiles with no matching staff account (`auth-marcus`, `auth-david`) correctly get `null` (not left `undefined`, so they're never re-scanned). Ownership is now checked as "does the article's Author profile belong to the authenticated user" — verified live: Alistair can edit his own article and a freshly created second Author account is correctly blocked (`403`) from touching it.

Article creation's `authorId` default also had to change: it now resolves the acting user's **linked Author profile** first (`db.authors.find(a => a.userId === userId)`), falling back to the raw `userId` only if no linked profile exists yet — documented as a minor limitation (a brand-new Author-role staff account with no provisioned Author profile will get a byline that doesn't resolve to a real `/author/{slug}` page until one is created).

### EventEdition orphan protection

The one Phase 0.1 data-integrity gap left open is now closed: `DELETE /api/editions/:id` checks for any `Article` referencing that edition (via `sportSlug`+`eventSlug`+`year`) and returns `400` if any exist, mirroring the existing Sport/Event delete guards exactly. Verified live against `french-open-2027`, which has 3 dependent articles — delete correctly refused with a clear count in the error message.

### Rate limiting

`server/rateLimit.ts` — a deliberately simple in-memory fixed-window limiter scoped to `POST /api/auth/login` only: max 8 attempts per (IP, email) pair per 15-minute window, `429` with `Retry-After` beyond that, cleared on successful login. Verified live: attempts 1–8 returned `401`, attempt 9 returned `429`.

**Documented limitation** (per this phase's "keep it simple" scope): this state is in-process memory — it resets on restart and does not share state across multiple server instances. A real multi-instance production deployment needs a shared store (Redis or a database table) — tracked for Phase 2.

### Security considerations reviewed this phase

- **CSRF:** not implemented (no token). `SameSite=Lax` blocks the most common cross-site state-changing vectors for a same-origin SPA+API architecture like this one, but it isn't a complete CSRF defense — flagged as a Phase 2 follow-up rather than solved here, to keep this phase's scope to authentication itself.
- **Cookie config:** `HttpOnly` always; `Secure` only in `NODE_ENV=production` (a `Secure` cookie is simply dropped by browsers over plain HTTP, so gating avoids silently breaking local dev); `SameSite=Lax`.
- **Boot-time guard:** `AUTH_MODE=production` now boots successfully (real auth exists), but is refused outright if `DEV_LOGIN_BYPASS=true` is also set — that specific combination would mean a "production" server silently grants a fixed identity to any request with no session.
- **Error responses:** `401` for no/invalid session, `403` for wrong role, `400` for invalid input — no stack traces, file paths, or internals in any response body added this phase.

### Files changed / added

New: `server/password.ts`, `server/session.ts`, `server/rateLimit.ts`. Rewritten: `server/auth.ts` (session-based `getAuthContext`, `requireAuth`, `requireRole`; `DEV_LOGIN_BYPASS` replaces the old dev shim). Extended: `server/validation.ts` (`validateEmail`), `src/types/index.ts` (`User`, `SafeUser`, `SessionRecord`, `Author.userId`). Substantially edited: `server.ts` (new auth endpoints, `migrateSchema()`, `sanitizeUser()`, `isLastActiveAdmin()`, staff CRUD endpoints, fixed article ownership/authorId-default logic, edition orphan guard). Frontend: `src/context/AppContext.tsx` (real `authUser`/`login`/`logout`/`isAuthenticated` replacing the fake role switcher; `credentials: 'include'` fetches replace the dev-token header), `src/components/layout/Header.tsx` (real login form / logout menu replacing the role simulator), `src/components/admin/AdminUsers.tsx` (real staff CRUD UI with password field, status toggle, delete), `src/components/editorial/CommentsSection.tsx` (login-gated comment form), `src/components/admin/AdminLayout.tsx` (updated Reader-role notice copy). `.env.example` updated with Phase 1 variables and the removal of the Phase 0.1 ones.

### STAFF AUTHENTICATION vs PUBLIC USER AUTHENTICATION

This phase only builds **staff authentication** — Admin/Editor/Author/Reader accounts are all provisioned by an Admin via the Users desk; there is still no public self-registration or public login flow for ordinary site visitors. The architecture is deliberately generic enough that adding public registration later means adding a `POST /api/auth/register` endpoint and a public-facing login form against the *same* `users`/`sessions`/password-hashing machinery — not a redesign. This distinction is called out explicitly in `server.ts`'s comment above the comments API, since comment-posting is the one place this limitation is user-visible today (a Reader-role **staff** account can comment; an anonymous site visitor cannot, because there is no public account for them to hold yet).

### Tests executed (live, against a running local server — not fabricated)

All 23 requested tests were run with real HTTP requests against `npx tsx server.ts`, using a backed-up-and-restored copy of `data/db.json` (verified byte-identical, 63,870 bytes, before/after):

1. Login with valid credentials (`editor-in-chief@sportingspy.com` / the migrated default password) → `200` + user payload. ✅
2. Invalid password → `401 Invalid email or password.` ✅
3. Unknown account → `401` with the **byte-identical** error body to test 2 (no enumeration). ✅
4. Session established (cookie set on login). ✅
5. `GET /api/auth/me` with that cookie → `200` + the authenticated user. ✅
6. `POST /api/auth/logout` → session deleted; subsequent `/api/auth/me` → `401`. ✅
7. Unauthenticated `POST /api/sports` → `401`. ✅
8. Same request with forged `x-user-role: Admin` / `x-user-id: user-admin-1` headers and no session → still `401` (header has zero effect). ✅
9. Authenticated Reader → `POST /api/sports` → `403`. ✅
10. Authenticated Author → `POST /api/sports` → `403`. ✅
11. Authenticated Admin → `POST /api/sports` → `201`, then `DELETE` → `200`. ✅
12. `POST /api/users` → `201`; confirmed directly in `data/db.json` that the record has a `passwordHash` and the plaintext password string appears nowhere in it. ✅
13. Confirmed `passwordHash` absent from the create-user response **and** from `/api/data`'s `users` array (which also excludes `sessions` entirely). ✅
14. Attempted role-change, deactivation, and deletion of the sole active Admin → all three correctly refused with `400`. ✅
15. `DELETE /api/editions/french-open-2027` (3 dependent articles) → `400` with an accurate dependent-article count. ✅
16. Confirmed via `grep` that no functional `auth-alistair` bypass remains in `server.ts` — the only matches are explanatory comments about its removal. ✅
17. Alistair (linked via `Author.userId`) successfully edited his own article; a freshly created second Author account was correctly blocked (`403`) from editing it. ✅
18. 8 rapid failed login attempts against one email → all `401`; the 9th → `429`. ✅
19. `GET /api/data` with no session → `200`, published-articles-only. ✅
20. Created an article scheduled 1 minute in the past; after the next request triggered `publishScheduledArticles()`, it was `published` and visible to anonymous readers. ✅
21. Created a redirect and confirmed a real `HTTP 301` with the correct `Location` header. ✅
22. `npm run lint` (`tsc --noEmit`) — zero errors. ✅
23. `npm run build` (`vite build`) — succeeds (479KB JS bundle; pre-existing `__dirname` config warning unrelated to this phase). ✅

### Remaining limitations (explicitly not solved by this phase)

- **Not a complete production authentication system.** No password reset/forgot-password flow, no email verification, no multi-factor authentication, no account lockout beyond the login-rate-limiter, no audit trail of session activity beyond login/logout events.
- **No CSRF token** — relies on `SameSite=Lax` only (see Security Considerations above).
- **Rate limiting is in-process memory** — resets on restart, doesn't scale across multiple server instances (Phase 2).
- **No public user registration/login** — staff-only, by design, this phase (see STAFF vs PUBLIC section above).
- **A new Author-role staff account with no linked Author profile** gets a raw-`userId` byline until an Admin creates a matching Author profile — a minor UX gap, not a security one.
- **Still no PostgreSQL** — `data/db.json` remains the persistence layer; sessions, users, and everything else still share its read-modify-write-the-whole-file concurrency model and its lack of transactions.
- **Session cookie has no rotation-on-privilege-change** — e.g., if a user's role changes mid-session, their *existing* session immediately reflects the new role on the next request (since role is looked up live from `users`, not cached in the session) — this is actually correct/desired behavior, but is worth naming explicitly since some session designs deliberately force re-login on privilege changes instead.

### Exact recommended next phase

**Phase 2: production hardening** — migrate `data/db.json` to PostgreSQL (the `sessions`/`users` shape here was deliberately designed to map onto real tables with minimal translation), add a shared-store rate limiter, add CSRF protection, add password reset, and add the input-validation/security-header items already queued from Phase 0.1's own NEXT DEVELOPMENT MAP. Real public user registration (Phase "1.5" if desired) should follow the same `users`/`sessions`/password-hashing machinery built here rather than a parallel system.

---

*End of PROJECT_BRAIN.md — cross-reference `PROJECT_STATE.json` for the machine-readable equivalent of this document.*
