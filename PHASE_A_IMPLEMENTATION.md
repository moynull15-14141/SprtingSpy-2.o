# PHASE A STATUS

```text
COMPLETE
```

Implemented and verified locally on 2026-09-27 against Spec v1.1. Phase B (rendering architecture) was not started.

## 1. Git

- **Initialized:** yes, branch `main`, with `core.autocrlf=false` set locally.
- **Initial commit:** `37d82be` "Initial commit: SportingSpy v2.o baseline before Phase A". It is the untouched pre-Phase-A state.
- **Remote:** none configured. Remote setup stays under the owner's control, and nothing was pushed.
- **Secrets excluded:** `.env*` (except `.env.example`), `node_modules/`, `dist/`, `build/`, `backups/` and `server/generated/prisma` are ignored. `*.dump`, `*.sql.gz`, `*.pem` and `*.key` were added to `.gitignore`. Before committing I checked that `data/db.json` has no password hashes and that `.env` was not staged.
- **Phase A changes:** in the working tree, not yet committed.

## 2. Article Type

- **Old value:** `Sports Viewing Guide`
- **New value:** `How to Watch`. The existing convention stores the display label as the value, so the label is the value.
- **Migrated rows:** 1 (before: 1 old, 0 new; after: 0 old, 1 new). No other type count changed.
- **Single source of truth:** `ARTICLE_TYPES` in `src/types/index.ts`, with the 19 types from Spec §5. The admin editor uses it, and the server validates `articleType` against it on create and update. Before Phase A, `articleType` was not validated at all. Legacy or alternative names are rejected with 400.
- **Remaining old-value occurrences:** none in active code or UI. What remains:
  - the historical init migration (immutable)
  - the Phase A migration itself
  - importer compatibility mapping in `migrate-json-to-postgres.ts`
  - test assertions
  - the stale `public/sitemap.xml` (see limitations)
  - `data/db.json` (protected, untouched)

## 3. Event Model

- **Fields added:** `SportEvent.officialSourceUrl String?` and `SportEvent.eventType String?`.
- **Validation (server-side):**
  - `officialSourceUrl` must be an absolute `http`/`https` URL. Relative paths, `javascript:`, `ftp:` and malformed values are rejected.
  - `eventType` is a free string of at most 80 characters. The spec defines no enum, so none was invented.
  - Empty values clear a field to `null`.
  - `PUT /api/events/:id` previously wrote `req.body` with no validation. It now validates all text, slug, URL and SEO fields.
- **Admin UI:** Event form has an "Event Type" field (suggestions from existing types) and an "Official Website / Source" field. The public Event page shows both when set (Spec §7.3 "Official Source").

## 4. Event Edition

- **Status values:** `upcoming`, `active`, `completed`, `archived` (Postgres enum plus the shared `EDITION_STATUSES` constant).
- **Migration:** `ALTER TYPE ... RENAME VALUE 'ongoing' TO 'active'` plus `ADD VALUE 'archived'`. This is in place and non-destructive; no rows are rewritten.
- **Affected rows:** 0. The DB had no `ongoing` editions (5 upcoming, 1 completed, unchanged). No editions were archived.
- **Server:** status is validated on create and update, and `ongoing` or unknown values get 400. Edition PUT also validates text, URL and SEO fields now.
- **UI:**
  - The admin status select offers all four values.
  - The admin editions table has a status filter.
  - The public badge highlights `active`.

## 5. Social Metadata

The fields are added to the existing `seo` JSON contract (`SeoMetadata`), so no DB migration was needed:

- `ogTitle` (at most 200 characters)
- `ogDescription` (at most 500 characters)
- `ogImage` (existed before; now validated as a safe URL)

Twitter/X reads the Open Graph tags, so I didn't add separate `twitter*` fields.

- **Validation:** `validateSeo()` whitelists keys and rejects unknown ones. It also enforces lengths and safe URL schemes. I checked the live DB first: all existing SEO keys are within the whitelist.
- **Editor:** a separate "Social Metadata" section, distinct from "SEO Metadata". Saving keeps SEO keys the form doesn't edit, such as `noIndex`, `canonicalUrl` and `keywords`. Previously, saving silently dropped them.
- **Client head:** the tags fall back to the SEO title and description and the featured image. They are still set client-side; server rendering comes in Phase B.

