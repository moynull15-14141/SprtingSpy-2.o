# Phase G — Production / Launch Readiness

Status and evidence as of 2026-09-28. Anything that could not be tested here is marked **NOT VERIFIED** together with what it needs.

## 1. What the audit found

**Runtime.** One Node process runs everything: `server.ts`, which is Express plus Next.js 16. It serves the API, renders every page, runs the scheduled-publication timer (every 60 s) and serves media from local disk (`MEDIA_STORAGE_PROVIDER=local`; no object storage is implemented).
- The database is PostgreSQL 17 through Prisma 7 and `pg`.
- Sessions are server-side, using an HttpOnly `sid` cookie plus a `csrf_token` double-submit cookie.
- There is no e-mail system. The only third-party calls are IndexNow (fixed endpoint), GA4 and AdSense (Phase F, off until configured) and Gemini (optional).

**Deployment.** The repository has no Dockerfile, CI or hosting-provider configuration. The supported production entry point is `npm run build`, then `npm run start:production`.

**Already in place:** production boot guards (`server/deployment.ts`), which require:
- HTTPS `ALLOWED_ORIGIN`;
- a PostgreSQL `DATABASE_URL`;
- no `DEV_LOGIN_BYPASS`;
- an existing build;
- explicit `TRUST_PROXY` values.

Also already in place: HTTPS enforcement with HSTS, the security headers and nonce CSP, CORS and CSRF, login, comment and staff-creation rate limits, sanitized API errors, and read-only startup (no migrations at boot).

**Gaps found and fixed in Phase G:**

| # | Finding | Severity |
|---|---|---|
| 1 | All 4 existing accounts, including the Admin, still used the publicly documented seed password `ChangeMe123!`. | **Launch blocker** |
| 2 | Production CSP had no `frame-src`, so YouTube/Vimeo embeds were blocked. Confirmed in a production-mode browser run: two "Framing … violates default-src" errors. | High |
| 3 | No `media-src` in the CSP, and a CDN `MEDIA_PUBLIC_BASE_URL` would have been blocked by `img-src`. | Medium |
| 4 | Error logs held only the error name: no path, status or correlation ID. | Medium |
| 5 | No readiness endpoint; `/api/health` is liveness only. | Medium |
| 6 | `npm run db:migrate` (`prisma migrate dev`, which can offer a reset) had no target guard. | Medium |
| 7 | The restore procedure in `DATABASE_OPERATIONS.md` restores over the live database (`pg_restore --clean`). | Medium (documentation) |
| 8 | In light mode, amber text, white-on-amber buttons and light-grey text failed WCAG contrast (2.4–3.2:1). Headings skipped levels; two selects had no label. | Medium (accessibility) |
| 9 | Mobile `/search` CLS was 0.166, caused by the loading skeleton being shorter than the page. | Low |
| 10 | `MEDIA_PUBLIC_BASE_URL` was not available to client components (CMS Media Library). | Low |
| 11 | The `test:production` suite had a stale sitemap assertion, unchanged since Phase D. | Test only |

## 2. Environment variables

Names only; no values are recorded here. "Local" is the current `.env`.

| Variable | Class | Production | Local | Notes |
|---|---|---|---|---|
| `NODE_ENV` | Required | `production` (set by `start:production`) | unset | |
| `DATABASE_URL` | Required, secret | PostgreSQL URL | set | Server-only. Add `sslmode=require` if the provider needs TLS. |
| `ALLOWED_ORIGIN` | Required | `https://<public origin>` | unset | CORS, canonical URLs, sitemap, JSON-LD. Boot refuses non-HTTPS. |
| `TRUST_PROXY` | Required behind TLS termination | proxy IP/CIDR list | unset | Needed for `req.secure`, HSTS and per-client rate limits. |
| `PORT`, `HOST` | Optional | defaults 3000 / 0.0.0.0 | unset | |
| `AUTH_MODE` | Recommended | `production` | unset | Also refuses `DEV_LOGIN_BYPASS`. |
| `MEDIA_STORAGE_PROVIDER` | Optional | `local` (only provider) | unset | |
| `MEDIA_LOCAL_DIR` | Required for uploads | persistent volume path | unset (`storage/`) | Must be backed up. |
| `MEDIA_PUBLIC_BASE_URL` | Optional, public | CDN base if any | unset | Inlined at build time; rebuild after changing. |
| `ENABLE_READER_ACCOUNTS`, `ENABLE_COMMENTS` | Optional | unset (off at launch) | unset | |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Optional, secret | only if the AI assistant is wanted | unset | Server-only. |
| `INDEXNOW_ENDPOINT` | Optional | default | unset | The IndexNow key is a CMS setting. |
| `ALLOW_THIRD_PARTY_IN_DEVELOPMENT` | Development only | never | unset | |
| `SHOW_AD_PLACEHOLDERS` | Development only | never | unset | |
| `DEV_LOGIN_BYPASS`, `DEV_BYPASS_USER_ID` | Development only | never (boot refuses) | unset | |
| `ALLOW_DESTRUCTIVE_DB_OPS` | Development only | never | unset | |
| `APP_URL` | Unused | — | — | Left over from the AI Studio template; not read by the code. |

