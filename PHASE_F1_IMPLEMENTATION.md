# PHASE F.1 — Site-wide Editorial & Layout Control

PHASE F.1 STATUS: **COMPLETE**. F.1 production-mode integration/browser suite: **37 PASS, 0 FAIL**, including the intro background image follow-up. All **16 suites PASS, 0 FAIL**, including F.1 and 15 existing regression suites. This report does not claim a deployed production environment is verified.

## 1. Initial audit

See [PHASE_F1_AUDIT.md](PHASE_F1_AUDIT.md). The interrupted implementation already contained the new service, migration, public renderers, sidebar entry and individual forms. Its main admin component and test suite were missing; TypeScript failed. Historical PROJECT_STATE/DEVELOPER_HANDOFF describe the obsolete SPA architecture.

## 2. Existing systems reused

Express/Next App Router, public article eligibility and summaries, the Phase E CMS search hook/service, existing article cards and layout styles, branding, Admin/Editor sessions, CSRF, audit logs, scheduler, Prisma/PostgreSQL, settings/SEO, media and Phase F advertisements/privacy. No replacement auth, search, media, SEO, analytics or ad engine.

## 3. Database and migration

Retained the prior agent's single `SiteExperience` model and additive `20261002090000_site_experience` migration, already applied locally. Each of five areas holds validated draft/published/scheduled JSON snapshots and publication metadata. No additional tables/migrations or destructive database operation. Existing schema had no persisted section/menu/layout model suitable for publication snapshots. Prisma schema validates, all 10 migrations are applied, and live-schema comparison reports no drift.

## 4. Admin UI

**Admin → Site Experience** opens Overview, Homepage, Header & Navigation, Footer, Announcements, Global Blocks and Preview / Publish. Overview shows published versions, publisher/time, draft changes, schedules and currently active published global blocks. Shared forms use the existing CMS style, loading/error/retry states, validation, confirmations and keyboard controls. Unsaved edits remain available across area tabs; leaving the CMS area warns before discarding them. Saving one area preserves unsaved edits in other areas.

## 5. Homepage

Approved sections: intro/CTAs, hero/top stories, article sections, featured events, sport directory, upcoming editions, reusable block and existing ad slots. Editors add/remove/reorder sections, use native drag handles or keyboard move buttons, toggle visibility, change titles/eyebrows/text and select layouts/counts. Hero supports a lead story plus up to three secondary stories or equal cards. Article sections support lead/grid/list layouts and optional archive links. Empty/unavailable sections collapse, and the homepage retains one h1 even without an intro.

Automatic sources use latest articles, sport, event or existing article category. Manual sources preserve selected order; mixed sources put selections first and fill automatically. Unavailable selected stories fall back safely. Article names/media are resolved in batches; matching automatic queries are shared across sections; later automatic sections omit previously shown stories.

Intro banner image follow-up: choose/upload a background through the existing Media Library, with all text/buttons layered above it. Ten presets: Editorial gradient, Stadium centre, Lower caption, Right focus, Glass panel, Framed cover, Side panel, Spotlight, Warm editorial and Minimal cover. Editors control desktop/mobile crop coordinates, zoom, overlay darkness, banner height, headline size, content width and horizontal/vertical text position. The live editor preview reuses the public renderer and offers desktop/mobile views. Existing JSON documents without appearance settings continue to validate; no database migration is needed. Background images use existing responsive AVIF/WebP delivery. Missing/restricted images fall back to the gradient, and all draft/published/scheduled references appear in Media Library usage and prevent deletion. Existing draft, preview, publish and scheduling behavior applies to these settings.

## 6. Header/navigation

Ordered shared menu model with independent desktop/mobile visibility, labels/mobile labels, internal/HTTPS destinations, existing sports submenu/search icon and external new-tab behavior. Desktop navigation wraps when more links are configured. Brand, theme and staff-account controls retain existing system behavior. No secondary menu existed to migrate.

## 7. Footer

CMS controls tagline, notes, copyright/status text, ordered/visible columns and links, dynamic sport columns and supported social profiles. Privacy preferences reuse the existing consent dialog and respect the configured label. Hiding required legal links or their columns warns explicitly; the underlying pages are not deleted. Logo selection is absent because no existing media-backed logo feature exists.

