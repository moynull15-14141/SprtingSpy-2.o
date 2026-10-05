# Phase R: Deployment readiness report

Target: one Render Web Service (Express + Next.js in one Node 22 process), Aiven PostgreSQL 18, Cloudflare R2 media, scheduler inside the process. This report contains no secrets. The production domain, DNS and WordPress were not touched. The legacy migration remains **on hold, pending client approval**.

## 1. Executive summary

The repository builds from a clean copy without `.env`, a database or certificates, and starts in production mode with Render-like settings against Aiven and R2. All regression suites pass. Two real deployment problems were found and fixed: `next build` crashed without `DATABASE_URL`, and the event hero image did not fill its box on wide and small screens. What remains is owner/provider actions (credential rotation, the Render service itself), not code.

**Final status: READY FOR RENDER STAGING**, provided the owner completes section 17 items 1–4 before or at service creation.

## 2. Initial audit findings

- `npm run build` did not run `prisma generate`; on a clean checkout the generated client (git-ignored) was missing.
- Node version was not pinned.
- `next build` exited when `DATABASE_URL` was absent (module-level guard in `server/db.ts`).
- Media lived only on local disk (6 items, 45 objects including variants); Render's disk is temporary.
- Seed/demo accounts with documented passwords existed; the production launch guard would refuse to start.
- `admin-article-ui` and several suites were stale after intended UI changes; the HTTPS production suite and boot matrix broke after the Phase N.1 canonical-origin guard.
- No feedback when Render's proxy is not in `TRUST_PROXY` (all HTTPS pages return 426).
- Event hero: `aspect-ratio` + `max-height` with automatic width capped the box at ~1243 px (empty strip at 1920 px) and widened it to 585 px on 360 px phones.

## 3. Changes implemented

- `build` = `prisma generate && tsc --noEmit && next build`; `engines.node` = `>=22 <23`.
- `server/db.ts`: the missing-`DATABASE_URL` exit is skipped only during `next build` (all pages are dynamic and the pool connects lazily); the server still refuses to start without it.
- `server.ts`: when media is not local, `/media/<key>` redirects (301) to `MEDIA_PUBLIC_BASE_URL`.
- `server/deployment.ts`: a one-time log names the proxy address to add when an HTTPS-forwarded request is rejected.
- `server/scripts/media-local-to-r2.ts` (`npm run media:copy-to-r2`): guarded copy of local media to R2, byte-for-byte verification, manifest in `backups/`.
- `server/scripts/verify-render-staging.ts` (`npm run verify:render-staging`): read-only post-deploy check for the staging URL.
- `src/views/EventPage.tsx`: event hero gets an explicit full width.
- Phase R UI fixes (article reading column and heading levels, header menus, theme System option, CMS editor focus layout, Settings help tooltip).
- Tests updated to match intended behaviour (never weakened); stale doc references removed.
- Documentation: Render section in `DEPLOYMENT.md`; `MANUAL_SECURITY_ACTIONS.md`.

## 4. Files changed

Key files: `package.json`, `server/db.ts`, `server.ts`, `server/deployment.ts`, `src/views/EventPage.tsx`, `server/scripts/{media-local-to-r2,verify-render-staging,audit-ui-layout}.ts`, `server/scripts/{verify-phase4,production-checks,verify-site-experience,verify-admin-article-ui,verify-settings-ui,verify-phase-a..d}.ts`, `DEPLOYMENT.md`, `MANUAL_SECURITY_ACTIONS.md`, this report. Old phase reports, `data/db.json` and `metadata.json` were removed from the repository and kept in the project archive outside it. See `git show --stat` for the full list.

## 5. Build verification

Clean copy of only the committable files (no `node_modules`, `.next`, generated Prisma client, `.env`, certificates, uploads): `npm ci --include=dev` passed (382 packages), and `npm run build` passed with `DATABASE_URL` unset. Prisma generation, TypeScript and Next.js all passed; all 21 routes are dynamic. `npm audit`: 4 high advisories, all in the Prisma CLI's dev tooling (`mysql2`, `deepmerge-ts`); the only fix is a major downgrade, so nothing was changed (no `--force`).

## 6. Startup verification

The clean build started with `npm run start:production` using:
- `APP_ENV=staging`, `AUTH_MODE=production`, `HOST=0.0.0.0`, `PORT=10000`;
- an HTTPS `ALLOWED_ORIGIN` and private-network `TRUST_PROXY`;
- Aiven with the CA from a separate secret-file path;
- R2 storage.

Results:
- `/api/health` 200; `/api/health/ready` 200 with database and storage both ok.
- A proxy that is not trusted gets 426, plus the hint log.
- With the proxy trusted, `verify-render-staging` passed 7/7 groups: HSTS, strict CSP, staging noindex, pages, 18 media URLs from R2, the `/media` redirect, Secure/HttpOnly/SameSite cookies, CSRF, and refusal of foreign origins.
- No secrets appeared in the server logs.

## 7. Test results

All suites pass on the local test database: phase4, a, b, c, d, d1, d1.1, e, e1–e5, f, g, h, i, j, m, n, p, q, r, r1, s, s-browser, t1-profile, newsroom-editor, settings-ui, ad-creatives, site-experience (38/38), search-states, search-ui, admin-article-ui and production (HTTPS, 31 groups).

