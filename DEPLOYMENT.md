# Sporting Spy deployment and recovery

Repository readiness is implemented. This document does not certify a live production deployment or provider resources. Phase J extends the Phase G runbook; its older descriptions of local-only media are superseded here.

## Implemented in code

- `npm run build` checks TypeScript and builds Next.js. `npm run start:production` runs the existing Express/Next server with `NODE_ENV=production`.
- Startup validates bind address, port, canonical origin, explicit trusted proxy addresses, database URL, build presence, media configuration and default account passwords. Development bypasses, destructive-operation overrides and shadow-database configuration are rejected in production mode.
- Startup does not run Prisma migrations, resets, schema pushes or data imports. SEO rule defaults may be initialized through the existing settings architecture.
- `/api/health` is liveness. `/api/health/ready` checks database access and media availability within a bounded interval and returns only dependency status. Local media readiness performs a temporary write; S3 readiness uses authenticated HeadBucket, which does **not** prove object write permission. A real CMS upload/delete smoke check is required before launch.
- Request IDs, sanitized errors, nonce CSP, HTTPS enforcement, HSTS, CORS, CSRF, rate limits and secure production cookies are preserved. SIGTERM/SIGINT drain HTTP requests and scheduler work before disconnecting the database, with a shutdown deadline.
- `APP_ENV=staging` runs production code while blocking indexing through robots and X-Robots-Tag and suppressing IndexNow notifications. These are indexing controls; restrict staging access at the edge as well.

## Owner action: prerequisites and configuration

Use Node.js 22 (pinned in `package.json` `engines`). Install from the lockfile with `npm ci`. Do not prune `tsx` from the runtime; the custom server runs through it. PostgreSQL must support the existing migrations/extensions. Keep development, staging and production databases, storage and credentials separate.

Inject secrets through the host's secret manager or protected environment, never Git. Use `.env.example` for names and replace its placeholders. A deployment needs:

| Variable | Required deployment value |
| --- | --- |
| `NODE_ENV` | `production` (set by production start command) |
| `APP_ENV` | `staging` or `production`; `.env.example` is development |
| `AUTH_MODE` | `production` |
| `DATABASE_URL` | Explicit PostgreSQL database, with provider-required TLS; no development/test database for public production |
| `ALLOWED_ORIGIN` | `https://www.sportingspy.com` in production, no trailing slash/path/credentials |
| `HOST`, `PORT` | Bind address and service port; restrict direct external access |
| `TRUST_PROXY` | Exact proxy IP/CIDR list, or `false` when no proxy terminates TLS; never blanket trust |
| `DEV_LOGIN_BYPASS` | `false` |
| `ALLOW_DESTRUCTIVE_DB_OPS` | `false` |
| `MEDIA_STORAGE_PROVIDER` | `r2` (Cloudflare R2), `s3`, or `local` with a persistent backed-up volume |

Unset `SHADOW_DATABASE_URL` and development identity overrides. `GEMINI_API_KEY` is optional; remove its example placeholder if the integration is unused. Public media base is inlined into client assets at build time, so rebuild when changing it. Site settings, analytics/verification IDs and consent are managed through the existing CMS; test their deployed effects.

## Owner action: database, build and launch

