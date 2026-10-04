# SportingSpy editor and API guide

Last updated 4 October 2026 (Phase R). This guide is for editors and for the developer who takes over. The CMS is at `/admin/`.

## Roles

| Role | Can do |
| --- | --- |
| Admin | Everything, including users, settings, Article Types, redirects, migration apply, deletions of sports/events/editions |
| Editor | Write, review and publish articles; sports are Admin-only; events, editions, FAQ, migration sheet editing, insights |
| Author | Write own drafts and submit them for review; cannot publish, schedule or approve |

## Everyday editorial tasks

**Publish an article.** Articles → New. Choose Sport, then (if it is about one) Event and Edition, then the Article Type. Write the body, choose a featured image from the Media Library, run **Check SEO**, preview, then publish or schedule. Changing the slug, sport, event or edition of a published article creates a 301 from the old URL automatically.

**Article Types.** Article Types (left menu) lists every type. "How to Watch" and "Sports Viewing Guide" are both normal types. Admins can add a type, choose its SEO profile (which type-aware checks it gets — e.g. *viewing* checks broadcasters, official streams, regions and viewing times) and its structured-data type (Article, NewsArticle, BlogPosting). A type that articles use can be deactivated but not renamed or deleted.

**Sports, events and editions.** Sports: image/logo (from the Media Library), SEO and social fields, featured events (ordered), FAQ structured-data switch. Changing a sport or event slug moves every page under it; old URLs redirect (301) to the new ones and the CMS reports how many moved. Events have *Alternative names* (one per line) that search understands. Write the edition's short description in 80–150 words.

**FAQ & Reader Questions.** FAQ → choose the page (article, edition, event or sport). Add, edit, reorder, publish, archive or delete questions. Only published questions appear on that page. *Suggest from stored facts* and *Suggest with AI* propose questions; accepting one saves a **draft** that you must check against the official source before publishing. Quality checks flag duplicates, repetitive or outdated questions, contradictions with the page, irrelevant questions, answers without a source, and missing useful questions. FAQPage structured data is off until you tick it on the article/edition/event/sport, and it is only output when the published questions pass validation. The site-wide `/faq/` page is off unless Settings → FAQ enables it.

**Media Library.** Upload JPEG/PNG/WebP/AVIF; the system creates responsive WebP/AVIF sizes. Record title, alt text, caption, creation type (SportingSpy Original / AI-Created / AI-Assisted/Edited, Licensed, Official Source, Creative Commons, Other), credit, source, licence, AI tool, human editing and the copyright review. Uploading a byte-identical copy of an existing image is flagged; you can use the existing item or confirm a copy. Images in use cannot be deleted.

**Redirects and site migration.** URL Redirects manages 301/302 rules (chains are flattened, loops refused). Site Migration holds the old-site sheet (Old URL, Old Category, Old Title, Decision, New Category, New Title, New URL, 301): import a CSV, fix rows with problems, run *Preview redirects (dry run)*, then *Create these redirects*. RETIRE rows return a real 404; sending unrelated pages to the homepage is refused.

**Analytics & Insights.** Periods: today, 7 days, 28 days, 3/6/12 months, custom. Shows Search Console / Bing data (after the owner connects them), first-party page views, Core Web Vitals p75 by page type and device with regression alerts, site-search popular and no-result queries, and publishing activity. Nothing is estimated.

**Account security.** My account → Security: change password, sessions, and two-factor authentication (TOTP). Forgot a password? Use *Forgot your password?* on the sign-in screen, or ask an Admin to issue a reset link (Users → Reset link). Admins can remove a lost 2FA device (Users → Reset 2FA).

## API overview (all under `/api`, JSON, CSRF header `x-csrf-token` required on writes)

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/login` (`totpCode` when 2FA is on), `POST /auth/logout`, `GET/PATCH /auth/me`, `POST /auth/change-password`, sessions; `POST /auth/password-reset/request`, `GET /auth/password-reset/verify`, `POST /auth/password-reset/confirm`, `POST /auth/admin/users/:id/reset-link`; `/auth/totp/{status,setup,enable,disable}`, `POST /auth/totp/admin/:userId/reset` |
| Content | `GET /cms/data`; `POST/PUT/DELETE /articles[/:id]`; `/sports`, `/events`, `/editions`; `/article-types` |
| FAQ | `GET /faq?context=article:<id>\|edition:<id>\|event:<id>\|sport:<id>\|site`, `POST /faq`, `PUT/DELETE /faq/:id`, `POST /faq/reorder`, `GET /faq/diagnostics?context=`, `POST /faq/suggestions` |
| SEO | `/seo/scan`, `/seo/runs`, `/seo/rules`, `/seo/article-check`, `/seo/assistant`, `/seo/technical` |
| Redirects & migration | `/redirects` (+ `/bulk`); `/migration`, `/migration/import`, `/migration/validate`, `/migration/apply`, `/migration/export` |
| Insights | `GET /insights/overview?period=`; `GET /search-console/status`, `POST /search-console/sync` |
| Public | `GET /search`, `/search/suggestions`; `POST /rum` (aggregate measurements); `GET /health`, `/health/ready` |

Every write is audit-logged (Audit Logs shows previous and new values where recorded) and invalidates the public data cache.

## Verification

`npm run build`, then `npm run test:phase-r` (14 groups) plus the earlier suites (`test:phase-a`, `-b`, `-c`, `-d`, `-e`, `-e5`, `-m`, `-h`, `-i`, `test:phase4`). The suites create and remove fixtures; run them one at a time against a local or disposable database only.
