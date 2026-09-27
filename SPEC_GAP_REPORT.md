# SportingSpy v2.o — Gap Report Against Spec v1.1

**Purpose:** This report is context for planning. It compares the current codebase (`D:\Sporting SPY\v2.o`) with the owner's "SportingSpy Developer Requirements Specification v1.1". It was written on 2026-09-27 by reading the code directly (schema, `server.ts`, `src/App.tsx`, pages, admin components). It does not rely on the project's own docs (`PROJECT_BRAIN.md`, `PHASE4_IMPLEMENTATION.md`).

---

## 1. Verdict

**The data model and domain direction match the spec. The rendering architecture does not.**

- ✅ **On track:** the Sport → Event → Event Edition → Article hierarchy, the URL pattern, the article types (almost all), the CMS sections, redirects, sitemap, robots, RBAC, security hardening and PostgreSQL.
- ❌ **Off track (critical):** the site is a **client-side React SPA**. Every public page is served as an empty `<div id="root">` and filled in by JavaScript. Titles, meta tags, canonicals and JSON-LD are set in the browser after load. Missing pages return HTTP 200 (soft 404). The browser downloads **the entire database** through `/api/data` on every visit. This conflicts with the spec's central goals: strong technical SEO, a fast site, real 404s and scaling to tens of thousands of articles.
- ⚠️ **Drift:** a lot of recent effort went into things the spec says are **not** needed at launch: reader accounts, comments, a Reader role, an account page, and English/Bangla UI for the account area. Meanwhile, core launch items are still missing: real media upload and optimization, a rich article editor, real SEO Intelligence, AdSense, analytics, backups and staging.

**Rough completion against the launch acceptance criteria (§33): about 35–40%.** Foundations are solid. The public rendering layer needs to be rebuilt before launch.

---

## 2. Current tech stack (as found)

| Layer | Current |
|---|---|
| Origin | Exported from Google AI Studio (`metadata.json`, `@google/genai` dependency, README still AI Studio boilerplate) |
| Frontend | Vite + React 19 SPA, Tailwind 4, custom router via `currentPath` in `AppContext.tsx` (no react-router) |
| Backend | Single Express file `server.ts` (~2,000 lines) plus helpers in `server/` |
| DB | PostgreSQL via Prisma 7 (migrated from `data/db.json`) |
| Auth | Email + password (scrypt), opaque server sessions, CSRF, rate limits, security headers |
| Package name | Still `"react-example"` |

---

## 3. Requirement-by-requirement status

Legend: ✅ done / 🟡 partial / ❌ missing / ⛔ built but NOT in launch scope

### 3.1 Content model (§4)

| Spec item | Status | Notes |
|---|---|---|
| Sport fields | ✅ | name, slug, description, order, visibility, SEO JSON, hero image |
| Event fields | 🟡 | Missing **official website/source** and **event type** fields. Has `shortName`, which works as an alternative name. |
| Event Edition fields | 🟡 | Has dates, venue, prize money, defending champions, qualification, participant count, official source, quick facts. **Status enum is `upcoming/ongoing/completed`; spec wants `Upcoming/Active/Completed/Archived`** (no Archived). Sport-specific fields only fit as free-form `quickFacts`; there is no typed per-sport field system. |
| Article fields | 🟡 | Has most fields. There are **no social metadata fields** beyond `ogImage`, and no per-article structured-data control. Unique slugs are enforced in app code only, not in the DB. |
| Relationships | 🟡 | Uses natural keys (`sportSlug`, `eventSlug`, `year`) as foreign keys. **Renaming a sport or event slug will break or cascade through every child row.** The spec requires stable URLs and 301s on URL changes, and nothing auto-creates a redirect when a slug changes. |

### 3.2 Article types (§5)

| Spec item | Status | Notes |
|---|---|---|
| 19 standard types | 🟡 | 18 of 19 match. |
| **"How to Watch"** | ❌ | The code uses **`"Sports Viewing Guide"`** instead (`src/types/index.ts`, `AdminArticles.tsx`, `SearchPage.tsx`, `LatestArticlesPage.tsx`, seed data). The spec explicitly says the type must be called **How to Watch** and that no alternative "viewing/streaming guide" types should exist. This needs a rename plus a data migration of existing rows. |
| Type-aware SEO checks | ❌ | None. |

### 3.3 CMS / admin (§6)