## 6. Static URLs

- **New:** `/privacy-policy/` and `/terms-and-conditions/` (router, footer, canonical tags, sitemap).
- **Old:** `/privacy`, `/privacy/`, `/terms` and `/terms/` → **301** in one hop to the new URL, with the query string preserved.

## 7. Trailing Slash

- **Canonical policy:** public page URLs end with `/`. The bare form gets a **301** to the slash form, for GET and HEAD, with the query string preserved.
- **Redirect order:**
  1. Legacy static map
  2. Editor redirect rules
  3. Slash policy

  Every target is canonicalized first, so each request resolves in a single hop and chains are avoided.
- **Exceptions (never redirected):**
  - `/api/*` (all methods)
  - any path whose last segment has a file extension (`sitemap.xml`, `robots.txt`, `/assets/*`, images, fonts)
  - Vite dev internals
  - POST, PUT, PATCH and DELETE requests
- **Client:** route matching still uses slash-free paths. The address bar, `<link rel=canonical>`, breadcrumb JSON-LD, structured-data URLs and all sitemap `<loc>` entries use the slash form.
- **Shared rule:** `src/config/urls.ts`, used by both the server and the client.

## 8. Launch Feature Flags

- **Mechanism:** `server/features.ts`, env-only: `ENABLE_READER_ACCOUNTS` and `ENABLE_COMMENTS`. Both default to OFF and are documented in `.env.example`. The browser gets a read-only copy through `/api/data`, with the client defaulting to OFF. The server enforces both flags independently.
- **Reader accounts (OFF):**
  - Reader login fails with the same generic 401 as a wrong password.
  - Existing Reader sessions stop authenticating; the rows are kept.
  - Admins can't create a Reader or assign the Reader role.
  - There was never a public registration endpoint, and still isn't.
- **Reader role:** kept in the enum and the data (1 existing Reader user is preserved). The admin UI shows it only as "disabled for launch" on existing Reader rows.
- **Comments (OFF):**
  - `/api/comments*` returns 404 for every role, even with forged client headers.
  - `/api/data` returns no comments.
  - The public comment section, the CMS Comments tab and the dashboard moderation card are hidden.
  - All 9 stored comments are preserved.
- **Account UI:** `/account` shows anonymous visitors a staff-only notice with no public sign-in form. Staff keep their full account page (profile, password, sessions). The English/Bangla switch is hidden; the stored preference is kept. Staff/Admin authentication and `/admin` are unaffected.
- **Re-enabling:** set the env vars to `true`. The existing Phase 4 and Production suites pass in that mode (see §10).

## 9. Database

- **Migrations:** `20260927000000_phase_a_foundation`, hand-written SQL applied with `prisma migrate deploy`. It contains no reset, DROP or TRUNCATE.
- **`prisma migrate status`:** 3 migrations, up to date.
- **`prisma migrate diff`** (DB → schema): empty, so there is no drift.
- **Integrity:** every test suite snapshots all 12 tables (counts plus full-row SHA-256) before and after, and got identical results. `data/db.json` and `PROJECT_BRAIN.md` hashes are unchanged.

| Table | Before | After |
|---|---|---|
| Sport | 13 | 13 |
| SportEvent | 5 | 5 |
| EventEdition | 6 | 6 |
| Article | 10 | 10 |
| User | 4 | 4 |
| Session | 11 | 11 |
| Comment | 9 | 9 |
| AuditLog | 52 | 52 |
| Author / Media / Redirect / AdSlot | 4 / 5 / 3 / 9 | 4 / 5 / 3 / 9 |
| Article type "Sports Viewing Guide" | 1 | 0 |
| Article type "How to Watch" | 0 | 1 |
| Edition status | upcoming 5 · ongoing 0 · completed 1 | upcoming 5 · active 0 · completed 1 · archived 0 |

## 10. Tests

