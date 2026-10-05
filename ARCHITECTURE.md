# SportingSpy v2.0 architecture

This is the current code path. Phase reports and older design notes are kept outside this repository (project archive).

## Request path

```text
Browser / crawler
  → Express (server.ts): HTTPS/proxy, security headers, sessions, CSRF, rate limits, redirects, API, sitemap/robots
  → Next.js 16 App Router (src/app): server-rendered public pages and CMS shell
  → public loaders (src/lib/data.ts, server/services/public/*)
  → Prisma 7 (server/db.ts) → PostgreSQL
```

`server.ts` remains the custom server and owns HTTP concerns. It also mounts domain routers from `server/` rather than using Next API routes. `src/views/` renders public page structures; `src/components/admin/` renders the CMS. `src/types/` and `prisma/schema.prisma` describe application and database shapes. The database schema history is in `prisma/migrations/`; the generated Prisma client is build output under `server/generated/prisma/`.

The server is intentionally a large integration point. Its main responsibilities are startup/shutdown, authentication/session endpoints, content mutations, media and CMS routes, scheduler coordination, security middleware, redirect handoff and Next rendering. A change in it should be scoped to one route family and tested through HTTP; splitting it for aesthetics is not a current objective.

## Content, URL and visibility

Sport is the top-level taxonomy; a permanent SportEvent has yearly EventEditions. Articles require a Sport and may optionally reference an Event and Edition. General and event-level articles have `/{sport}/{slug}/`; edition articles have `/{sport}/{event}/{year}/{slug}/`. Public pages return only published/visible records. Staff preview uses a session and bypasses the shared published-data cache.

`server/urlStability.ts` snapshots public URLs by stable row ID before Sport/Event natural-key changes. `server/redirects.ts` stores 301 rules and flattens chains. Slug collision checks protect the shared `/{sport}/{segment}/` path. `server/seo/siteIndex.ts` builds indexable URLs for sitemaps and redirect validation.

Article Types live in `ArticleType`, not a fixed CMS-only list. The seeded `How to Watch` and `Sports Viewing Guide` rows are distinct and both use the viewing SEO profile. `server/articleTypes.ts` supplies the API and active-type validation. FAQ entries belong to at most one Article, Edition, Event, Sport or optional site-wide context. `server/faq.ts` records explicit editor approval. Public loaders select only published FAQ; `ContextFaq.tsx` emits FAQPage JSON-LD only when the page's opt-in and content validation both pass.

## Data and performance

Public page loaders use bounded SQL lists, totals and pagination. PostgreSQL full-text and trigram indexes support Article/Event search; `server/services/search/` handles ranking and paging. `server/publicCache.ts` caches published data in process memory for a short TTL and invalidates after successful CMS writes. `src/lib/data.ts` also uses React request-scoped deduplication. HTML remains dynamic because CSP nonce, consent and preview state are per request. Multiple app instances can disagree until TTL expires; use a shared invalidation mechanism when deploying at scale.

Media metadata, transformed variants and usage live in the Media Library (`server/media*`, Prisma MediaItem/ArticleMedia). Storage can be persistent local volume or S3-compatible object storage, configured through the environment. Legacy/external image URLs still need a tracking/import review. Browser web vital and page-view reports aggregate into database tables through `server/rum.ts`; internal search and external Search Console/Bing metrics have separate tables and administrative views. Empty provider data is reported as empty.

## Authentication and integrations

Staff passwords are hashed; sessions are server-side and role checks come from the authenticated session. Password-reset tokens are single-use hashes and invalidate sessions when redeemed. Optional TOTP has a separate encrypted secret; production needs a configured encryption key. Reset email, Search Console, Bing, AdSense, CMP, analytics, domain, TLS, CDN and backups require owner/provider configuration. The repository does not prove that these external services are active.

## Common commands

`npm run db:generate` generates the client. `npm run db:validate` validates schema syntax. `npm run db:status` inspects migration history. `npm run build` runs TypeScript then Next build. `npm run start:production` applies startup guards; it never runs migrations. `npm run smoke` checks a running service; set `SMOKE_BASE_URL` and `SMOKE_EXPECT_ORIGIN` to the actual service and canonical origin. Browser suites use installed Chrome through `PLAYWRIGHT_EXECUTABLE_PATH` where required. Tests that create fixtures share the local database and must run sequentially.

For environment, staging, backup, restore and rollback details, use `DEPLOYMENT.md` and `DATABASE_OPERATIONS.md`. Editor workflows and the API surface are described in `EDITOR_AND_API_GUIDE.md`.