| Spec item | Status | Notes |
|---|---|---|
| Sections: Articles, Sports, Events/Editions, Media, SEO, Users, Ads, Settings | 🟡 | Present: Dashboard, Articles, Sports, Events, Authors, Users, Comments⛔, Media, Ads, SEO, Redirects, Audit. **Missing: Analytics/Insights and Settings** (site-wide settings, analytics IDs, AdSense ID, etc.). |
| Workflow Sport → Event → Edition → Type → Content → Image → SEO Check → Preview → Publish | 🟡 | Dropdowns filter events and editions by sport ✅. The **SEO Check step is missing** from the editor, and there is no real preview of the rendered article. |
| Statuses Draft/Preview/Scheduled/Published/Archived | ✅ | Scheduler auto-publishes every 30 s. |
| Content editor | ❌ | The article body is a **plain `<textarea>`**, rendered by splitting on blank lines (`ArticlePage.tsx`). There are no headings, links, lists, images, embeds or inline tables in the content. That isn't enough for editorial content or for internal and external linking. |
| Admin routing | 🟡 | All admin tabs live on the single URL `/admin` (tab state only), so there are no deep links. |

### 3.4 Public templates (§7)

| Page | Status | Notes |
|---|---|---|
| Homepage | 🟡 | Exists. Check that H1 = "Latest Sports News & Events" and title = "SportingSpy – Latest Sports News, Events, Schedules & Updates"; the current default title is "SportingSpy – Multi-Sport Editorial & Event Guides". |
| Sport / Event / Edition / Article pages | 🟡 | All exist, with breadcrumbs and related content. Everything is **client-rendered** (see §4). |
| Author info on article | ✅ | Author pages exist. |
| Static pages | 🟡 | Exist at `/privacy` and `/terms`; the spec requires **`/privacy-policy/`** and **`/terms-and-conditions/`**. |

### 3.5 URLs, navigation, breadcrumbs (§10–11)

| Item | Status | Notes |
|---|---|---|
| `/sport/event/year/article` pattern | ✅ | Implemented in `App.tsx`. |
| Trailing slash | ❌ | The spec uses trailing slashes (`/tennis/french-open/2028/`). The app strips them and has no canonical trailing-slash policy or redirect, so both variants can serve the same content. |
| Real 404 | ❌ | In production, any unknown path gets `dist/index.html` with **HTTP 200**, and the app then draws a "404" message. That's a soft 404, which the spec explicitly forbids (§18). |
| Breadcrumbs + BreadcrumbList | ✅ | Client-side only. |
| Mega-menu (desktop) / tap menu (mobile) | 🟡 | Header exists; needs checking against the spec. |

### 3.6 Internal and external linking (§12–13)

