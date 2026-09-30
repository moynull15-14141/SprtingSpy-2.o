# Phase I targeted audit and implementation matrix

Audited 2026-09-29 before implementation. SportingSpy uses role-based `requireRole` middleware, User-to-Author ownership, five existing publication statuses, one Articles repository/filter UI and one AuditLog. There is no persisted approval queue or request-changes mechanism. `/articles/:id/review` records freshness only; it must remain distinct from approval.

| Requirement | Current implementation | Gap | Planned change |
|---|---|---|---|
| Author byline | Linked Author.userId; create accepts arbitrary authorId; update spreads payload | Forged ownership/byline | Derive create byline from authenticated linked profile; reject foreign byline and unknown/nested writes |
| Author publishing | Every status accepted on owned article | Direct publish/schedule/archive | Server transition guard; Author private draft/preview only, separate submit action |
| Reviewer eligibility | Admin/Editor manage publishing through requireRole | No reviewer list/assignment | Central role policy reusing Admin/Editor eligibility; active minimal reviewer projection; self-review denied |
| Review lifecycle | No approval state; existing draft/preview are private | Missing assignment, reason, decisions | Add review metadata to Article; retain publication enum; reuse AuditLog for history |
| Request changes | Freshness timestamp only | No reason or resubmission | Assigned reviewer or Admin requests meaningful changes; Author sees reason and resubmits |
| Approval | No approval API | Self-approval/status injection possible | Dedicated decisions; author-submitted articles need approval before staff publishing; Authors never publish |
| Existing content | Legacy publication/status/bylines | Must preserve existing rows and staff publication | Default legacy/admin review state not_required; Author-origin requires review; existing public content remains unchanged |
| CMS scope | Staff get every article through CMS data/list/search | Other-author private data exposed | Author ownership enforced before pagination/count/search; public link picker uses public-only projection |
| Queue integration | Articles repository already filters five publication statuses; dashboard Pending Review is comment moderation | No actual article approval queue to reuse | Add review filters/tabs to same Articles repository; dashboard link to it; no second queue |
| Editor | Same editor for all staff; byline/status controls executable by Authors | UI contradicts permissions | Lock Author identity, hide publishing, reviewer/submit controls, request reason/history and staff decisions |
| Scheduler/SEO | H scheduler + published-only SSR/search/sitemap | Must retain behavior | Keep scheduler and public visibility architecture; run H and SEO/security regressions |
| Audit/security | Existing AuditLog, CSRF/session guards | Workflow writes not audited atomically | Transactional workflow audit with actor/time/reason and concurrency checks |
| Tests/data | Existing A–H suites; no I suite | Missing forged API and browser coverage | Disposable I fixtures, real role browser flows, snapshots/cleanup; additive migration only |

Publication status remains `draft`, `preview`, `scheduled`, `published`, `archived`. New reviewStatus distinguishes `not_required`, `draft`, `in_review`, `changes_requested`, `approved`; all review work remains private until existing publication controls publish it. Admin-created articles need no approval. Admin/Editor can manage bylines as before. Admin can handle any pending review; Editor handles assigned reviews. Freshness review is not approval.