Notes:
- phase-c and phase-r1 each failed once under heavy machine load and passed on rerun.
- phase-r needed today's page-view counters cleared on the **local** test database; my own UI audit had filled them.
- UI audit: 7 widths × light/dark × 18 pages, plus every CMS screen. Result: no horizontal overflow and no page errors.

## 8. admin-article-ui result

Passes. Two updates: a stale locator (`Articles` button) was fixed, and the laptop assertion now matches the intended two-column layout at 1280 px.

## 9. R2 verification

Authenticated readiness (HeadBucket) ok. Public delivery verified from a production-mode page: images load as `image/*` from the bucket's public URL. Conditional PUT is used, so existing objects are never overwritten.

## 10. Media migration result

45 objects (6 media items with responsive variants and ad creatives) copied under the same keys. All 45 were verified by SHA-256 and content type through the public URL, and every key referenced in the database is present. Local originals were kept and database rows were not changed. Manifest: `backups/media-r2-manifest-*.json` (git-ignored).

## 11. Seed-account status

Aiven: 1 active Admin (the owner's secure account, not modified); the 4 seed/demo accounts are **deactivated, not deleted**. No active account uses a documented password, so the production launch guard passes.

## 12. Security findings

- No secrets, certificates, dumps or `.env` in committable files (exact-value and pattern scan); the only hit is AWS's public example key in a test mock.
- Credentials pasted into chat (Aiven `avnadmin`, R2 token) must be rotated: see `MANUAL_SECURITY_ACTIONS.md`.
- Old WordPress backup secrets (TLS key, DB password, salts, OAuth) still need rotation on the live host.
- The owner's Admin avatar is a Facebook page URL that CSP blocks (initials shown); fix in Account settings.

## 13. Demo-data cleanup

Demo/test content was removed or hidden earlier in this phase. Aiven now holds 14 sports (Kabady hidden, not deleted), 5 events, 6 editions, articles (8 published, 1 preview, 1 archived), 6 media items and 3 redirects. One unused "test hero" media item and the noindexed Wimbledon 2027 edition were left for the owner to decide.

## 14. Scheduler verification

- **Start:** `setInterval` every 30 s, started with the server and stopped on SIGTERM/SIGINT before the database disconnects.
- **Publishing:** phase-i ran the real production build. A scheduled article stayed private (404), then the scheduler published it with `publishedAt` exactly equal to `scheduledFor` (UTC timestamps).
- **No duplicates:** publishing uses a conditional update, so overlapping ticks or two instances during a deploy never publish an article twice. Site Experience schedules were verified the same way.
- **Restart:** articles that fall due while the server is down are published on the first tick after it starts (the query is `scheduledFor <= now`).
- **Graceful shutdown:** the code path is checked, but a real SIGTERM could not be sent on Windows and the Docker test was skipped at your request. Check it on Render with one manual deploy.

## 15. Render readiness

The exact configuration is in `DEPLOYMENT.md` → "Render staging: one Web Service":
- region Singapore, a paid always-on instance;
- build `npm ci --include=dev && npm run build`, start `npm run start:production`;
- health check `/api/health/ready`;
- the Aiven CA as the Secret File `/etc/secrets/aiven-ca.pem`;
- `APP_ENV=staging` with the Render URL as `ALLOWED_ORIGIN`;
- `TRUST_PROXY=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16`;
- R2 variables, `MEDIA_PUBLIC_BASE_URL`, `TOTP_ENCRYPTION_KEY`;
- one instance.

## 16. Remaining blockers

1. **Code blockers:** none.
2. **Database blockers:** none for staging. Aiven holds the verified copy of the content; migrations are applied.
3. **External-provider/manual blockers:** rotate the exposed Aiven and R2 credentials; create the Render service with its secrets.
4. **Migration blockers:** the legacy WordPress migration and DNS switch are on hold pending client approval (not needed for staging).

## 17. Exact manual actions required from you

1. Rotate the Aiven `avnadmin` password and the R2 API token, and update your local `.env` (MANUAL_SECURITY_ACTIONS A1, A3).
2. Generate a new `TOTP_ENCRYPTION_KEY`.
3. Keep the GitHub repository private.
4. Create the Render Web Service exactly as in `DEPLOYMENT.md`: add the env vars and upload `aiven-ca.pem` as a Secret File.
5. After the first deploy, run `STAGING_BASE_URL=https://<service>.onrender.com MEDIA_PUBLIC_BASE_URL=<r2 url> npm run verify:render-staging`. Then sign in, upload and delete a test image, and schedule an article two minutes ahead.
6. Restrict Aiven's allowed IPs to Render's outbound IPs and your own.
7. Old WordPress host: do the rotations in MANUAL_SECURITY_ACTIONS section B.

## 18. Recommended next phase

Render staging rollout and acceptance:
1. Deploy and run the post-deploy checks above.
2. Content and editorial UAT with the client.
3. Set up the R2 custom media domain and Aiven backups/PITR.
4. Get client approval for the legacy migration.
5. Production cutover to `https://www.sportingspy.com` (`APP_ENV=production`).
