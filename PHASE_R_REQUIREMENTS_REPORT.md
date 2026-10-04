# SportingSpy — Phase R requirement reconciliation report

Date: 4 October 2026 · Scope: current working tree and the local development database · **Not certified launch-ready** (see §14–15).

## 1. Executive summary

Phase R brings the repository in line with the final product decisions: database-backed Article Types with both **How to Watch** and **Sports Viewing Guide**, a contextual, editor-approved **FAQ & Reader Questions** system, **URL stability** for sport/event renames, bounded queries and a **public data cache**, **real-user monitoring**, **search analytics**, **password reset** and **TOTP**, structured **audit before/after** values, a **migration sheet**, **media duplicate detection**, and Search Console/Bing **import adapters**.

Requirement count (method in §2): of the 34 requirement areas, **24 COMPLETE, 5 PARTIAL, 1 CONFLICT, 4 OPS/OWNER CONFIGURATION**. COMPLETE means implemented in code *and* exercised by an automated test or direct check on a local production-mode server; it is never a claim about a live deployment.

What still stands between this code and launch is mostly outside the repository: production hosting, database backups, CDN, a Google-certified CMP enabled in the owner's AdSense account, Search Console/Bing credentials, a reset-email provider, and the old-site URL inventory. Inside the code, the open items are browser verification of the ad-collapse and RUM reporter, the remaining free-text audit entries, and content/media import for migration.

## 2. Requirement reconciliation

**Sources.** v1.1 Blueprint and v2.0 Final were supplied in the conversation (v2.0 truncated at §28). v2.2 Consolidated Final and the 4 October audit document were **not** supplied as files; v2.2 requirements were taken from the explicit final decisions in the Phase R instructions. Where v1.1 and v2.0 differ, the instruction's decision was applied (§3).

**Counting method.** One row per numbered area of the Phase R instructions (P1–P34). Status is the area's overall state; the "Gap" column lists what keeps a row from COMPLETE.

