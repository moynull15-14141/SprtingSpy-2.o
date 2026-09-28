# PHASE B STATUS

```text
COMPLETE
```

Implemented and verified locally on 2026-09-27. Public site: React + Vite SPA → **Next.js 16 server rendering**. No database schema changes. No commit was created.

## 1. Architecture

**Old architecture**

1. Express served an empty `index.html` for every URL.
2. The browser downloaded the JavaScript bundle.
3. It then called `GET /api/data`, which returned the whole database: all sports, events, editions, articles with full bodies, authors, comments, media, ads and redirects.
4. React picked the page from the URL and set title, meta, canonical and JSON-LD with `useEffect`.
5. Unknown URLs returned HTTP 200.

**New architecture**

```text
Browser → Express (server.ts)
            ├─ security headers + per-request CSP nonce, CORS, CSRF, rate limits
            ├─ legacy / editor 301s + trailing-slash policy (Phase A)
            ├─ /api/*            (unchanged API; auth, sessions, RBAC, CMS writes)
            ├─ /sitemap.xml, /robots.txt
            └─ Next.js 16 App Router (same process) → server components
                    → server/services/public (Prisma, route-specific queries) → PostgreSQL
```

- **Migrated:** every public page, the 404 page, `/account` and `/admin`. The Header, Footer, cards, breadcrumbs and ad slots moved too.
- **What remains client-side, by design:**
  - the CMS (`/admin/`), a client-rendered area in its own bundle
  - the account page
  - small interactive islands: header menus and staff login, the sport-hub tab filter, listing filter selects, the contact form, image-error fallbacks, and comments (flag-gated)

## 2. Next.js

- **Version:** 16.3.6 (Turbopack), App Router, React 19 Server Components.
- **Integration:** Next runs inside the existing Express server through `next()` + `getRequestHandler()`. Keeping Express in front preserves all Phase 1–4 and Phase A middleware unchanged. In dev, HMR websocket upgrades are forwarded.
- **Rendering:** every page is dynamic, server-rendered per request (`force-dynamic`), which is needed for live content and the CSP nonce.
- **Server components:** all public pages, cards, breadcrumbs, JSON-LD, ad slots and the footer. Data loaders use React `cache()`, so a page and its `generateMetadata` share one query.
- **Client components (`'use client'`):**
  - `SiteContext`: theme, staff session, CSRF-aware `apiCall`, notifications
  - `Header`
  - `SportHubTabs`, `FilterSelect`, `CardImage`, `FeaturedImage`
  - `ContactForm`, `CommentsSection`
  - `AccountPage`
  - `AdminApp` and all CMS components, plus `AppContext` (CMS data, admin only)
- **TypeScript:** the project uses TypeScript 7, which has no JS compiler API. Next's own type-check step is skipped (`typescript.ignoreBuildErrors`), and `npm run build` runs `tsc --noEmit` first, so the build fails on type errors.

## 3. Public routes (all server-rendered)

| Route | Notes |
|---|---|
| `/` | Home |
| `/sports/`, `/events/` (`?sport=` filter), `/latest/` (`?sport=`, `?type=`, `?page=`) | Listings |
| `/search/?q=&sport=&type=` | Server-side search, noindex |
| `/{sport}/` | Sport hub |
| `/{sport}/{event}/` | Event page; falls back to an edition-less article, e.g. `/tennis/tennis-scoring/` |
| `/{sport}/{event}/{year}/` | Event edition |
| `/{sport}/{event}/{year}/{article}/` | Edition article |
| `/author/{slug}/` | Author profile |
| `/about/`, `/contact/`, `/privacy-policy/`, `/terms-and-conditions/`, `/dmca/` | Static pages |
| `/account/`, `/admin/` | Private, noindex/nofollow |

The URL architecture is unchanged, with the Phase A trailing-slash canonicals.

## 4. Data loading

- **`/api/data` is removed** (it now returns 404). Consumers were checked first:
  - Public pages now use server queries.
  - The CMS now uses the new **staff-only `GET /api/cms/data`**: 401 for anonymous users, 403 for Reader, and the same per-role projection as before (users for Admin only, audits for Admin/Editor).
  - Tests were updated.