## 8. Global blocks/announcements

Reusable editorial message, CTA and featured-story blocks support enable/disable, content, start/end windows and approved homepage/article-end/sport-top/footer-top placements. Homepage placement uses an explicit block section. No HTML/CSS/JavaScript editor. Advertising stays in Ad Placements.

Breaking/info announcements support text, public article or validated link, visibility, priority and time windows. At most two active announcements render beneath the header, highest priority first. Expired items disappear; links to articles that become private are withdrawn.

## 9. Preview/publish/scheduling

Saving creates private drafts. Preview uses an HttpOnly one-hour preference cookie **plus an active Admin/Editor session**, including the existing session expiration/deactivation checks. A forged cookie reveals no draft. Preview responses are private/no-store and noindex/nofollow; the banner exits preview through the same CSRF-aware API.

Each area publishes separately or schedules one frozen snapshot. Subsequent draft edits do not alter a scheduled snapshot. Due snapshots are effective on fresh page requests, and the existing timer records publication. Publishing/cancellation clears the scheduled snapshot. Conditional transactional scheduler updates prevent duplicate publication by competing ticks. Publication detects a concurrently modified draft/version and returns 409. Discard restores the current published document/default; no historical rollback system is introduced.

JSONB object-key order is ignored when comparing documents, while array order remains significant. This fixes false dirty indicators and disabled preview/publish controls after a successful save.

## 10. RBAC

Admin and Editor may read/edit all areas. Admin may publish/schedule every area; Editor may publish/schedule homepage, announcements and blocks. Header/navigation/footer publication requires Admin. Authors and anonymous visitors cannot read or mutate these configuration APIs. No new role model/authentication mechanism.

## 11. Security

Shared client/server validation rejects unknown/missing fields, malformed ids, duplicate items/ad slots, HTML/control characters, unsupported types/placements/categories, unsafe URL schemes, protocol-relative links, credentials, encoded unsafe paths and private admin/API/account destinations. Reuses the project's URL validator with stricter site-config rules. Manual article publication checks the existing public visibility rules. CMS article selection uses the shared search API's optional `publicOnly` filter. Existing global CSRF and no-store API middleware apply; mutations reuse the in-memory rate-limiter factory (120/minute/user). Audit details name the area/action without storing editorial text or secrets.

## 12. Cache/revalidation

The existing root layout is `force-dynamic`; React cache only deduplicates the configuration within the current request. There is no persisted Next/ISR configuration cache to purge. New requests observe publication and schedule windows without restart. Already-open pages update on refresh/navigation. Missing/invalid configuration serves approved defaults.

## 13. SEO

Existing SEO settings, canonical metadata, sitemap and robots implementations remain authoritative. Configuration creates no public URLs. Tests verify unchanged homepage canonical, sitemap and robots, unpublished content exclusion and preview indexing protection.

## 14. Accessibility

Labelled fields, accessible button names, native form controls, keyboard section/link ordering, focus rings, clear status/error messages and a single homepage h1. Production-browser tests exercise desktop and 390px mobile public/admin views, keyboard focus and mobile navigation with no horizontal overflow or implementation page errors. The existing focused accessibility audit passed on homepage and sports directory in light/dark mode at desktop/mobile widths: **8 combinations, 0 reported issues**. This is not a complete manual screen-reader certification.

## 15. F.1 tests

`npm run test:site-experience` — **37 named verification groups PASS, 0 FAIL** in the final completed run. Uses the production build, real HTTP APIs, PostgreSQL and headless installed Chromium. Checks draft/publish/schedule snapshot isolation, concurrent scheduling, public eligibility/fallback, ordering/visibility, navigation/footer validation, reusable blocks/windows, RBAC/CSRF/XSS/mass assignment, preview privacy/SEO, live update behavior, browser editors/publish/schedule and desktop/mobile navigation. The image follow-up adds validation/media protection, image picker and live presets, all ten public styles at 1440px/390px with JavaScript disabled, and background removal. All pre-existing rows are hash-compared after restoration; fixture users/articles/media/sessions/audits are removed.