1. Confirm the target's hostname/database in your provider dashboard or a credential-safe connection inspection. Inspect migration history and affected tables; inspect `npm run db:status`. Back up the existing database before applying migrations.
2. For staging/production apply **existing reviewed migrations** with `npm run db:migrate:deploy`. Never use `db:migrate`/`prisma migrate dev`, `migrate reset`, `db push`, or the legacy bulk importer on a deployment database. The local migration guard intentionally allows only local development targets. `migrate deploy` does not use a shadow database.
3. Run `npm run db:validate` and `npm run db:status`. Check drift by comparing the actual schema with the reviewed migration history on an isolated database using the installed Prisma version's diff options. A successful migration status alone does not prove absence of drift. Verify row counts and affected content after migration.
4. Set real passwords for existing staff using `npm run users:set-password -- <email>`. This CLI reads the password securely and revokes sessions. Do not put passwords in command arguments or logs. Public production refuses documented default credentials. Local loopback/reserved-domain verification retains the existing Phase G warning exception and must not be exposed publicly.
5. `npm run db:generate` (the generated client is excluded from Git and must be generated on a clean checkout), then `npm run build`, `npm run check:env`, and `npm run start:production`. Generation does not migrate or modify the database. The configuration check does not certify database connectivity, actual provider permissions or account passwords; boot/readiness and smoke checks verify those separately.
6. Set up a supervisor to restart failed processes, send SIGTERM on deploy and allow more than the application's 10-second drain deadline before force termination. Route traffic only to ready instances.

## Render staging: one Web Service (Phase R deployment)

SportingSpy runs on Render as **one Web Service**: Express and Next.js in one Node 22 process, with the scheduler running inside the process. PostgreSQL is Aiven and media is Cloudflare R2. Do not split it into separate frontend and backend services, and do not use Vercel.

**Service settings**

| Setting | Value |
| --- | --- |
| Type / runtime | Web Service, Node |
| Region | Singapore (closest to the Aiven Bengaluru database) |
| Instance | A paid always-on instance (Starter or larger). Free instances sleep when idle, which stops scheduled publishing and analytics retention. If `next build` runs out of memory, use a larger instance. |
| Build command | `npm ci --include=dev && npm run build` (`build` runs `prisma generate`, the TypeScript check and `next build`; it never touches the database) |
| Start command | `npm run start:production` |
| Health check path | `/api/health/ready` |
| Node version | 22 (from `engines`; set `NODE_VERSION=22` if Render picks another) |
| Auto-deploy | Off until staging is accepted; deploy from a reviewed commit |

`--include=dev` is required because the build and runtime use `tsx`, `typescript` and `prisma`, which are dev dependencies. Render's filesystem is temporary, so local media storage cannot be used; set `MEDIA_STORAGE_PROVIDER=r2`.

**Secret file:** upload the Aiven CA certificate as a Render Secret File named `aiven-ca.pem`. Render mounts it at `/etc/secrets/aiven-ca.pem`. Point the database URL at it: `...?sslmode=verify-full&sslrootcert=/etc/secrets/aiven-ca.pem`. Never commit the certificate or the URL.