- **Public client-side variables:** there are no `NEXT_PUBLIC_*` variables. The only value inlined into the browser is `MEDIA_PUBLIC_BASE_URL`, which is public by nature.
- **Provider IDs:** GA4 and AdSense IDs are Admin settings in the database, not environment variables.
- **Bundle scan:** no source maps are shipped, and a scan of all 25 client files found no database URL, API key, password hash or development flag.

## 3. Changes

- **Default-password launch guard** (`server/launchGuards.ts`):
  - With `NODE_ENV=production` and a non-loopback origin, the server refuses to start while any active account accepts `ChangeMe123!`. The message names roles, never e-mails.
  - Local production-mode runs only warn: a loopback origin, or a reserved test TLD (`.test`, `.localhost`, `.invalid`, `.example`), which can never be a public site. The HTTPS test suite uses `https://sportingspy.test`.
- **`npm run users:set-password -- <email>`** (`server/scripts/set-password.ts`):
  - The password is read from stdin (hidden on a TTY), never from the command line.
  - It enforces the password policy and rejects the default.
  - It revokes the user's sessions and writes an audit entry.
- **Request IDs:** every response has `X-Request-Id`. Error responses return `{ error, requestId }`. Error logs record `id`, method, path without query string, status, error class and error code, and never messages, bodies or query values.
- **`GET /api/health/ready`:** checks the database (`SELECT 1`, 2 s timeout) and that media storage is writable. It returns `{status, checks: {database, storage}}` with only ok/fail values, and 503 when not ready. Direct HTTP probes are exempt from the HTTPS redirect, like `/api/health`.
- **CSP:**
  - `frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com`, plus AdSense frames only when AdSense is configured.
  - `media-src 'self'`.
  - The `MEDIA_PUBLIC_BASE_URL` origin is added to `img-src`/`media-src` only when that URL is absolute.
  - Everything else is unchanged, including the nonce, `frame-ancestors 'none'` and `object-src 'none'`.
  - The embed dialog now explains that video/audio files must be served by this site or its media CDN.
- **`npm run db:migrate`** now runs `server/scripts/guard-local-db.ts` first and refuses non-local databases. `db:migrate:deploy` (the production path) is unchanged.
- **`npm run db:backup-drill`**, **`npm run smoke`** and **`npm run audit:a11y`**: see below.
- **Accessibility:**
  - Light-mode `text-amber-600` → `amber-700`, `bg-amber-600` → `amber-700` (hover `amber-800`) and `text-stone-400` → `stone-500`.
  - Matching `dark:` text colours were added where none existed, so dark mode is unchanged or brighter.
  - Decorative separators and the ▼ glyph are marked `aria-hidden`.
  - Footer headings are `h2`, and the heading-level skips on the event, sport, events and latest pages are fixed.
  - `/latest` filter selects have labels.
- **Search skeleton** is at least a screen tall: mobile CLS went from 0.166 to 0.006.
- **`next.config.mjs`** inlines `MEDIA_PUBLIC_BASE_URL` for client components.

No database schema change and no migration in Phase G.

## 4. Backup and recovery

**What exists.** The documented `pg_dump` / `pg_restore` commands (`DATABASE_OPERATIONS.md`) and the historical `data/db.json`. There is no automated backup: no hosting provider is configured.

**Verified locally:** `npm run db:backup-drill`.
1. `pg_dump -Fc` of the database into `backups/` (source is read-only).
2. `CREATE DATABASE <db>_restore_drill_<timestamp>`.
3. `pg_restore --no-owner --exit-on-error` into it.
4. Compare every table (count plus content hash), `_prisma_migrations`, extensions and the generated `searchVector` column.
5. `DROP` only the drill database, guarded by its name pattern.

Result: 18 tables, 190 rows, all identical, in 3 s; the dump is kept at `backups/sportingspy_20260928_064659.dump`.

**NOT VERIFIED — needs the production database provider and access:**
- automated backups;
- backup frequency and retention;
- point-in-time recovery;
- a restore of a real production backup.

Configure the provider's automated backups (daily at minimum, with PITR if offered) before launch, then run the drill steps against a restored copy on a disposable instance.

**Media.** Files live in `MEDIA_LOCAL_DIR` (default `storage/`), which is not in git. It must sit on a persistent, backed-up volume. **NOT VERIFIED:** no production volume exists yet.

### Recovery runbook

