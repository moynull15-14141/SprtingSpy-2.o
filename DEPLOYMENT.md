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

Use a supported Node runtime with `fetch`, `AbortSignal.timeout`, `--import tsx` and the installed Next/Prisma version requirements. Install from the lockfile with `npm ci`. Do not prune `tsx` from the runtime; the custom server runs through it. PostgreSQL must support the existing migrations/extensions. Keep development, staging and production databases, storage and credentials separate.

Inject secrets through the host's secret manager or protected environment, never Git. Use `.env.example` for names and replace its placeholders. A deployment needs:

| Variable | Required deployment value |
| --- | --- |
| `NODE_ENV` | `production` (set by production start command) |
| `APP_ENV` | `staging` or `production`; `.env.example` is development |
| `AUTH_MODE` | `production` |
| `DATABASE_URL` | Explicit PostgreSQL database, with provider-required TLS; no development/test database for public production |
| `ALLOWED_ORIGIN` | Canonical HTTPS origin, no trailing slash/path/credentials |
| `HOST`, `PORT` | Bind address and service port; restrict direct external access |
| `TRUST_PROXY` | Exact proxy IP/CIDR list, or `false` when no proxy terminates TLS; never blanket trust |
| `DEV_LOGIN_BYPASS` | `false` |
| `ALLOW_DESTRUCTIVE_DB_OPS` | `false` |
| `MEDIA_STORAGE_PROVIDER` | `s3`, or `local` with persistent backed-up volume |

Unset `SHADOW_DATABASE_URL` and development identity overrides. `GEMINI_API_KEY` is optional; remove its example placeholder if the integration is unused. Public media base is inlined into client assets at build time, so rebuild when changing it. Site settings, analytics/verification IDs and consent are managed through the existing CMS; test their deployed effects.

## Owner action: database, build and launch

1. Confirm the target's hostname/database in your provider dashboard or a credential-safe connection inspection. Inspect migration history and affected tables; inspect `npm run db:status`. Back up the existing database before applying migrations.
2. For staging/production apply **existing reviewed migrations** with `npm run db:migrate:deploy`. Never use `db:migrate`/`prisma migrate dev`, `migrate reset`, `db push`, or the legacy bulk importer on a deployment database. The local migration guard intentionally allows only local development targets. `migrate deploy` does not use a shadow database.
3. Run `npm run db:validate` and `npm run db:status`. Check drift by comparing the actual schema with the reviewed migration history on an isolated database using the installed Prisma version's diff options. A successful migration status alone does not prove absence of drift. Verify row counts and affected content after migration.
4. Set real passwords for existing staff using `npm run users:set-password -- <email>`. This CLI reads the password securely and revokes sessions. Do not put passwords in command arguments or logs. Public production refuses documented default credentials. Local loopback/reserved-domain verification retains the existing Phase G warning exception and must not be exposed publicly.
5. `npm run db:generate` (the generated client is excluded from Git and must be generated on a clean checkout), then `npm run build`, `npm run check:env`, and `npm run start:production`. Generation does not migrate or modify the database. The configuration check does not certify database connectivity, actual provider permissions or account passwords; boot/readiness and smoke checks verify those separately.
6. Set up a supervisor to restart failed processes, send SIGTERM on deploy and allow more than the application's 10-second drain deadline before force termination. Route traffic only to ready instances.

## Provider action: persistent media

For object storage provision an S3-compatible bucket and public CDN/domain. Set `MEDIA_S3_BUCKET`, `MEDIA_S3_REGION`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY`, and HTTPS `MEDIA_PUBLIC_BASE_URL`. For non-AWS providers set HTTPS `MEDIA_S3_ENDPOINT` (origin only) and the provider's `MEDIA_S3_FORCE_PATH_STYLE`. R2 commonly uses region `auto`. Temporary credentials may need `MEDIA_S3_SESSION_TOKEN`; credential refresh/rotation is an operator responsibility.

Grant the server only required bucket/object operations (HeadBucket/ListBucket as required by the provider, Get/HeadObject, PutObject and DeleteObject). Do not expose credentials to the browser. Uploaded media is intentionally public through the CDN; disable public bucket writes. Confirm the provider supports signed conditional PUT (`If-None-Match: *`) before launch. Changing storage providers does not transfer existing objects: copy/verify existing storage keys before switching, and retain the old source until public image URLs and CMS usage are verified.

For `local`, explicitly mount `MEDIA_LOCAL_DIR` on persistent storage with write access; do not use ephemeral container disk. Back up originals and generated variants. Deleting/replacing a container must preserve uploads. A successful readiness probe does not prove persistent volume or backup configuration.

## Provider action: edge and observability

Configure DNS, valid TLS certificates, HTTPS termination/renewal and network restrictions. Forward the original protocol through the explicitly trusted proxy. Check that responses through the public HTTPS edge carry HSTS and the existing security headers, and that cookies remain Secure. Direct HTTP dependency probes are exempt from the transport requirement.

Collect service stdout/stderr in a protected log destination. Alert on readiness failures, 5xx rates, storage/database failures and process restarts; correlate errors with X-Request-Id. Keep request bodies, query strings and credentials out of logs. External alerting, uptime checks, dashboards and log retention require provider setup and have not been implemented by repository code.

## Backup, restore and disaster recovery

The existing `npm run db:backup-drill` is preserved. It is **local development only**: it reads the source with `pg_dump`, restores to its own new drill database, compares all table counts/content hashes, migration history, extensions and the generated search vector, then removes only that drill database. Run this only after checking the local target; it is not a production backup scheduler.

**Provider action:** enable automated encrypted off-site PostgreSQL backups and PITR, retention and failure alerts. Agree recovery point/time objectives with the owner. Schedule periodic recovery into a disposable isolated server. Back up media separately (bucket versioning/replication or encrypted volume copies), along with secure copies of deployment configuration. Provider backup retention must cover accidental deletion; immutable object keys do not substitute for backups.

**Owner recovery procedure:** freeze writes, choose a verified restore point, restore the DB into a **new** database/server, restore matching media objects, compare row counts/content and migration history, validate Prisma/schema and drift, then launch staging with the restored target. Verify login/RBAC, scheduled publication, articles, FAQ, contact inbox, settings, public metadata and image URLs. Switch the service only after checks pass; retain the previous DB/media for investigation. Never restore over or drop a live database. Record measured data loss/recovery time from the drill.

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