| # | Requirement | Source | Current state (evidence) | Status | Gap / risk |
| --- | --- | --- | --- | --- | --- |
| P1 | Requirement matrix | instructions | This report | COMPLETE | Recheck against v2.2 file when supplied |
| P2 | Sport → Event → Edition → Article; Sport fields | v1.1 §4, v2.0 §2, §6.1 | Optional Event/Edition; Sport image (Media Library), SEO/social (merged, never wiped), featured events (validated, ordered), FAQ schema switch; `verify-phase-r` group 0 | COMPLETE | — |
| P3 | Permanent Event; lifecycle | v2.0 §7.1–7.2 | All fields + alternative names. Lifecycle stored on **Edition** (upcoming/active/completed/archived) | CONFLICT | v2.0 §7.2 names the lifecycle under Event. Client to confirm the Edition-level model (§3) |
| P4 | Event Edition fields, 80–150 words | v2.0 §8.2–8.5 | All fields; sport-specific fields (E2); live word counter with warning | COMPLETE | Word count is a warning, not a block (by design) |
| P5 | Edition page structure | v2.0 §8.4, §8.6 | Breadcrumbs, H1, Quick Facts (only present facts, no ads inside), description, official source, **Latest** + **Related** (from relationships), FAQ; "Verified" labels removed | COMPLETE | — |
| P6 | Article system, editor, workflow | v2.0 §9 | TipTap editor, statuses, review workflow, RBAC (phase I suite) | COMPLETE | — |
| P7 | Type-aware SEO for both viewing types | instructions | Both types get broadcaster/streaming/region/timezone, event/edition, official source and freshness checks; custom types inherit via SEO profile | COMPLETE | — |
| P8 | Authors | v2.0 §10 | Author model/pages, linked bylines, permission boundaries (phase I) | COMPLETE | — |
| P9 | URL stability, collisions | v2.0 §13.2–13.3 | Sport/event slug or sport change → direct 301 for every descendant URL (by row id), event-level articles carried, chains flattened, no loops; collision rules; reserved sport slugs | COMPLETE | Edition year cannot be edited (by design), so no edition moves exist |
| P10 | Public page structure | v2.0 §6.2, §7, §9.7 | Sport hub (featured, upcoming, latest, all events, guides, explore, FAQ), Event (latest/related), Article (sources, FAQ, related, latest, author) | COMPLETE | — |
| P11 | Related content priority | v1.1 §12 | Edition → event → full-text similarity (ts_rank) → sport; bounded queries; no 24-article window | COMPLETE | — |
| P12 | Query limits | v2.0 §23.4 | All public lists bounded with totals; audit log paged | COMPLETE | CMS dataset `/api/cms/data` still loads all articles/media for staff (admin-only; see §15) |
| P13 | Caching | v2.0 §23.3, §26.2 | Process data cache (TTL 60 s), invalidated by every CMS write and scheduler publish; HTML stays per-request (CSP nonce, consent, preview); previews bypass the cache | COMPLETE | Per-instance cache: other instances refresh within the TTL |
| P14 | Real-user monitoring | v2.0 §25.6–25.8 | LCP/INP/CLS + page views aggregated by page type/device; p75 from histograms; regression detection; Insights view | PARTIAL | Endpoint and aggregation tested; the browser reporter was not exercised in real Chrome; regressions are shown in the dashboard, not pushed as alerts |
| P15 | Media Library | v2.0 §18 | Processing/variants, rights metadata, v2.0 creation-type labels, duplicate detection (hash), unused review, Sport/Event/Edition images linked to library items | COMPLETE | CDN = owner/ops |
| P16 | Search | v2.0 §19 | Articles + Events (+ Edition matches, Sports reference list), alternative names, typo tolerance, filters (DB types), autocomplete, noindex | COMPLETE | Sports/Editions are not separate paginated result types (Edition matches surface their Event) |
| P17 | Search analytics | v2.0 §19.5 | Daily aggregates (popular, no-result, trend), no personal data; feeds Insights and the SEO scan | COMPLETE | — |
| P18 | SEO Intelligence | v2.0 §17 | 38 actionable rules (no score), DB-tunable, new URL-collision and no-result rules | COMPLETE | Search Console data → P24 |
| P19 | AI assistance | v2.0 §17.6 | Suggestions only; FAQ suggestions saved as drafts; prompt forbids invented facts | COMPLETE | Not tested against a live Gemini key |
| P20 | Technical SEO | v2.0 §20–21 | Sitemap index, robots (adds `/reset-password/`), canonicals, real 404, redirect manager, IndexNow | COMPLETE | — |
| P21 | Structured data | v2.0 §17.8 | Article/NewsArticle/BlogPosting per Article Type; FAQPage opt-in, only for valid visible entries | COMPLETE | — |
| P22 | Advertising | v2.0 §22 | Slots, reserved space, house ads; **unfilled AdSense slots collapse**; Auto ads switch | PARTIAL | Collapse/Auto ads need a live AdSense account to verify in a browser |
| P23 | Consent / CMP | v2.0 §22.7 | `consentMode=google-cmp` relies on Google's certified CMP (AdSense Privacy & messaging) for ads; built-in banner covers analytics | OPS/OWNER CONFIGURATION | Owner enables the GDPR/UK/CH message in AdSense; certification belongs to the CMP |
| P24 | Search Console / Bing data | v2.0 §25.3–25.4 | Service-account (Google) and API-key (Bing) import into daily tables; Insights shows them; "not connected" otherwise | OPS/OWNER CONFIGURATION | Credentials absent; the import code has **not** been run against the real APIs or a mock |
| P25 | Analytics & Insights | v2.0 §25 | Periods today/7d/28d/3m/6m/12m/custom; separate from ad management; no invented data | COMPLETE | — |
| P26 | Security | v2.0 §24.1 | Password reset (self-service + Admin link, single use, sessions revoked), TOTP (encrypted, replay-safe), existing hardening | COMPLETE | Reset e-mail needs a provider (owner) |
| P27 | Audit logs before/after | v2.0 §24.3 | Structured diffs for articles, sports, events, editions, settings, SEO rules, Article Types, FAQ, migration; secrets redacted; shown in CMS | PARTIAL | Users, authors, ads, comments, media metadata and redirect routes still write free-text only |
| P28 | Backups & recovery | v2.0 §24.5–24.6 | Local restore drill + documented procedure | OPS/OWNER CONFIGURATION | Production backups, off-site copies and restore tests are provider tasks |
| P29 | Migration | v2.0 §27 | Migration sheet (spec columns), CSV import/export, validation (live target, chains, loops, homepage dumping), dry run, 301 apply, RETIRE = 404 | PARTIAL | Old-site inventory is owner input; old content and media import is manual through the CMS |
| P30 | Dev → staging → production | v2.0 §24.4 | `APP_ENV=staging` noindex, startup guards, documented rollback | OPS/OWNER CONFIGURATION | Staging/production environments must be provisioned |
| P31 | Testing | instructions | §12–13 | COMPLETE | Local only |
| P32 | Test article cases | instructions | `How to Watch` at `/…/2028/how-to-watch/` and `Sports Viewing Guide` at `/…/2028/sports-viewing-guide/` created, published, canonical, breadcrumbs, JSON-LD, SEO checks, search, related, latest | COMPLETE | CMS preview of these two not separately exercised |
| P33 | Housekeeping | instructions | `package.json` renamed, `PROJECT_STATE.json` rewritten, legacy importer no longer merges the two viewing types | PARTIAL | `typescript.ignoreBuildErrors` kept (build runs `tsc` first); historical phase reports kept as history |
| P34 | Handover documentation | v2.0 §26.4 | `ARCHITECTURE.md`, `DEPLOYMENT.md` (Phase R integrations), `DATABASE_OPERATIONS.md`, `EDITOR_AND_API_GUIDE.md`, this report | COMPLETE | — |