1. **Database.** Restore the provider backup or `pg_restore` into a **new** database. Never use `--clean` on the live one. Run `npm run db:backup-drill`-style comparisons or spot checks, then point `DATABASE_URL` at the new database.
2. **Media.** Restore the `MEDIA_LOCAL_DIR` snapshot, taken at the same time as the database backup where possible. Missing files render as broken images; database rows still reference them by key.
3. **Environment.** Re-create the variables in section 2 from the secret store. Secrets are not in the repository.
4. **Redeploy.** `npm ci`, then `npm run build`, then `npm run start:production`.
5. **Migrations.** Run `npx prisma migrate status`. If migrations are pending, run `npm run db:migrate:deploy` (never `migrate dev`, `reset` or `db push`).
6. **Smoke.** `SMOKE_BASE_URL=https://<origin> npm run smoke`, optionally with `SMOKE_EMAIL`/`SMOKE_PASSWORD`.
7. **Rollback.** Redeploy the previous build or commit against the same database. Phase A–G migrations are additive, so older code tolerates the newer schema. If a migration itself must be undone, restore the pre-deploy backup into a new database (step 1).

## 5. Deployment procedure

1. **Pre-deploy:**
   - `npm ci`, `npm run lint` (tsc) and `npm run build`.
   - Run the suites listed in section 9 against a local database.
   - `npx prisma validate` and `npx prisma migrate status`.
2. **Backup:** confirm a fresh provider backup exists, or take a `pg_dump`.
3. **Migrations:** check `npx prisma migrate status` against production, then run `npm run db:migrate:deploy`.
4. **Build:** `npm run build` on the target.
5. **Start:** `npm run start:production` behind a TLS proxy, with the section 2 variables and `TRUST_PROXY` set.
6. **Health:** `GET /api/health` returns 200, and `GET /api/health/ready` returns 200 `ready`.
7. **Smoke:** `npm run smoke` against the public origin.
8. **Monitor:** watch the platform logs for `Request failed id=` lines and for 5xx or readiness failures.
9. **Rollback trigger:** readiness fails, the smoke test fails, or a 5xx rate that did not exist before.
10. **Rollback:** see runbook step 7.

**Before the first launch:**
- Set real passwords for every seeded account with `npm run users:set-password -- <email>`. The server will not start otherwise.
- Delete or deactivate demo accounts that are not needed.

## 6. Smoke-test checklist

`npm run smoke` covers the following automatically.
- **Health:** liveness and readiness.
- **Headers and errors:** security headers, strict CSP with the embed players, request IDs, sanitized errors.
- **Pages:** discovered from the sitemap. It checks home, sports, events, latest, sport, article, edition and author, with one canonical on the expected origin and no localhost.
- **Indexing:** 404 is noindex; robots disallows `/admin/`; admin is noindex,nofollow; search is noindex; the privacy page shows the consent cookie and choices.
- **Search:** normal, Bangla, mixed, typo, sort/pagination, no-result, limit validation, suggestions and the CMS-search 401.
- **Auth:** CMS data returns 401 without a session. With credentials: login → `/api/auth/me` → CMS data → CMS search → logout → 401.
- **Rate limit:** optional, with `SMOKE_RATE_LIMIT=1`.

**Manual items** (the automated suites cover them locally; repeat on staging):
- CMS: dashboard, article editor, media upload, publish/unpublish, ads, settings.
- Consent: first visit, accept, reject, preferences, withdraw (`test:phase-f`).
- Session expiry (`test:production`).

## 7. GA4 / AdSense with real credentials — **pending external credentials**

No real IDs exist, so real delivery is **NOT VERIFIED**. Configuration runs through Admin → Settings (`ga4MeasurementId`, `adsensePublisherId`) and Ad Placements (provider plus AdSense unit ID). Providers only run in production.

**GA4 on staging:**
1. Set the measurement ID.
2. Open the site and accept analytics.
3. Confirm `gtag/js` loads and no CSP error appears.
4. In GA4 DebugView, confirm `page_view` (once per navigation), `article_view`, `search`, `search_result_click` and `search_suggestion_click`.
5. Withdraw consent and confirm no further hits and `_ga` cookies removed.

**AdSense on staging:**
1. Set the publisher ID and a slot's unit ID.
2. Accept advertising.
3. Confirm `adsbygoogle.js` loads, the unit initializes, and the console and network show no CSP violations.
4. Check the AdSense diagnostics.
5. AdSense in some regions may require a Google-certified CMP. That is a business and legal decision.

## 8. Privacy and legal

- **Technical behavior:** consent, gating, withdrawal and admin/account exclusion are verified by `test:phase-f`. The privacy page is generated from the live configuration.
- **Legal review required before public launch.** No compliance, jurisdiction or legal approval is claimed.
- **Placeholders:** the legal entity name and address do not exist in the repository.

## 9. Test evidence (this phase)

| Suite | Result |
|---|---|
| `test:phase-g` (new) | 6/6 |
| `test:production` (HTTPS edge, real Chrome) | 31/31 (after fixing its stale Phase D sitemap assertion) |
| `smoke` against the production build | 7/7 including authenticated checks, plus the rate-limit check |
| `db:backup-drill` | pass (18 tables / 190 rows identical) |
| `audit:a11y` | 12 pages × light/dark × desktop/mobile: only remaining finding is a heading skip inside one article's editor content |
| Regression | see the final report |