- **Service layer:** `server/services/public/content.ts` and `search.ts`. Each page queries only its own records. Rules are enforced in the service:
  - only `published` articles
  - only visible sports and events (and their editions and articles)
  - listings never select article bodies
  - user, session, audit and redirect data is never selected
- **Search:** it no longer needs the dataset in the browser. There's a server-side boundary, `searchPublic()`, currently a case-insensitive `contains` match with capped results. Phase E replaces the internals.
- **Pagination:** `/latest/` pages through results on the server (6 per page); page counts beyond the total return 404.
- **Measured size:** an article page ships 8 scripts, about 600 KB raw / 180 KB gzip. That's the framework and React baseline plus the small islands, with no content data. No public page references `/api/data` or `/api/cms/data`, which the tests verify.

## 5. SEO (all in the initial server HTML; no `useEffect`/`document.head`)

- **Title / description:** from `generateMetadata`. Editor SEO values (`seo.metaTitle` / `seo.metaDescription`) take precedence over page defaults.
- **Canonical:** absolute, trailing-slash, built server-side from `ALLOWED_ORIGIN`. It's self-referencing unless the editor set `seo.canonicalUrl`. Unknown pages (404) get no canonical. Filtered listings point to the unfiltered listing. `/latest/?page=N` is canonical to itself.
- **Open Graph / Twitter:**
  - `og:title`, `og:description`, `og:url`, `og:image`, `og:type` and `og:site_name`
  - `twitter:card`, `twitter:title`, `twitter:description` and `twitter:image`
  - Phase A `ogTitle`/`ogDescription`/`ogImage` are used, falling back to the SEO title/description and the featured image.
  - Articles get `og:type=article` with published and modified times, section and author.
- **Robots:**
  - `index, follow` by default
  - The editor `seo.noIndex` flag is honoured (verified on the existing noIndex edition).
  - `noindex, follow` for search results and filtered listings
  - `noindex, nofollow` for `/admin/` and `/account/`
  - `noindex` for 404s
- **JSON-LD (type-aware, matches visible content):**
  - Home: `Organization` + `WebSite`
  - Sport: `CollectionPage`. This replaces `SportsSpecialty`, which isn't a schema.org type.
  - Event: `BreadcrumbList` only. The recurring event has no single date, so there's no `SportsEvent` here.
  - Edition: `SportsEvent` with start/end dates, location, and `sameAs` for the official source.
  - Articles: `NewsArticle` for News/Update/Results/Preview and `Article` for all other types. They include `mainEntityOfPage` and an author `Person` with a profile URL.
  - Author: `ProfilePage`
  - Every page: `BreadcrumbList`
  - Image URLs are absolute, and `<` is escaped (XSS fix kept).

## 6. 404 (real HTTP status, measured with curl against the production build)

```text
/nope/                                  404
/tennis/nope/                           404
/tennis/french-open/1999/               404
/tennis/french-open/abc/                404
/tennis/french-open/2027/nope/          404
/a/b/c/d/e/                             404
/author/                                404
/api/data                               404   (removed)
/src/main.tsx                           404   (JSON, not HTML)
/tennis/french-open/2027/schedule/      200
/tennis/tennis-scoring/                 200
/tennis                                 301 → /tennis/
/privacy                                301 → /privacy-policy/
```

`test:phase-b` asserts 404 plus noindex plus no canonical for 20 URLs. These include hidden sports and events, the draft, scheduled and archived articles, invalid years, too-deep paths, and invalid query filters and pages. Chrome also receives the 404 status.

## 7. Admin / Auth / Security

- **`/admin/`:** a client-rendered CMS, fully preserved. Its data provider mounts only after the staff access gate. It lives in its own route chunk, which public pages never load (verified).
- **Auth:** unchanged: sessions, login and logout, revocation, password change, CSRF, RBAC, rate limits and audit logging. There's no second auth system. The browser still learns identity only from `/api/auth/me`.
- **CSP (production):** changed from `script-src 'self'` to `script-src 'self' 'nonce-<random per request>'`. Express overwrites the request's CSP header on every request, so a client can't inject a nonce (tested). Every executable script tag carries the nonce (tested). Real Chrome over HTTPS reports no CSP violations.
- **Non-page requests:** non-GET/HEAD requests to page URLs get 405. Next has no API routes or server actions.
- **Regression results:** Phase 4 24/24 and Production 31/31 (HTTPS + real Chrome) pass. They cover forged role headers, CSRF, CORS, hostile origins, HSTS, the secure-cookie probe, Reader denial, session revocation UX, secrets not in bundles, and no internals leaking in errors.

