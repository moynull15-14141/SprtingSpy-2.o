# Phase F.1 — takeover audit

Audited 2026-09-28 before continuing implementation. The working tree contains the prior A–G work and an interrupted F.1 implementation; none of those changes are discarded.

| Area | Current architecture / finding |
| --- | --- |
| Runtime | Express plus Next App Router, PostgreSQL/Prisma. Old PROJECT_STATE.json and DEVELOPER_HANDOFF.md describe an obsolete Vite/JSON architecture. Current source and phase reports take precedence. |
| Homepage | Previous fixed article-query-driven page already converted to approved structured sections in HomePage.tsx. Sources use the existing public article eligibility and summary services. |
| Header/mobile | Existing responsive header already accepts shared navigation items with independent desktop/mobile visibility; sports submenu queries visible sports. Brand and account/theme controls remain system components. No secondary navigation or existing ticker model. |
| Footer | Already converted to structured columns, identity text, links, privacy preference action and social profiles. Existing branding provides defaults. Logo selection is not an existing media/logo feature. |
| Announcements | No prior breaking-news database. Structured windowed announcements reuse the new shared site document model. |
| Editorial/global blocks | Message, CTA and featured article blocks render in approved homepage, article, sport and footer placements. Ads still use existing AdSlot/consent/CSP infrastructure. |
| Existing layouts | No reusable persisted section/menu/layout model existed in Prisma. The prior agent added one SiteExperience table with a JSON document per area; keep it rather than introduce duplicate tables. |
| Admin | Article/media/SEO/settings/ad/audit editors exist. Sidebar and AdminApp reference Site Experience, but AdminSiteExperience.tsx is missing. fields.tsx and editors.tsx exist; section select has a TypeScript inference error. |
| Publication | SiteExperience service and protected router already provide draft/published/scheduled snapshots. Existing Admin/Editor sessions, CSRF and audit infrastructure are reused. Header/footer publication is Admin-only. Preview uses existing active sessions plus an HttpOnly preference cookie. |
| Scheduling/cache | Existing server timer invokes site publication. Root layout is force-dynamic; React cache deduplicates within one request only, so configuration is refreshed each request without a purge/restart. Scheduler concurrency and preview SEO headers need verification. |
| Database | Additive 20261002090000_site_experience migration is already applied locally; Prisma migration status reports up to date. No reset, drop or data replacement is needed. |
| Tests | test:site-experience is missing. TypeScript currently fails on missing admin component and section-select typing. Browser, production build, regressions and drift checks remain to run. |

Continuation design: complete the existing five-area architecture; add the missing overview and editor shell, save/error/unsaved-change handling, preview and publication controls; strengthen validation and scheduler behavior where concrete gaps exist; add isolated local verification with restoration; report exact evidence and limitations. No analytics dashboard or arbitrary page builder.
