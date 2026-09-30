# Phase I — Author and editorial workflow hardening

**Status: COMPLETE for the repository implementation.** Verified 2026-09-30 against the local development database and a production build. This phase did not deploy the site or alter a production database.

## Requirement matrix

| Requirement | Implementation | Verification |
|---|---|---|
| Author identity and scope | The server derives the byline from the authenticated account's linked Author profile. Author article lists, CMS data, private search, preview, edits and deletion checks are ownership-scoped. Nested/unknown article fields and forged bylines are rejected. Admin/Editor byline controls remain available. | Phase I direct API forgery and cross-author tests; Phase4 RBAC; Phase C preview. |
| Author publishing boundary | Author writes stay draft/preview. Direct publish, schedule, archive, workflow-state fields and timestamps are rejected. Submitted/live articles are read-only for Authors. Approval does not grant publishing permission. | Phase I API and browser tests, including attempted changes after approval. |
| Reviewer selection | Active Admin/Editor accounts are selected dynamically from the existing RBAC roles. Authors must choose an eligible reviewer; inactive, Author, missing and self assignments fail. The UI explains when the list is empty. | Phase I API eligibility checks and browser empty-state check. |
| Review and request changes | The Author submits a private draft. Assigned Editor or Admin can request changes with a 5–5000-character reason or approve. The Author sees the reason/history, edits, and resubmits. Admin may handle a review when the assignee is unavailable. Self-review is blocked. | Phase I complete API and real Author, Editor and Admin browser cycles; stale-version checks. |
| Publication and scheduling | Admin-created articles retain direct publication/scheduling. Only staff can publish/schedule an Author submission after approval. Existing scheduler and published-only public rendering remain in place. | Phase I direct API/browser publishing and actual scheduler tick; Phase H regression. |
| Queue, audit and SEO | Added review filters to the existing Articles repository and a dashboard entry, with no second queue. Reused AuditLog for submission, decisions and approval invalidation. Private review data is absent from public article projections; draft/review URLs stay private. Existing freshness review remains separate from editorial approval. | Browser clicked all five queue buttons and checked the returned API rows and rendered table across review transitions; audit, canonical/JSON-LD/sitemap/search checks; Phase B/C/H. |

## Changes

- Backend: `server/editorialWorkflow.ts` centralizes payload and role guards and adds reviewer, workflow, submit and decision routes. `server.ts` applies the guards to existing article create/update paths, preserves staff publishing controls, and checks the new columns at startup. CMS search and media-usage projections enforce Author ownership. Review actions use serializable transactions, optimistic `reviewVersion` checks and the existing AuditLog.
- Frontend: `AdminArticles.tsx` locks Author bylines and publishing controls, exposes the existing Articles repository's Drafts / Needs Review / Changes Requested / Approved filters, and shows the review panel. Authors see the label **My Drafts** for their ownership-scoped view; Admin/Editor see **Drafts** for all private draft/preview articles. `ArticleReviewPanel.tsx` displays reviewer selection, state, reason and history. Dashboard links to pending reviews. Public-only article pickers still find published stories across authors.
- Database: one additive migration, `20261005090000_phase_i_editorial_workflow`, adds `ArticleReviewStatus`, reviewer foreign key, review reason/timestamps/version and an index. Existing publication status and article content columns are unchanged. Existing rows default to `not_required`; newly Author-created articles start in review `draft`.
- Tests: `server/scripts/verify-phase-i.ts` uses disposable accounts/articles, a real production command and Chrome. It tests All articles, My Drafts, Needs Review, Changes Requested and Approved by clicking each button, checking the filtered API result and rendered rows. It compares hashes of all 21 pre-existing model tables before and after cleanup.

## Verification

| Check | Result |
|---|---|
| Phase I direct API, all five queue buttons, browser, scheduler, audit and original-row integrity | 9 groups passed, 0 failed |
| Phase A browser regression | 15 groups passed |
| Phase B browser/SSR regression | 11 groups passed |
| Phase C editor/media/browser regression | 18 groups passed |
| Phase4 account/RBAC/browser regression | 24 groups passed |
| Earlier full relevant suite after Phase I changes | D 9, E 12, F 11, G 6, H 12, J 5, Site Experience 38 groups passed; A/B/C/Phase4 were repeated above with browser enabled |
| TypeScript and production build | Passed |
| Prisma validate, migration status, schema drift | Valid; 13 migrations applied; no difference |
| Git whitespace check | Passed |

The Phase I test covers forged author/status/reviewer fields, missing or inactive reviewer, foreign article access, assigned Editor and Admin decisions, required request-change reason, resubmission, stale decisions, approval invalidation after Author editing, public/private visibility, canonical/structured data/sitemap/search, direct Admin publication, browser scheduling and the real scheduler tick. Chrome checks the Author/Editor/Admin flows, locked controls, mobile width and browser errors. It restores its exact original database snapshot.

The Articles buttons are filters. **My Drafts** for an Author shows their linked profile's private draft/preview articles. **Drafts** for Admin/Editor shows private draft/preview articles across bylines. **Needs Review**, **Changes Requested** and **Approved** match their respective review states; **All articles** clears the queue filter. Other search fields can further narrow those results. An approved article remains in **Approved** after publication because its review state remains approved.

The earlier staff **My Drafts** implementation incorrectly filtered by the logged-in account's linked byline. This made the existing French Open draft disappear for Admin even though **All articles** showed it. After the correction, a direct local data check returned both the French Open draft and Wimbledon preview in staff **Drafts**; role-specific API and browser tests passed. Neither existing article was changed.

## Limits and follow-up

- Historical articles receive `not_required` because their original creator/review history cannot be reconstructed safely from the old schema. Any historical Author-owned draft is brought under the review rule when an Author edits it. Existing public content and staff publishing remain intact.
- The in-process scheduler and existing Auth/RBAC model remain unchanged. A manual editorial walkthrough with real staff accounts after deployment is still useful, especially if role assignments or Author-profile links are changed then.
- This phase performed no database reset, destructive migration, production data deletion, or deployment work. The additive migration was applied only to the verified local `localhost:5432/sportingspy` target. No GitHub push is part of this phase completion.