| Item | Status |
|---|---|
| Link suggestions while editing | ❌ |
| Orphan page detection | ❌ |
| Broken internal/external link detection | ❌ |
| Redirect-hop detection | 🟡 (the redirect engine follows chains at request time; there's no report) |
| rel=sponsored/ugc/nofollow controls | ❌ (the plain-text editor can't hold links at all) |
| Related-content priority (Edition → Event → Sport) | 🟡 (related lists exist; the priority order needs checking) |

### 3.7 SEO Intelligence (§14)

**Status: ❌ essentially a mock-up.** `AdminSeoAudit.tsx` checks only title length, meta description length and whether tables exist. Several cards are **hard-coded to pass** ("Schema Entity Compliance: 100%", "Canonical: Validated/Unified"), which contradicts the spec's rule against fabricated scores.

Missing items:
- Per-article actionable checklist (✓ Sport connected, ⚠ Add official source…)
- Configurable SEO rules engine
- Freshness monitoring
- AI Search Readiness
- AI Content Assistant: `@google/genai` is installed but never used
- Search Console integration
- Event coverage suggestions

### 3.8 Structured data (§15)

| Item | Status | Notes |
|---|---|---|
| NewsArticle, BreadcrumbList, SportsEvent, Person, Organization | 🟡 | Present but **injected client-side**. The homepage uses `SportsOrganization`, and the Sport page uses `SportsSpecialty`, which is questionable. |
| Chosen by article type (Article vs NewsArticle) | ❌ | Every article is NewsArticle. |

### 3.9 Media (§16)

**Status: ❌ metadata registry only.**
- **No file upload.** Media items are URL + metadata records. There is no multipart handling, no storage and no CDN.
- No compression, responsive sizes, WebP/AVIF or srcset.
- Metadata is partial: it has title, alt, caption, credit, source, license and creation type (including AI-created/AI-assisted ✅). **It's missing AI tool, human editing notes, copyright review, and usage history.**
- There is no relationship between media and articles; featured images are free-text URLs. Unused or duplicate detection is impossible.

### 3.10 Search (§17)

**Status: 🟡 client-side filter only.** `SearchPage.tsx` runs `.includes()` over data already loaded in the browser.
- ❌ No server-side search or index (Postgres full-text or trigram would work)
- ❌ No typo tolerance, autocomplete or relevance ranking
- ❌ No search analytics (popular or no-result queries)
- ⚠️ Won't scale, because it depends on the whole DB being in the browser.

### 3.11 Technical SEO and indexing (§18–19)

| Item | Status | Notes |
|---|---|---|
| Dynamic XML sitemap | 🟡 | Exists. Problems: it **includes `/search`** (it shouldn't), includes **all events and editions without a visibility check**, and ignores article `noIndex`. There is **no sitemap index**, and `lastmod` appears only on articles. `changefreq`/`priority` are ignored by Google (harmless). |
| Stale static files | ⚠️ | `public/sitemap.xml` and `public/robots.txt` also exist and can conflict with the dynamic routes. |
| robots.txt | ✅ | Dynamic. |
| Canonical | 🟡 | Client-side only. Falls back to `window.location` (not normalized). |
| Redirect manager | 🟡 | 301/302, loop and chain detection at runtime ✅. **No unique constraint on `sourceUrl`.** No automatic redirect on slug change. |
| Pagination | ❌ | None. `/api/articles` is hard-capped at 500 rows. |
| IndexNow / Bing | ❌ | |

### 3.12 Advertising (§20)

**Status: 🟡 wrong kind of system.** All 9 slot IDs match the spec ✅, and there are admin enable/disable controls ✅. But `AdSlot.tsx` renders **house sponsor banners** (sponsor name, text, link), not **AdSense**. When a slot is disabled it renders `null`, so no space is reserved, which risks CLS when enabled. There's no AdSense client/slot ID config and no `ads.txt`.

### 3.13 Privacy and consent (§21)

❌ No cookie-consent system. It'll be needed once AdSense or analytics are added (for EU/UK traffic). ✅ No newsletter, as required.

### 3.14 Performance (§22)

- ❌ **The entire dataset is downloaded to every visitor** (`GET /api/data` returns all sports, events, editions, articles with full content, authors, comments, media and ads). At thousands of articles, this will make every page slow.
- ❌ There's no content until JavaScript runs, which hurts LCP.
- ❌ No code splitting: admin code is bundled together with the public site.
- ❌ No image optimization or CDN.
- ⚠️ 4 Google font families are loaded, and `motion` (an animation lib) is a dependency. Both are heavy for a content site.
- ❌ No Core Web Vitals / RUM monitoring.

### 3.15 Scalability (§23)

❌ Blocked by the full-DB hydration and client-side routing, search and filtering. DB indexes exist ✅.

### 3.16 Security (§24–25)

| Item | Status |
|---|---|
| Password hashing (scrypt), sessions, expiry, revocation | ✅ |
| Login/password rate limiting | ✅ |
| CSRF, security headers, CORS, input validation, no stack leaks | ✅ |
| RBAC Admin/Editor/Author, enforced server-side | ✅ |
| Audit logs | ✅ |
| Password reset flow | ❌ |
| 2FA/passkeys | ❌ |
| In-memory rate limiter | ⚠️ resets on restart and doesn't work across multiple instances |
| Seed default password `ChangeMe123!` | ⚠️ must be rotated before production |

### 3.17 Environments, backups, owner control (§26–28)

- ❌ No staging environment or deployment docs for a real host (the project's own brain says "VPS NOT READY").
- ❌ No automated backups, off-site copies or tested restore. `DATABASE_OPERATIONS.md` is guidance only.
- ❌ No CI, no git repository (the folder **is not a git repo**, which is a risk by itself).
- ⚠️ `.env.example` still has AI Studio-specific `GEMINI_API_KEY` / `APP_URL` notes.

### 3.18 Analytics and monitoring (§29)

❌ No GA4, no Search Console or Bing verification, no uptime or error monitoring, no broken-link, canonical or sitemap monitoring.

### 3.19 Content freshness (§30)

❌ Not implemented.

### 3.20 Migration from the current site (§31)

❌ No content-inventory tool (KEEP/REWRITE/MERGE/RETIRE), no bulk import from the old site, no bulk redirect import (CSV). The only redirect UI adds rules one at a time.

---

## 4. The critical architectural problem (explained)

The spec's core promises are strong technical SEO, fast pages, real 404s and scaling to tens of thousands of articles. They all depend on the server sending finished HTML for each URL. Right now:

1. The server sends the same empty `index.html` for every public URL.
2. The browser downloads JS, then calls `/api/data` and gets **the whole database**.
3. React picks the page based on the URL and sets `<title>`, meta, canonical and JSON-LD with `useEffect`.
4. Unknown URLs still return **200**.

Google can render JS, but slowly and with a budget. Bing and other crawlers, social previews (Facebook, X, WhatsApp, LinkedIn) and AI crawlers mostly **don't**. So every shared link shows the generic homepage title and description.

**Recommended fix (pick one):**

- **Option A (recommended): move the public site to a server-rendered framework**, such as **Next.js (App Router)**, Astro or Remix. Keep PostgreSQL + Prisma, and reuse the schema, auth, validation and security modules. Page components port with moderate effort. This gives SSR/SSG, per-page metadata, real 404s, ISR caching and image optimization.
- **Option B (smaller step): add SSR to the existing Vite + Express app** (Vite SSR with `renderToString`), with per-route server data loaders instead of `/api/data`. It's less rework now but more custom plumbing to maintain.

Either way:
- Replace `/api/data` with **per-page queries** (only what that page needs).
- Split the admin into its own bundle or route (a lazy chunk at minimum).
- Server-side search.
- Real 404 status codes.

---

## 5. Built but out of launch scope (⛔ drift)

The spec lists these as "Not required at launch / Future". They add attack surface and maintenance:

- **Reader role + public reader accounts** (`/account`, self-service profile, session list)
- **Comments system** (model, API, moderation UI, `CommentsSection` on articles)
- **English/Bangla account UI**

Recommendation: hide or disable them for launch (feature-flag them). Don't delete the code yet; the owner can decide.

---

## 6. Prioritized roadmap to reach the spec

**Phase A: Foundation fixes (do first)**
1. `git init` + first commit; set up a private remote.
2. Rename article type `Sports Viewing Guide` → `How to Watch` everywhere, and migrate existing DB rows.
3. Edition status → `upcoming / active / completed / archived`.
4. Add missing fields: Event `officialSourceUrl`, `eventType`; social metadata on Article.
5. Static page URLs → `/privacy-policy/`, `/terms-and-conditions/`, with 301s from the old paths.
6. Decide on a trailing-slash policy (spec = trailing slash) and 301 the other variant.
7. Feature-flag off comments, reader accounts and the Reader role for launch.

**Phase B: Rendering architecture (biggest item)**
8. Move to SSR (Next.js recommended), with per-page data loading, server-rendered meta, canonical and JSON-LD, and real 404s.
9. Remove the `/api/data` full-DB hydration.
10. Split admin from the public bundle.
11. Pagination on listing pages.

**Phase C: CMS quality**
12. Rich text editor (e.g. TipTap), with headings, lists, links (rel options: sponsored/ugc/nofollow), images and tables.
13. Real media upload: storage (local disk/S3/R2) + sharp for resizing and WebP/AVIF + srcset + lazy loading + a media ↔ article relation + usage history + full metadata fields.
14. Proper preview of the rendered page.
15. Settings section (site settings, analytics/AdSense IDs, verification tags).
16. Auto-create a 301 when a slug changes; unique `sourceUrl`; bulk CSV redirect import.

**Phase D: SEO Intelligence**
17. Per-article actionable checklist in the editor (a configurable rules engine stored in the DB/JSON, not hard-coded), with type-aware checks (e.g. How to Watch).
18. Remove the hard-coded "100% / Validated" cards.
19. Internal link suggestions, orphan detection, broken link detection.
20. Freshness flags (edition dates passed, old "upcoming" articles, etc.).
21. AI Content Assistant (suggestions only, never auto-publishes). The `@google/genai` dependency is already there; or use Claude.
22. Fix the sitemap (exclude `/search`, respect visibility/noIndex, add a sitemap index, `lastmod` on all entries); delete the stale `public/sitemap.xml`.
23. Structured data chosen by page/article type; remove questionable types.
24. IndexNow.

**Phase E: Search**
25. Server-side Postgres full-text + `pg_trgm` (typo tolerance), autocomplete, ranking, and logging of queries and no-result searches.

**Phase F: Monetization, analytics, privacy**
26. AdSense integration on the existing 9 slots, with reserved space, `ads.txt` and an admin toggle.
27. GA4 + Search Console + Bing verification, and a consent banner (Consent Mode v2).
28. Core Web Vitals RUM, uptime and error monitoring.

**Phase G: Ops and launch**
29. Staging + production environments, deployment docs, CI (typecheck + tests).
30. Automated DB + media backups, off-site copy, documented and tested restore.
31. Password reset flow; optional 2FA for Admin; a persistent rate limiter.
32. Migration tooling: old-site URL inventory → KEEP/REWRITE/MERGE/RETIRE sheet → bulk import + bulk 301s → verification.
33. Run the launch acceptance checklist (§33).

---

## 7. Quick facts for the planner

- Key files: `prisma/schema.prisma`, `server.ts` (all API routes, sitemap, robots, redirects), `src/App.tsx` (router), `src/context/AppContext.tsx` (global state + `/api/data` fetch), `src/pages/*`, `src/components/admin/*`, `src/types/index.ts`.
- Test scripts: `npm run test:phase4`, `npm run test:production`. Typecheck: `npm run lint`.
- DB: local PostgreSQL. Never run `prisma migrate reset` against real data (see `DATABASE_OPERATIONS.md`).
- The project previously worked in "phases" (Phase 0.1 → 4) that focused mostly on security and accounts. Future prompts should reference the roadmap phases A–G above.