The suite requires a local non-production DATABASE_URL, a current build and PLAYWRIGHT_EXECUTABLE_PATH. No remote production data is used. Early runs exposed two ambiguous test selectors and the JSONB document-comparison bug; the selectors and implementation were corrected before the successful final run.

Evidence: `verification/site-experience/{admin-overview,admin-homepage,admin-mobile,public-desktop,public-mobile}.png`. Raw logs: `.codex-runtime/f1-verification/`.

Image follow-up evidence: `verification/site-experience/admin-intro-image.png`, `intro-{stadium,glass}-{1440,390}.png`. One initial Chrome screenshot capture failed; rerun completed all 37 checks without changing the product or assertions.

After the image change, reran F.1 (37/0), Phase B (11/0), Phase C (16/0) and Phase D.1.1 (8/0), plus the focused homepage/sports accessibility audit (8 combinations, no reported issues). The new production build passed. Restarted the local development backend and separately verified its authenticated API, homepage editor, image control and ten live presets in Chrome. Other suite counts below are from the earlier completed F.1 regression run.

## 16. Regression results

All suites below completed successfully against the local database; browser suites used installed Chrome. Counts are named verification groups, excluding summary lines and additional cleanup/integrity PASS lines.

| Existing suite | PASS | FAIL |
| --- | ---: | ---: |
| Phase A | 15 | 0 |
| Phase B | 11 | 0 |
| Phase C | 16 | 0 |
| Phase D | 9 | 0 |
| Phase D.1 | 11 | 0 |
| Phase D.1.1 | 8 | 0 |
| Phase E | 12 | 0 |
| Phase F | 11 | 0 |
| Phase G | 6 | 0 |
| Phase 4 accounts/security | 24 | 0 |
| Production HTTPS/security | 31 | 0 |
| Newsroom editor | 7 | 0 |
| Search UI | 7 | 0 |
| Search states | 5 | 0 |
| Admin article UI | 5 | 0 |
| **Regression total** | **178** | **0** |

Database integrity/fixture cleanup checks passed. The production suite exercised local HTTPS and real browser transport/cookie/security behavior. Final `npm run lint`, `npm run build`, `npm run db:validate`, `npm run db:status`, Prisma live-schema drift comparison and `git diff --check` passed; all 10 migrations are applied.

Existing regression fixtures/selectors needed narrow updates for changes already made before this continuation: accessible sidebar/title/toolbar/preview names, collapsed article metadata and the media filter's current listbox control. Phase E's fuzzy-search fixture now guarantees distinct transposed suffix characters. Phase 4 explicitly enables its account/comment features in the isolated test server, while Phase A still verifies launch flags off. The assertions and product security requirements remain intact. Phase B's initial browser timeout passed on rerun with the same assertion; failure-only screenshot/HTML capture was added for diagnosis. Initial failures and final outputs are retained in `.codex-runtime/f1-verification/`.

## 17. Known limitations

Localhost follow-up: the user's already-running `tsx server.ts` process predated the new Express routes. Next hot-reloaded the UI while the backend still returned `API route not found`. Restarted only this project's development server on port 3000; authenticated API and actual localhost Chrome overview/homepage checks now pass. The dev command does not watch Express code: future backend changes require a restart. Browser evidence: `verification/site-experience/localhost-overview.png`.

- No trending/most-viewed ranking or standalone video section: the existing model has no article-view ranking or video article category. Existing video embeds remain supported in articles. These are not fabricated from recency or added as a second analytics engine.
- Supported global placements are deliberately limited to the implemented compatible locations; no generic canvas or unrestricted component injection.
- One scheduled snapshot per area; publication does not automatically revert a whole area at an end date. Announcements/blocks have start/end windows.
- Publication versions are counters with current snapshots, not a historical revision browser. Draft edits use the existing last-save behavior; publication checks concurrent draft/version changes.
- Live deployment/CDN behavior is not verified here. The local production build and real browser behavior are verified. In-app Browser connection failed during bootstrap, so browser verification used the repository's existing Playwright/installed-Chromium approach.

## 18. Follow-up scope

Analytics & Monetization Intelligence Dashboard and real GA4/AdSense reporting remain separate future work. Optional ranking-backed trending/video content, additional approved placements and historical revisions require a separate product decision; existing working systems are preserved.