## 8. Database

- **Migrations:** none. The schema is unchanged; there are still 3 migrations; `prisma migrate status` is up to date; the migrate diff between DB and schema is empty.
- **Counts before and after Phase B (identical):**

  | Table | Rows |
  |---|---|
  | Sport | 13 |
  | SportEvent | 5 |
  | EventEdition | 6 |
  | Article | 10 |
  | User | 4 |
  | Session | 11 |
  | Comment | 9 |
  | AuditLog | 52 |
  | Author | 4 |
  | MediaItem | 5 |
  | RedirectRule | 3 |
  | AdSlotConfig | 9 |

- **Hash checks:** every suite verified full-row SHA-256 hashes of all 12 tables plus the `data/db.json` and `PROJECT_BRAIN.md` hashes, all unchanged.
- **Prisma client:** now a process-wide singleton, because Express and the Next bundle share one connection pool.

## 9. Tests (final run from a clean `.next`)

| Suite | Result |
| ----------------- | ------ |
| TypeScript (`npm run lint`) | PASS |
| Next build (`npm run build`) | PASS (also builds with no `DATABASE_URL`) |
| Prisma validation / migrate status / drift | valid / up to date / no drift |
| Phase A (`test:phase-a`, flags off, Chrome) | **15/15 PASS** + DB integrity |
| Phase 4 (`test:phase4`, flags on, Chrome) | **24/24 PASS** + DB integrity |
| Production (`test:production`, HTTPS + Chrome) | **31/31 PASS** + DB integrity |
| Phase B (`test:phase-b`, new, Chrome) | **11/11 PASS** + DB integrity |

**Phase B suite coverage:**
- 200 responses for 16 page types
- 20 real 404s
- raw-HTML title, description, canonical, OG, Twitter, robots and JSON-LD per page type
- NewsArticle vs Article
- social-metadata fallbacks
- noIndex handling
- article body present in the server HTML
- data isolation: no dataset endpoint, no unpublished/hidden/private data, no foreign article bodies
- server search, pagination and filters
- CSP nonce behaviour
- admin bundle isolation
- Chrome with JavaScript disabled (article readable)
- Chrome across home, sport, event, edition, article and 404: correct status, no runtime, hydration or CSP errors, link navigation, header staff login, CMS loads

**Existing tests updated for the new contract:**
- the build marker is `.next/BUILD_ID`
- `/api/data` → `/api/cms/data`
- deep links are separate server-rendered pages instead of a shared SPA shell
- assets live under `/_next/static`
- footer entries are links

**Bug found by the new suite and fixed:** a hidden event hid all edition-less articles of its sport, because of SQL NULL semantics.

## 10. Removed code