## 3. Final decisions applied

- **How to Watch / Sports Viewing Guide:** two separate, active, seeded system types (same "viewing" SEO profile, own identity). Existing How to Watch content and URLs are unchanged. The list is editable in Admin → Article Types; a used type can be deactivated but never renamed or deleted (enforced by a foreign key).
- **FAQ:** contextual (article, edition, event, sport guide). Only editor-published entries are public; suggestions (data or AI) are saved as drafts. FAQPage markup is opt-in per page and includes only valid visible entries. The E5 automatic Event FAQ was **removed from public pages** and turned into suggestions. The site-wide `/faq/` page exists but is **off by default** (404, not in menus or the sitemap). Editors may now delete FAQ entries (v2.2 editor actions; previously Admin-only).
- **Event lifecycle (conflict):** kept on the Edition, because an Event is permanent and each yearly Edition has its own state. An Event-level status field was not added; the client should confirm.
- **URL stability:** every URL change gets one direct 301. A collision is resolved deterministically: the Event owns `/{sport}/{slug}/`.
- **Caching:** published data is cached per server process and invalidated on every write; HTML is not shared because it carries a per-request CSP nonce and the visitor's consent state.

## 4. Implemented changes (main files)

Server: `server/articleTypes.ts`, `audit.ts`, `publicCache.ts`, `urlStability.ts`, `faq.ts`, `faqQuality.ts`, `passwordReset.ts`, `totp.ts`, `rum.ts`, `insights.ts`, `searchAnalytics.ts`, `searchConsole.ts`, `migration.ts`; changes in `server.ts` (types, collisions, slug moves, audits, cache, routers, scheduler), `media/*` (duplicates, labels), `seo/*` (rules, profiles, context), `settings*`, `trackingConfig.ts`, `services/public/*` (bounded loaders, Latest/Related, FAQ).
Public: `ContextFaq`, `RumPageType`, `WebVitalsReporter`, `AdsensePageTag`; Sport/Event/Edition/Article views; `/reset-password/`; header 2FA prompt.
CMS: Article Types, Analytics & Insights, Site Migration screens; reworked FAQ, Sports, Events, Articles, Settings (choice fields), Users (reset link, reset 2FA), Account (2FA), Audit Logs (before/after).

## 5. Database changes

Migration `20261010090000_phase_r_requirements_reconciliation` (additive): `ArticleType` (+ FK from `Article.articleType`), FAQ context columns + single-context CHECK + approval fields, `faqSchemaEnabled` on Sport/Event/Edition/Article, `SportEvent.alternativeNames` (in the search vector), media relations for entity images, `MediaItem.contentHash`, `AuditLog.before/after`, `User.totpSecret/totpEnabledAt`, `PasswordResetToken`, `SearchQueryStat`, `WebVitalStat`, `PageViewStat`, `SearchPerformanceStat`, `SearchEngineSnapshot`, `MigrationItem`. Data steps: seed both viewing types (keep any other used type), link existing entity images to library items, relabel media creation types (same meaning), copy How-to-Watch SEO rule settings to Sports Viewing Guide. Applied locally; `prisma migrate diff` shows no drift.

## 6. Migration changes

Migration sheet API + CMS screen (§2 P29). Automatic 301s now also cover sport/event renames.

## 7. SEO changes

Viewing checks for both types; profile inheritance for custom types; URL-collision and no-result-search rules; structured-data type per Article Type; opt-in, validated FAQPage; Latest/Related on Edition/Event/Article; Sport hub sections; `/reset-password/` disallowed in robots.

## 8. Performance changes

Bounded queries everywhere on public pages; relevance-ranked related content; process data cache with write invalidation; real-user monitoring with p75 and regression detection.

## 9. Security changes

Password reset, TOTP 2FA (encrypted secret, replay protection, Admin reset), TOTP secret stripped from all API output, structured audits, duplicate-safe media upload.

## 10. Analytics / monitoring

First-party aggregate page views and Core Web Vitals; internal search analytics; Search Console/Bing import adapters; Insights screen with all required periods. No external alert channel.

