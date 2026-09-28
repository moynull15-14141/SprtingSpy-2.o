# PHASE D — SEO INTELLIGENCE + TECHNICAL SEO

## Status

Implemented and verified locally on 2026-09-27. This means the Phase D application work is present and the automated local checks below pass. It is not a production deployment, a Search Console/Bing API connection, or a claim that an unconfigured AI provider returned results.

## Implemented

- A database-backed, runtime-configurable SEO rules engine with enable/disable, severity, article-type scope, validated configuration, versioning and Admin-only mutation.
- Admin-triggered/cached site scans. Findings identify what is wrong, why it matters, where it occurs, priority, what to change and the relevant CMS area. There is no aggregate SEO score.
- Article-type-aware checks for Schedule, Results, How to Watch, Event Guide, Prize Money, Past Winners, News, Analysis, Interview, Opinion and the remaining existing types through configurable applicability and topic requirements.
- AI Search Readiness diagnostics for answer clarity, entities, structured information and topic completeness.
- An optional Gemini content assistant that only returns suggestions. With no key it reports Not configured; it never writes, rewrites, links, saves or publishes content.
- Article-editor SEO workflow: check the unsaved draft, inspect actionable checks, internal-link opportunities, official-source opportunities, event coverage gaps and optional AI suggestions.
- Internal-link ranking by same edition, same event, same sport, topic relationship and freshness; broken internal-link, redirect-hop, minimum-link and orphan diagnostics.
- Explicit freshness monitoring based on meaningful `updatedAt`, edition dates and `reviewedAt`. Editors can mark an article reviewed without changing its content-update timestamp.
- Event/edition coverage recommendations. They never create or publish articles.
- Structured-data diagnostics plus server-rendered Article/NewsArticle, SportsEvent, BreadcrumbList, Organization, Person and ProfilePage output where the visible page supports it.
- Dynamic sitemap index and child sitemaps. Drafts, redirects, noindex/non-self-canonical and non-indexable pages are excluded. The stale static sitemap/robots files are removed.
- Controlled dynamic `robots.txt`, server-rendered canonicals, real 404s, trailing-slash canonical policy and search/filter noindex behavior.
- Redirect hardening: unique sources, loop/self/chain protection, final-destination flattening, live-target validation, live-source protection, safe CRUD and migration bulk import.
- IndexNow configuration, key-file route, meaningful-change triggers and honest submission logs. Local/non-HTTPS instances do not submit unless an explicit test endpoint is configured.
- Google Search Console and Bing readiness/configuration state using existing verification settings and the sitemap. No performance metrics are fabricated when APIs are disconnected.
- SEO report history and previous-scan comparison.
- Staff-only API/UI with Admin/Editor/Author boundaries and CSRF enforcement.

## Database

Additive migration: `prisma/migrations/20260928090000_phase_d_seo_intelligence/migration.sql`.

- Adds nullable `Article.reviewedAt`.
- Adds `SeoRule`, `SeoScanRun` and `SeoIntegrationLog`.
- Does not alter existing content values, drop/truncate/reset tables, or touch `data/db.json` / `PROJECT_BRAIN.md`.
- Prisma schema validation passes; all five migrations are applied and the local database is up to date.

## Main implementation areas

- `server/seo/` — analysis, context, rules, evaluation, suggestions, assistant, sitemap, robots, site index, IndexNow and API routes.
- `src/components/admin/AdminSeoAudit.tsx` — scans, findings, technical health, integrations, rules and reports.
- `src/components/admin/AdminArticles.tsx` — draft SEO check/suggestions/assistant and freshness review control.
- `server/redirects.ts` — redirect validation and hardening.
- `server/scripts/verify-phase-d.ts` — safe real-HTTP Phase D verification with fixture cleanup and full-row integrity hashes.

## Verification results

Passed:

- `npm run lint`
- `npm run build` (Next.js production build; all public routes server-rendered on demand)
- `npx prisma validate`
- `npx prisma migrate status` (5 migrations; up to date)
- `npm run test:phase-a` — 13 groups
- `npm run test:phase-b` — 10 groups
- `npm run test:phase-c` — 13 groups
- `ENABLE_READER_ACCOUNTS=true ENABLE_COMMENTS=true npm run test:phase4` — 20 groups; Phase A separately verifies both launch flags OFF
- `npm run test:phase-d` — 9 integration groups covering RBAC/CSRF, rules, type-aware checks, AI safety, scans/reports, integrations, sitemap/robots/canonical/JSON-LD/noindex, redirects/404s and public-data isolation
- `git diff --check`

Every Phase D verifier run restored the changed rule, removed only UUID-scoped fixtures, compared full-row hashes for 17 tables, and confirmed `data/db.json` and `PROJECT_BRAIN.md` were unchanged.

Browser verification was attempted through the available in-app browser, but its connection failed before opening a page because the environment did not supply the required `sandboxPolicy`. No browser pass is claimed. The HTTP integration checks and initial server HTML assertions passed.

The standalone HTTPS production browser suite was not run for the same reason: this checkout has no usable Playwright module/browser bridge in the current environment. The non-browser production/security behavior is covered by the phase suites above.

## Configuration-dependent behavior

- Gemini suggestions require `GEMINI_API_KEY` (optional `GEMINI_MODEL`).
- IndexNow submissions require an Admin-configured key and a public HTTPS origin.
- Search Console/Bing verification tokens can be configured now. Their performance APIs are not connected, so the UI truthfully shows no metrics.

## Remaining limitations

- External-link diagnostics validate hygiene and known official-source opportunities; they do not continuously crawl arbitrary external websites, avoiding expensive/unreliable scans and third-party load.
- Scans are Admin/Editor-triggered and cached; there is no job runner/scheduler in the current architecture.
- Rule logic remains versioned in code while editor-adjustable state/thresholds/type scope live in the database. Adding an entirely new executable rule still requires deployment.
- IndexNow receipt means submitted, never indexed.
- Browser-only visual verification remains to be rerun when the browser bridge is available.

## Re-run

```powershell
npm run lint
npm run build
npm run test:phase-d
npx prisma validate
npx prisma migrate status
```

Do not run Prisma reset, table/database drops, truncation or destructive reseeding.