- **Files:** `index.html`, `vite.config.ts`, `src/main.tsx`, `src/App.tsx` (the client router), `src/components/layout/SeoHead.tsx` (browser-side head updates)
- **Build output:** `dist/`
- **npm packages:** `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `motion` (unused), `autoprefixer` (unused)
- **Endpoint:** public `GET /api/data`
- **In `server.ts`:** the Vite dev middleware and `dist` static/SPA fallback
- **Renamed, not removed:** `src/pages/` → `src/views/`. Next.js would otherwise treat that folder as Pages Router routes.

## 11. Known limitations

- **No caching:** every page is rendered per request with a few indexed queries. There's no CDN, ISR or page cache yet (Spec §22/§23, later phase).
- **JavaScript baseline:** about 180 KB gzip of framework JavaScript per page. There's no further trimming yet.
- **Custom-server trade-offs:** Next runs behind Express as a custom server, so it doesn't use Next's standalone output or its automatic static optimization.
- **Sitemap:** unchanged apart from Phase A. It still lists `/search` and noIndex editions, and the stale `public/sitemap.xml` remains. This is Phase D.
- **Search:** a simple case-insensitive match with no ranking or typo tolerance. This is Phase E.
- **Scheduled articles:** they appear within 30 s of their publish time, via the existing scheduler. Previously a public `/api/data` request also triggered publishing.
- **CMS data volume:** the CMS still loads the full staff dataset in one request, with no pagination (staff only).
- **Theme toggle:** it only switches its icon. Tailwind `dark:` follows the OS setting. This behavior existed before and was left unchanged, since this phase isn't a redesign.
- **Visibility is now enforced on public URLs:** hidden sports and events (and their pages) return 404. The SPA used to render them.
- **Edition-less event articles:** they're now reachable at `/{sport}/{slug}/`, matching the sitemap. They used to be dead links.
- **Editorial images:** the ones stored as `/src/assets/images/*` now load in production. Only that folder is exposed; they returned 404 before.
- **Article slug:** `/tennis/french-open/2027/sports-viewing-guide/` is kept, as instructed. Renaming it is an editorial and SEO decision.
- **Home page wording:** the home title and H1 still use the existing wording, not the Spec §7.1 wording. That's a content change, not an architecture change.
- **Unused but kept:** `@google/genai` (for the AI assistant planned in Phase D) and `src/data/seedData.ts` (reference data).
- **Clean script:** `npm run clean` uses `rm -rf`, which needs a POSIX shell.

## 12. Files changed

**New**
- `src/app/**`: layout, not-found and 18 routes
- `server/services/public/{content,search}.ts`
- `src/lib/{data,seo,paths,params,articleRoute}.ts(x)`
- `src/context/SiteContext.tsx`
- `src/components/admin/AdminApp.tsx`
- `src/components/seo/JsonLd.tsx`
- `src/components/editorial/{CardImage,FeaturedImage,SportHubTabs}.tsx`
- `src/components/ui/FilterSelect.tsx`
- `src/views/ContactForm.tsx`
- `next.config.mjs`, `postcss.config.mjs`
- `server/scripts/verify-phase-b.ts`

**Changed**
- `server.ts`: Next handler, `/api/cms/data`, images route
- `server/securityHeaders.ts` (nonce CSP), `server/deployment.ts` (`.next` build check), `server/db.ts` (singleton), `server/start-production.ts`
- `src/context/AppContext.tsx` (admin-only data)
- `src/views/*` (now server components)
- Header, Footer, ArticleCard, EventCard, Breadcrumbs, AdSlot, CommentsSection, AccountPage, AdminAccessGate, AdminLayout
- `src/config/urls.ts`
- tests (phase4, production-checks, phase-a)
- `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `README.md`

**Untouched:** `data/db.json`, `PROJECT_BRAIN.md` (hash-verified), `prisma/schema.prisma` since Phase A.

## 13. Deployment

```bash
npm ci
npm run db:migrate:deploy        # applies migrations, never resets
npm run build                    # tsc --noEmit && next build → .next/
npm run start:production         # NODE_ENV=production node --import tsx server/start-production.ts
# development: npm run dev       # Express + Next dev (hot reload) on PORT (default 3000)
```

**Environment variables**
- **Build:** needs no database.
- **Runtime:**
  - `DATABASE_URL` (PostgreSQL)
  - `ALLOWED_ORIGIN`: the public https origin, e.g. `https://sportingspy.com`. Required in production, and also the base for all canonical, OG and JSON-LD URLs.
  - `PORT`, `HOST`
  - `TRUST_PROXY` (the proxy IP/CIDR when behind TLS termination)
  - optional `ENABLE_READER_ACCOUNTS` and `ENABLE_COMMENTS`, both default `false`
- **Refused in production:** `DEV_LOGIN_BYPASS`.

**Deployment shape:** one Node 22+ process, same as before, behind a reverse proxy that terminates HTTPS. No secrets are committed; `.env` stays gitignored.

## 14. Git

```text
Git commit: NOT CREATED
```

- **Working tree:** Phase A and Phase B changes are both uncommitted, with nothing staged. The only commit is the pre-Phase-A baseline `37d82be`.
- **Separating the phases:** I saved the Phase A-only diff in my session scratchpad before Phase B began, in case you want two separate commits.