| Command | Result |
|---|---|
| `npx tsc --noEmit` | pass |
| `npm run build` | pass (the chunk-size warning was already there; code splitting is Phase B) |
| `npx prisma validate` | valid |
| `npx prisma migrate status` | up to date |
| `npm run test:phase-a` (new; flags OFF; with `PLAYWRIGHT_MODULE`) | **15/15 groups pass** + DB integrity |
| `ENABLE_READER_ACCOUNTS=true ENABLE_COMMENTS=true npm run test:phase4` (with Playwright) | **24/24 pass** + DB integrity |
| `ENABLE_READER_ACCOUNTS=true ENABLE_COMMENTS=true npm run test:production` (HTTPS + real Chrome) | **31/31 pass** + DB integrity |

Changes to test code:

- **Fixed:** two pre-existing harness bugs in `server/scripts/production-transport.ts` that stopped `test:production` from running on Node 22 at all:
  - the custom DNS `lookup` didn't support `{ all: true }`
  - chunked DELETE bodies needed an explicit Content-Length
- **Updated:** the production deep-link check now asserts the new contract (bare → 301, slash → 200).
- **Environment:** Playwright came from the local npx cache (`PLAYWRIGHT_MODULE=.../playwright/index.mjs`) with installed Chrome.

## 11. Security Regression

Covered by the three suites above:

- Forged `x-user-id`/`x-user-role` headers get 401.
- Unauthenticated `/api/users` and `/api/audit-logs` get 401. An Editor escalating to create a user gets 403.
- Missing CSRF gets 403. A hostile Origin is rejected.
- CSP, nosniff and HSTS headers are present.
- No `passwordHash` appears in any API payload or server log.
- Reader users are denied `/admin` (flags ON). With flags OFF, they can't authenticate at all.
- Session revocation and expiry, rate limits and audit logging pass.
- Feature flags come only from the server environment. Client headers and state can't enable them.

## 12. Files Changed

**New**
- `prisma/migrations/20260927000000_phase_a_foundation/migration.sql`
- `server/features.ts` (launch flags)
- `src/config/urls.ts` (URL policy)
- `server/scripts/verify-phase-a.ts` (+ `npm run test:phase-a`)

**Server**
- `server.ts` (URL policy/redirects, sitemap, validation, flags, roles)
- `server/validation.ts` (`validateOneOf`, `validateSeo`)
- `server/cmsFields.ts`
- `server/scripts/migrate-json-to-postgres.ts` (legacy value mapping)
- `server/scripts/production-checks.ts`, `server/scripts/production-transport.ts`

**Schema/types**
- `prisma/schema.prisma`
- `src/types/index.ts`
- `.env.example`
- `package.json`

**Client**
- `src/App.tsx`
- `src/context/AppContext.tsx`
- `SeoHead`, `Breadcrumbs`, `Footer`
- `AdminArticles`, `AdminEvents`, `AdminLayout`, `AdminDashboard`, `AdminUsers`
- `AccountPage`, `ArticlePage`, `EventPage`, `SportPage`, `EventEditionPage`, `AuthorPage`, `StaticPages`, `SearchPage`, `LatestArticlesPage`
- `seedData.ts`

**Untouched:** `PROJECT_BRAIN.md` and `data/db.json` (hash-verified).

## 13. Known Limitations

- **Old article slug:** the migrated article keeps its slug `sports-viewing-guide`, as the Phase A instructions required. Its URL is `/tennis/french-open/2027/sports-viewing-guide/`, while the spec's example pattern is `/.../how-to-watch/`. Changing it is an editorial decision: rename the slug in the CMS and add a 301 from the old URL.
- **Stale sitemap file:** `public/sitemap.xml` (copied into `dist/`) is an old static file that lists old URLs. The dynamic `/sitemap.xml` route always takes precedence, so it's never served. Delete it in Phase D (sitemap fixes).
- **Client-side tags:** meta, canonical and social tags are still set client-side, and unknown URLs still return a soft 404 (HTTP 200). This is **Phase B** by design.
- **Event page SEO:** on each save, the Event admin form still overwrites the Event's SEO title and description with generated values. This is existing behavior, left out of scope.
- **Test harness for flags ON:** the existing Phase 4 and Production suites exercise Reader accounts and comments, so they must run with `ENABLE_READER_ACCOUNTS=true ENABLE_COMMENTS=true`. The launch configuration is covered by `test:phase-a`.

## 14. Next Phase

```text
NEXT:
PHASE B — RENDERING ARCHITECTURE
```