**Environment variables** (values go only into Render's environment settings):

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` (the start command also sets it) |
| `APP_ENV` | `staging` on the Render URL. Switch to `production` only when the service serves `https://www.sportingspy.com`; startup rejects `APP_ENV=production` with any other origin. |
| `AUTH_MODE` | `production` |
| `ALLOWED_ORIGIN` | The service's HTTPS URL, e.g. `https://<service>.onrender.com` (no trailing slash) |
| `TRUST_PROXY` | `127.0.0.1/32,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16`. Render's in-container proxy connects from `127.0.0.1` (that entry makes HTTPS, Secure cookies and HSTS work); the private ranges let `X-Forwarded-For` skip Render's internal hops so rate limits see the real visitor. Only `127.0.0.1` is trusted on loopback, not `127.0.0.0/8`. Never use `true`, a hop count or `0.0.0.0/0` (startup rejects them). If HTTPS pages answer 426, the log names the exact address to add. After deploy the log prints one `Proxy chain:` line; it must end `client address resolves public`. |
| `HOST` | `0.0.0.0` (`PORT` is set by Render) |
| `DATABASE_POOL_MAX` | Optional; default `5` connections per process. During a deploy the old and new instance both connect, and a local `npm run dev` pointed at Aiven adds its own pool; keep the total under the Aiven plan limit (20, 3 reserved), or startup fails with `P2037`. |
| `DATABASE_URL` | Aiven URL with `sslmode=verify-full&sslrootcert=/etc/secrets/aiven-ca.pem` |
| `MEDIA_STORAGE_PROVIDER` | `r2` |
| `MEDIA_S3_ENDPOINT`, `MEDIA_S3_BUCKET`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` | R2 API endpoint, bucket and token |
| `MEDIA_S3_REGION`, `MEDIA_S3_FORCE_PATH_STYLE` | `auto`, `true` |
| `MEDIA_PUBLIC_BASE_URL` | Public bucket URL (the `r2.dev` URL for staging only; use a custom domain such as `media.sportingspy.com` for production). This value is built into the client, so change it and redeploy together. |
| `TOTP_ENCRYPTION_KEY` | Random secret of 32+ characters (required for staff 2FA) |
| `DEV_LOGIN_BYPASS`, `ALLOW_DESTRUCTIVE_DB_OPS` | `false` (or leave them unset) |
| Optional | `RESEND_API_KEY`, `MAIL_FROM`, `GOOGLE_SEARCH_CONSOLE_CREDENTIALS`, `BING_WEBMASTER_API_KEY`, `PROFILE_IMAGE_ALLOWED_ORIGINS`, `PUBLIC_CACHE_TTL_SECONDS` |

Do not set `SHADOW_DATABASE_URL`, `DEV_BYPASS_USER_ID` or `SHOW_AD_PLACEHOLDERS`.

**Database:** the schema and content are already on Aiven. For later releases with new migrations, back up first, then run `npm run db:migrate:deploy` from a trusted machine (or a Render one-off job) against the Aiven URL. Never run migrations in the build or start command.

**Media:** existing local uploads were copied to R2 under the same keys and checked byte for byte (`npm run media:copy-to-r2`; the manifest is in `backups/`). Database rows keep working without changes. When local storage is not configured, old `/media/<key>` URLs redirect (301) to `MEDIA_PUBLIC_BASE_URL`.

**Scaling:** run **one instance**. The scheduler and the public cache are in-process. Several instances would each run the scheduler, and their caches would refresh only within the TTL. A short overlap during a zero-downtime deploy is safe: scheduled publication uses a conditional update, so an article is never published twice.

**Release with CMS Pages (migration `20261011090000_phase_pages`):** this release adds the `Page` table and seeds the five existing pages (About, Contact, Privacy Policy, Terms, DMCA) with their current text. The migration is additive (one table, one audit enum value, five rows; nothing existing is changed) and safe to re-run. Order matters, because the new code serves those URLs from the database and startup refuses to run without the `Page` table:
1. Back up the Aiven database (see `DATABASE_OPERATIONS.md`).
2. From a trusted machine, with `DATABASE_URL` set to the Aiven URL: `npm run db:migrate:deploy`, then `npm run db:status`.
3. Deploy the code on Render.
4. Check `/about/`, `/contact/`, `/privacy-policy/`, `/terms-and-conditions/` and `/dmca/` load, and that Admin → Pages lists those five as "Required" pages.

If the code is deployed first, startup logs `Startup error codes: ... P2021` (missing table) and the previous release keeps serving; apply the migration and redeploy.

**Release with CMS autosave (migration `20261012090000_phase_autosave`):** adds the `EditorDraft` table (editor working copies). Additive only: one table, its indexes, a foreign key to `User` and two CHECK constraints; no existing table, row or enum changes. The new code reads the table, so the same order applies as for Pages: back up, `npm run db:migrate:deploy` against Aiven, `npm run db:status`, then deploy. Old code ignores the table, so migrating first is safe.

**After the first deploy:** check `/api/health/ready`, sign in to `/admin/`, upload and then delete a test image, schedule an article two minutes ahead and watch it publish, and confirm `X-Robots-Tag: noindex` on staging pages.

## Provider action: persistent media

For object storage provision an S3-compatible bucket and public CDN/domain. Set `MEDIA_S3_BUCKET`, `MEDIA_S3_REGION`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY`, and HTTPS `MEDIA_PUBLIC_BASE_URL`. For Cloudflare R2 set `MEDIA_STORAGE_PROVIDER=r2`, the account's HTTPS S3 API origin in `MEDIA_S3_ENDPOINT`, `MEDIA_S3_REGION=auto`, and `MEDIA_S3_FORCE_PATH_STYLE=true`. The S3 endpoint is **not** the public image host. Connect a stable HTTPS custom domain to the public bucket for `MEDIA_PUBLIC_BASE_URL`; Cloudflare's `r2.dev` URL is for non-production use. Temporary credentials may need `MEDIA_S3_SESSION_TOKEN`; credential refresh/rotation is an operator responsibility.

Staff/author images can use local `/media/...` paths, the configured media public origin, Unsplash's existing host, or exact HTTPS origins in `PROFILE_IMAGE_ALLOWED_ORIGINS` (comma separated). The account API rejects other hosts instead of saving URLs that production CSP cannot render. An empty avatar uses initials. Configure the origin before saving an external image URL; test the actual image response, not only a successful profile save. Native `<img>` elements deliver these images, so Next image `remotePatterns` do not apply. Changing `MEDIA_PUBLIC_BASE_URL` requires a rebuild because Next embeds it in client assets; the source code stays the same.

Grant the server only required bucket/object operations (HeadBucket/ListBucket as required by the provider, Get/HeadObject, PutObject and DeleteObject). Do not expose credentials to the browser. Uploaded media is intentionally public through the CDN; disable public bucket writes. Confirm the provider supports signed conditional PUT (`If-None-Match: *`) before launch. Changing storage providers does not transfer existing objects: copy/verify existing storage keys before switching, and retain the old source until public image URLs and CMS usage are verified.

For a live authenticated R2 API check, set `R2_LIVE_TEST=1` and `R2_LIVE_TEST_BUCKET` equal to `MEDIA_S3_BUCKET`, then run `npm run test:r2-live`. The guarded test writes one unique tiny image, reads its bytes, deletes it, and confirms absence. It does **not** verify public delivery, a configured CDN domain, image variants or the CMS path. Run the latter checks only after public access and the application media base are configured.

For `local`, explicitly mount `MEDIA_LOCAL_DIR` on persistent storage with write access; do not use ephemeral container disk. Back up originals and generated variants. Deleting/replacing a container must preserve uploads. A successful readiness probe does not prove persistent volume or backup configuration.

## Provider action: edge and observability

Configure DNS, valid TLS certificates, HTTPS termination/renewal and network restrictions. Forward the original protocol through the explicitly trusted proxy. Check that responses through the public HTTPS edge carry HSTS and the existing security headers, and that cookies remain Secure. Direct HTTP dependency probes are exempt from the transport requirement.

Collect service stdout/stderr in a protected log destination. Alert on readiness failures, 5xx rates, storage/database failures and process restarts; correlate errors with X-Request-Id. Keep request bodies, query strings and credentials out of logs. External alerting, uptime checks, dashboards and log retention require provider setup and have not been implemented by repository code.

## Phase R: optional integrations and their owner actions

| Variable / setting | Purpose | Without it |
| --- | --- | --- |
| `TOTP_ENCRYPTION_KEY` (env, 32+ chars) | Encrypts staff two-factor secrets | Production refuses 2FA enrolment (HTTP 503); rotate only when no account has 2FA on, or reset 2FA first |
| `RESEND_API_KEY`, `MAIL_FROM` (env) | Self-service password-reset e-mails | Requests answer generically and send nothing; Admins issue reset links from Users |
| `GOOGLE_SEARCH_CONSOLE_CREDENTIALS` (env) + Settings → Search Console property | Daily import of clicks, impressions, CTR, position, queries, pages, countries, devices, search appearance, sitemap status | Insights shows "not connected"; nothing is estimated. Add the service-account e-mail as a user of the property |
| `BING_WEBMASTER_API_KEY` (env) + Settings → Bing site URL | Daily import of Bing traffic, queries, pages, crawl stats | Same as above |
| `PUBLIC_CACHE_TTL_SECONDS` (env, default 60) | Public data cache lifetime per server process | — (0 disables). With several instances, other instances refresh within the TTL |
| Settings → Consent interface = `google-cmp` | Uses Google's certified CMP (AdSense Privacy & messaging) for advertising consent | Built-in banner. **Owner must enable the GDPR/UK/CH message in the AdSense account**; certification belongs to the CMP |
| Settings → AdSense Auto ads | Loads the AdSense tag on all pages for Auto ads | Controlled slots only |
| Settings → Real-user monitoring | First-party aggregate page views and Core Web Vitals | Enabled by default; disable if legal review requires |
| Settings → Site-wide /faq/ page | Optional global FAQ | Disabled (404) — FAQ is contextual |

Deploy order for this phase: back up → `npm run db:migrate:deploy` (applies `20261010090000_phase_r_requirements_reconciliation`, additive) → `npm run db:generate` → `npm run build` → restart → `npm run test:phase-r` only against a disposable/staging database (it creates and removes fixtures).

## Backup, restore and disaster recovery

The existing `npm run db:backup-drill` is preserved. It is **local development only**: it reads the source with `pg_dump`, restores to its own new drill database, compares all table counts/content hashes, migration history, extensions and the generated search vector, then removes only that drill database. Run this only after checking the local target; it is not a production backup scheduler.

**Provider action:** enable automated encrypted off-site PostgreSQL backups and PITR, retention and failure alerts. Agree recovery point/time objectives with the owner. Schedule periodic recovery into a disposable isolated server. Back up media separately (bucket versioning/replication or encrypted volume copies), along with secure copies of deployment configuration. Provider backup retention must cover accidental deletion; immutable object keys do not substitute for backups.

**Owner recovery procedure:** freeze writes, choose a verified restore point, restore the DB into a **new** database/server, restore matching media objects, compare row counts/content and migration history, validate Prisma/schema and drift, then launch staging with the restored target. Verify login/RBAC, scheduled publication, articles, FAQ, contact inbox, settings, public metadata and image URLs. Switch the service only after checks pass; retain the previous DB/media for investigation. Never restore over or drop a live database. Record measured data loss/recovery time from the drill.

## Phase N.1: restricted migration sources

The old site's backups (WordPress SQL dumps, WXR export, hosting backup archives, access logs) are **restricted migration sources**. They contain credentials, password hashes, TLS private keys and staff/visitor personal data (details in the Phase N.1 security audit, kept outside this repository).

- Keep them **outside** this repository, in one access-restricted folder (only the owner's account).
- Never put them in git/GitHub, a cloud-synced folder, `public/`, `storage/`, a deployment artifact or the server's web root.
- `npm run migration:inventory` reads them in place. Its output (`migration-inventory/`) holds public URLs and titles only and is git-ignored.
- `.gitignore` refuses common legacy artifacts (`*.sql` except Prisma migrations, archives, WordPress exports, `wp-config.php`, certificates, access logs) as a safety net. It is not permission to store them here.
- **Deploy only from a clean `git clone`/`git archive` of a commit**, never by uploading this working folder. Ignored local files such as `.env`, `backups/` and `migration-inventory/` must not reach the server.
- After cutover and a verified final archive, the owner deletes the remaining local copies.

## Phase N: legacy site migration runbook

Never run these steps against production first (v2.2 §20, §25). Keep the old WordPress site live until launch.

1. **Use the canonical host.** Set `ALLOWED_ORIGIN=https://www.sportingspy.com`; the production startup guard enforces it. Configure apex and HTTP host redirects at the proxy, then verify their final URL and hop count before launch.
2. **Draft the sheet from the real exports:** `npm run migration:inventory -- --wxr <export.xml> --rankmath-sql <dump.sql> --access-log <log.gz>`. The command is read-only and writes `migration-inventory/` (git-ignored). Editors fill in Decision / New URL. Nothing is guessed.
3. **On staging:** migrate or rewrite the content in the CMS, import the sheet, and fix every row with problems.
4. **Back up first:** take a database backup (provider snapshot, or `pg_dump`), then download URL Redirects → *Export all (CSV backup)*.
5. **Dry run, then apply.** The dry run shows creates, updates, retires and conflicts without writing anything. Apply is all-or-nothing.
6. **Test** every Old URL: exactly one 301 to a 200 page, or a real 404 for RETIRE. Also check canonicals and the sitemap (no redirected or retired URLs).
7. **Repeat on production**, then monitor Search Console / Bing, 404s and redirects.

**Rollback.** Before DNS switches, rolling back is simply not switching: the old site stays live. After a bad apply, deactivate the affected `origin = migration` rules in URL Redirects, using the export to compare. Alternatively, restore the pre-apply database snapshot into a new database, as described above. Old image URLs (`/wp-content/uploads/…`) cannot be redirected yet; see the Phase N migration audit (kept outside this repository).

## Rollback and secret rotation

Keep the prior code/build artifact and migration inventory. Roll back application code only when it is compatible with the deployed schema; do not assume all historical migrations are reversible. An incompatible database change requires a validated restore into a new target and an explicit traffic switch, with reconciliation of newer writes.

Rotate database/storage/provider secrets in their provider, update the deployment secret store, restart and check readiness/upload/smoke, then revoke old credentials. Use the password CLI for staff password replacement and session invalidation. Never automatically reset owner passwords. Media-domain changes require a new build.

## Post-deployment smoke checks

- Confirm `GET /api/health` and `GET /api/health/ready` return 200; readiness contains only `ok` dependency values.
- `SMOKE_BASE_URL=<canonical HTTPS origin> npm run smoke` (set environment using your shell/host). Optional staff credentials enable the existing login/CMS/logout checks; supply them through protected environment, not shell history.
- `PHASE_J_BASE_URL=<running origin> npm run test:phase-j`; for staging also set `PHASE_J_EXPECT_STAGING=1`. The default Phase J test uses mock S3 transport and temporary local files, with no DB writes.
- Verify public page canonicals, sitemap/robots, FAQ, submitted contact in Admin inbox, settings metadata and scheduling. Upload then delete a disposable image through the CMS to prove actual storage permissions and public delivery.
- Test HTTPS/HSTS/CSP/CSRF/CORS and cookie flags at the real edge; confirm staging noindex and no external IndexNow activity. Send SIGTERM in staging and confirm graceful shutdown before allowing production traffic.

Hosting, managed PostgreSQL, bucket/CDN, DNS/TLS, off-site backups/PITR, monitoring, real credentials/default-password replacement and legal/privacy approval remain owner/provider actions. Repository checks must not be reported as certification of those external resources.

## Phase T.1: portable VPS operating plan (owner actions, not executed here)

The same source release runs on a test VPS and a later production VPS. Keep Node/Next/Express behind an HTTPS reverse proxy; point `DATABASE_URL` at local, remote, or managed PostgreSQL; keep media binaries in R2 and relational metadata in PostgreSQL. Use `HOST=127.0.0.1` when the proxy shares the VPS, or a private bind address when it does not. Set `TRUST_PROXY` to the proxy's exact IP/CIDR so `X-Forwarded-Proto` controls Secure cookies and HSTS. Set `ALLOWED_ORIGIN` to the browser-facing HTTPS origin, never derive canonical URLs from an arbitrary request Host. The production origin is `https://www.sportingspy.com`; redirect apex and both HTTP hosts to that URL at the edge, preserving paths and queries. Confirm the redirect chain and TLS certificate there.

Use systemd as the generic process supervisor. Run the reviewed release as an unprivileged service account in a versioned release directory, with a protected environment file outside the release tree. A unit should set `WorkingDirectory` to the active release, `EnvironmentFile` to the protected environment file, `ExecStart` to the Node command behind `npm run start:production`, `Restart=on-failure`, `KillSignal=SIGTERM`, and `TimeoutStopSec` above the app's 10-second drain deadline. Bind the proxy upstream to `HOST:PORT`, block direct public access to that port, and proxy the original Host and scheme. Use `systemctl start|stop|restart|status <service>` and `journalctl -u <service>` for operations. Roll back by switching the active release symlink to the last schema-compatible artifact and restarting; verify readiness and public smoke routes. A database rollback is a separate isolated restore/cutover, never an in-place overwrite.

For staging use `NODE_ENV=production`, `APP_ENV=staging`, `AUTH_MODE=production`, an HTTPS staging `ALLOWED_ORIGIN`, distinct `DATABASE_URL`, R2 bucket/domain/credentials, and all other production guards. Staging noindex is additional protection; restrict access at the edge. The same code revision moves between VPS providers by changing DNS, proxy/TLS, secrets, database connection, R2 settings, and resource sizing. A changed public media base requires a rebuild from the **same source revision**, not a code edit. To move without rebuilding the compiled artifact, retain the same `MEDIA_PUBLIC_BASE_URL` across hosts.

### Backup and restore drill

1. Agree recovery point/time objectives, encrypted off-server PostgreSQL backup schedule, retention, and failure alerts. Keep backup credentials outside the release artifact. Keep an inventory of bucket objects, generated variants, and the matching PostgreSQL media metadata. Enable an independent R2 backup/versioning strategy and retain deleted-object recovery for the agreed window.
2. Record a consistent backup point and the matching media recovery point. Encrypt and store both off-server. Verify backup completion and alert delivery; a successful `pg_dump` command alone is insufficient.
3. Restore into a **new isolated PostgreSQL database** and a separate recovery media namespace/bucket. Never overwrite or drop the live database or bucket in a drill.
4. Compare schema/migration history, extensions, table counts, key content, media keys and variants. Run the isolated app with recovery configuration, then verify login, article, event, media delivery, search, and an admin edit. Record measured restore duration and data loss window.
5. For a real incident, freeze writes, choose a verified recovery point, repeat the isolated restore, verify it, then change the protected connection/edge configuration and monitor. Preserve old targets for investigation.

### Monitoring and clean artifact

Monitor `/api/health` for liveness and `/api/health/ready` for database/storage reachability, plus process restarts, HTTP 5xx, database failures, media upload/read failures, backup failures, CPU/memory/disk, and certificate expiry. Route alerts to an owner-maintained channel; protect logs and correlate incidents with `X-Request-Id`. Readiness uses authenticated bucket HEAD and cannot prove upload or public GET, so include a disposable CMS upload/read/delete smoke check.

Build an artifact from a clean reviewed revision using an **allowlist**, not a recursive copy of this working tree. Include application source/build output, `package.json`, `package-lock.json`, Prisma schema/migrations and generated client, and runtime dependencies installed from the lockfile for the target platform. Include `tsx` because the custom production server uses it. Exclude `.env`, secret files, dumps/backups, migration inputs, legacy archives, `.codex-runtime`, `.perf`, screenshots, verification output, local reports, test fixtures, debug logs, and temporary files. Validate the artifact file list and inspect for secret-like files before transfer. Keep the protected environment file and persistent media volume outside versioned releases. No artifact was produced in Phase T.1.

### Open security blocker

The old live-site TLS private key was present in a restricted legacy backup (Phase T T-02). The owner must replace/revoke the old certificate/key, verify a new key is active at the public edge and the old key is no longer used, then secure/remove restricted backup copies as appropriate. Retain evidence of those checks before certifying production. This runbook does not perform or certify key rotation.
