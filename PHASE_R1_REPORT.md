# PHASE R.1 FINAL REPORT — Phase R closure

Date: 4 October 2026 · Scope: current working tree, local development database, local production-mode server, real Chrome · Phase R is not redone; this phase closes its open MUST-HAVE items only.

## 1. Status

**BLOCKED BY CLIENT DECISION** on one item (Event lifecycle, §2), with owner/ops items unchanged from Phase R. Every confirmed MUST-HAVE *code* gap is closed and verified. One regression suite (Phase I) is intermittent **in this environment only**, because a second app instance shares the local database (§6, §7.4); rerun it with no other instance running before signing off.

## 2. Requirement matrix

| Area | Requirement | Evidence | Status | Action |
| --- | --- | --- | --- | --- |
| RUM | Browser reporter runs and reports | `src/components/analytics/WebVitalsReporter.tsx`, `server/rum.ts`; `verify-phase-r1` group 2 in real Chrome (mobile emulation): page-type marker, page-view beacons, LCP, CLS and INP aggregated in `WebVitalStat`/`PageViewStat`, p75 shown by `/api/insights/overview`; setting `realUserMonitoring=disabled` → zero requests | PASS | **Bug fixed** (§7.1) |
| RUM | Consent behaviour | Reporter sends no cookies or identifiers; it runs without a consent choice by design. Disabling in Settings stops it | PASS (design) | Legal review stays a client decision (§8) |
| RUM | INP | Reported in this Chrome run after a click + key press; INP depends on real interaction and browser support | PASS (browser-dependent) | — |
| AdSense | Filled slot keeps reserved space | Group 3 case A (mock script, real Chrome): slot visible, ≥ 90 px | PASS (mock) | — |
| AdSense | Unfilled slot collapses | Case B: `data-ad-status="unfilled"` → whole slot `hidden`, `data-ad-collapsed="unfilled"` | PASS (mock) | **Bug fixed** (§7.2) |
| AdSense | House ad | Case C: house creative/banner visible | PASS | — |
| AdSense | No consent | Case D: no AdSense slot, no request to Google; house ad still shown | PASS | — |
| AdSense | Auto ads off / on | Case E: no tag on pages without slots; case F: tag loaded once with the configured client | PASS (mock) | — |
| AdSense | google-cmp mode | Case F2: tag loads without the banner's ad choice so the certified CMP can ask | PASS (mock) | CMP itself = owner/ops |
| AdSense | Live AdSense | Needs a real publisher account and approved site | NOT VERIFIED | Owner/ops |
| Audit | Users | Create, role, update, status, delete, self-service profile → structured `before`/`after` (name, email, role, status, avatar); passwords/hashes never recorded | PASS | Implemented |
| Audit | Authors | Create, update | PASS | Implemented |
| Audit | Ads | Slot configuration; ad media upload/delete | PASS | Implemented |
| Audit | Comments | Submit, moderate, delete (verified with `ENABLE_COMMENTS=true`; feature stays off in production) | PASS | Implemented |
| Audit | Media | Upload, register by URL, metadata update, delete | PASS | Implemented |
| Audit | Redirects | Create, update, delete, bulk import (source/target lists) | PASS | Implemented |
| Audit | Event/Edition delete | Previously text-only | PASS | Implemented |
| Lifecycle | Event vs Edition status | See below | CONFLICT — **CLIENT DECISION REQUIRED** | No code change |

Remaining text-only audit entries, deliberately kept: login/logout, password change and reset, 2FA events (their values are secret or meaningless as diffs), article review submission/decision (text records the reviewer and reason), contact-inbox triage, Site Experience publish events (whole documents), scheduler events.

**Event lifecycle, exact conflict.**
- Spec v2.0 §7.1: "An Event is permanent. It is not a yearly page." §7.2 "Event Lifecycle: Upcoming → Active → Completed → Historical / Archived. Historical content must remain accessible."
- Spec v2.0 §8.2 (Event Edition): "Edition status: Upcoming / Active / Completed / Archived."
- Blueprint v1.1 §4.2 (Event) lists no status; §4.3 (Event Edition) lists "Status: Upcoming / Active / Completed / Archived".

v1.1 places the lifecycle on the Edition only. v2.0 describes it under both headings, without saying whether §7.2 means a stored Event field or the cycle each Event goes through edition by edition. The documents do not settle it, so per the stop conditions **the current model is left intact** (status stored on Edition; the Event is permanent) and no duplicate field was added. Options for the client:
1. **Keep as is (current):** status per Edition; an Event page shows its editions' states.
2. **Derived Event lifecycle (no new stored field):** the Event shows Upcoming/Active/Completed/Historical computed from its current Edition.
3. **Stored Event status:** only if the client needs to mark a whole competition as discontinued/archived independently of editions.

## 3. Changes implemented

- `server.ts` — 13 audit points converted to `recordAudit` with field lists `USER_AUDIT_FIELDS`, `AUTHOR_AUDIT_FIELDS`, `COMMENT_AUDIT_FIELDS`, `AD_AUDIT_FIELDS` (+ existing event/edition lists).
- `server/account.ts` — self-service profile audit with before/after.
- `server/media/routes.ts`, `server/adCreatives.ts`, `server/redirects.ts` — structured audits (entity types unchanged for compatibility).
- `src/components/analytics/WebVitalsReporter.tsx` — metrics reported while the page is hidden are sent immediately (§7.1).
- `src/components/ui/AdsenseUnit.tsx` — unfilled detection hides the slot directly (§7.2).
- `server/publicCache.ts` + `server.ts` scheduler — content-write window: the public data cache is bypassed while a write (API write, scheduled article publication, due Site Experience schedule) is in progress and cleared when it ends (§7.4).
- `server/scripts/verify-phase-r1.ts` + `npm run test:phase-r1` (new).