## 11. Advertising / consent

Unfilled AdSense slots collapse (label and reserved space); Auto ads switch; `google-cmp` consent mode (owner enables Google's certified CMP in AdSense). Claims of CMP certification are not made by the site.

## 12. Testing performed

Local production-mode server (`NODE_ENV=production`) against the local development database; every suite creates disposable fixtures and verifies pre-existing rows afterwards. TypeScript (`tsc --noEmit`), `npm run build`, `prisma validate`, migration status/diff.

## 13. Test results

Final run on 4 October 2026, on the finished code, one suite after another:

| Check | Result |
| --- | --- |
| `tsc --noEmit` · `npm run build` | Pass · Pass |
| `prisma validate` · `migrate status` · `migrate diff` (DB vs schema) | Valid · up to date (18 migrations) · no drift |
| `test:phase-r` (new) | **15 groups passed, 0 failed** |
| `test:phase-a` | 13 groups passed |
| `test:phase-b` | 10 groups passed |
| `test:phase-c` | 14 groups passed |
| `test:phase-d` | 9 groups passed |
| `test:phase-e` | 12 groups passed |
| `test:phase-e5` | 7 groups passed (real Chrome) |
| `test:phase-m` | 7 groups passed (real Chrome) |
| `test:phase-h` | 12 passed, 0 failed (real Chrome) |
| `test:phase-i` | 9 groups passed (real Chrome) |
| `test:phase4` | 20 groups passed |

Every suite verified afterwards that pre-existing database rows were unchanged.

**Regressions found and fixed during this run:** a cache race when the scheduler publishes (invalidation moved to the moment of publication); an unknown `/latest/?type=` filter returning 200 instead of 404; the strict search API accepting unknown types; media duplicate detection running before format validation; article "Latest" falling back to other sports; the FAQ screen not showing a load error with Retry; FAQPage markup dropped for a whole page because of one invalid entry (now only invalid entries are left out).

**Old tests changed because the requirement changed (not to hide failures):** Phase B no longer expects automatic FAQPage on Event pages; Phase H enables the site-wide `/faq/` page for its FAQ checks and expects Editors to be allowed to delete FAQ entries; Phase A/E5 (updated earlier by the previous agent) expect both viewing types and editor-approved FAQ.

**Not tested:** the RUM reporter and AdSense collapse in a real browser with a live AdSense account; the Search Console/Bing import against the real APIs; AI suggestions with a live Gemini key; anything on a deployed server.

## 14. Remaining gaps

**MUST HAVE (code):** browser verification of the RUM reporter and of AdSense unfilled collapse; structured audit diffs for the remaining routes (users, authors, ads, comments, media metadata, redirects); confirm the Event-lifecycle decision.
**SHOULD HAVE:** alert delivery (e-mail/Slack) for outages, regressions, 404 spikes and backup failures; a mock-API test for the Search Console/Bing import; shared cache invalidation if more than one app instance runs; page-level pagination UI on author pages; bounded CMS dataset.
**FUTURE:** dedicated search engine; distributed cache; passkeys.
**OWNER/OPS:** domain, DNS, TLS, hosting, production PostgreSQL with backups/PITR and off-site copies, restore drill, S3/CDN media, GA4/AdSense IDs, Google-certified CMP message in AdSense, Search Console service account and Bing API key, `RESEND_API_KEY`/`MAIL_FROM`, `TOTP_ENCRYPTION_KEY`, staging environment, legal text approval (About page's "manually verified" process claim included), old-site URL inventory and content.
**CLIENT DECISION:** Event-level lifecycle (P3); whether the site-wide `/faq/` page should ever be enabled; whether real-user monitoring may run without consent in your jurisdictions (it stores no identifiers).

## 15. Known risks

- Per-process cache: with several instances, a change can take up to the TTL (60 s) to appear on the other instances.
- `/api/cms/data` loads all articles and media for staff; it will slow the CMS (not public pages) at tens of thousands of articles.
- The Search Console/Bing import is untested against the real APIs.
- `server.ts` remains a large integration file (deliberately not split this phase).
- Test suites share the local database and must run one at a time.

## 16. Recommended next phase

1. Owner/ops provisioning: staging + production, backups, CDN, CMP, Search Console/Bing, reset e-mail, `TOTP_ENCRYPTION_KEY`.
2. Run all suites on staging, then a real-device performance pass (LCP/INP/CLS) using the RUM data.
3. Close the code gaps in §14 (audit diffs, alert channel, CMS dataset paging, mock import test).
4. Migration: import the real old-site inventory, decide every row, dry run, apply on staging, then launch.