## 4. Database changes

None. The `AuditLog.before/after` columns from Phase R are reused, so no migration was needed and no pre-migration backup was required. Existing audit rows stay as they are (older entries remain free text). Prisma validate, migration status and migration diff are clean (§6).

## 5. Browser tests

| Category | Items |
| --- | --- |
| Real Chrome verified | RUM reporter end to end (beacons → database → Insights), RUM off switch, house ad, no-consent state, AdSense tag loading rules (Auto ads off/on, google-cmp) |
| Mock/browser verified | AdSense filled vs unfilled behaviour (Google's script replaced by a deterministic stub through Playwright request interception in the test browser only; production code unchanged) |
| Not possible locally | Real ad fill rates, AdSense policy review, real CMP consent dialog |
| Requires live provider | AdSense account + approved site; Google-certified CMP message in AdSense |

## 6. Test results

Final run on the finished code (4 October 2026), suites one after another, local production-mode server, real Chrome:

| Check | Result |
| --- | --- |
| `tsc --noEmit` · `npm run build` | Pass · Pass |
| `prisma validate` · `migrate status` · `migrate diff` | Valid · up to date · empty (DB = schema) |
| `test:phase-r1` (new) | **4 groups passed, 0 failed** |
| `test:phase-r` | 15 passed |
| `test:phase-a` / `-b` / `-c` / `-d` / `-e` | 13 / 10 / 14 / 9 / 12 passed |
| `test:phase-e5` / `-m` | 7 / 7 passed (real Chrome) |
| `test:phase-h` | 12 passed, 0 failed (real Chrome) |
| `test:phase4` | 20 passed |
| `test:phase-i` | **Intermittent:** failed in this run (6 of 9 groups passed, then 404 instead of 200 after the scheduled release). Passed 2/2 with `PUBLIC_CACHE_TTL_SECONDS=0`, and 1 of 3 with the cache on, while a second app instance (`npm run dev`, PID 1184) shared the database. Cause and evidence in §7.4 |

Every suite verified afterwards that pre-existing database rows were unchanged.

## 7. Bugs found and fixed

1. **RUM metrics lost when a page is hidden.** Symptom: in real Chrome, page views arrived but LCP/CLS beacons were missing. Root cause: web-vitals reports final LCP/CLS/INP from its own page-hide handler, which can run after the reporter's flush, so the flush found nothing and the later values were never sent. Fix: a metric that arrives while the page is hidden is sent at once. Regression test: `verify-phase-r1` group 2 (hides the page via `visibilitychange`, then asserts database aggregates).
2. **Unfilled AdSense slot never collapsed.** Symptom: `data-ad-status="unfilled"` left the empty reserved box. Root cause: the component removed its `<ins>` first and then searched for the slot through that removed element. Fix: hide the slot inside the detection callback while the element still exists. Regression test: group 3 case B.
3. **Test-only:** Playwright `waitForFunction` does not run under the site's production CSP; the suite polls with `page.evaluate` instead. No production change.
4. **Phase I flaky (404 right after a scheduled article is released).** Symptom: about every second Phase I run got 404 instead of 200 for an article the scheduler had just published. Root cause: a **second app instance** — the `npm run dev` server started at 12:08 (PIDs 16412/1184) — runs against the same local database with its own scheduler. When that instance publishes the article, the test server's per-process cache is never told and serves its cached "not found" until the TTL expires. Evidence: with `PUBLIC_CACHE_TTL_SECONDS=0` Phase I passed 2/2; with the cache on it failed 2 of 3 while the dev server ran. This is the documented multi-instance limitation (Phase R §15; shared invalidation is SHOULD-HAVE), not a single-instance defect. While investigating, a separate theoretical single-instance window (a read during a write caching pre-commit data) was closed with the content-write window; regression test: `verify-phase-r1` group "Public cache". The dev server was **not** stopped (it is the owner's process).

## 8. Remaining gaps

### MUST-HAVE
- None in code. The Event-lifecycle item is a client decision (below).

### SHOULD-HAVE
- Shared cache invalidation across instances (e.g. a database content version or Postgres LISTEN/NOTIFY) — needed before running more than one app instance against one database; today another instance's changes appear within the TTL (60 s).
- Alert delivery for outages/regressions/backup failures; mock-API test of the Search Console/Bing import; shared cache invalidation for multiple instances; CMS dataset and author-page pagination.

### OWNER/OPS
- Live AdSense account and approved site; Google-certified CMP message in AdSense; production hosting, backups/PITR/off-site copies, CDN, Search Console/Bing credentials, reset e-mail provider, `TOTP_ENCRYPTION_KEY`, staging; old-site URL inventory.

### CLIENT DECISION
- Event lifecycle model (options 1–3 above).
- Whether first-party RUM may run without a consent choice in the client's jurisdictions (no identifiers are stored).

### FUTURE
- Distributed cache, dedicated search engine, passkeys.

**Operational note:** stop other app instances (such as a running `npm run dev`) before running the test suites; they share the local database and their schedulers interfere.

## 9. Launch impact

Phase R.1 closes Phase R's code gaps. **Proceeding to Phase N (Migration & Legacy URL Closure) is technically possible now**: the migration tooling, redirect manager and URL stability it depends on are verified. Two things should happen first or in parallel: (1) the client answers the Event-lifecycle question, because a change there would alter Event pages and status logic that Phase N content decisions refer to (none of the options changes URLs); (2) the owner supplies the old-site URL inventory, without which Phase N cannot start. Launch readiness of the whole project is **not** claimed.
