# SportingSpy v2.o

Multi-sport sports information platform (Spec v1.1).

**Architecture:** one Node.js process (`server.ts`, Express) that
- serves the JSON API under `/api/*` (auth, sessions, CSRF, RBAC, CMS writes),
- owns security headers (per-request CSP nonce), CORS, redirects and the
  trailing-slash URL policy, `/sitemap.xml` and `/robots.txt`,
- renders every page with **Next.js 16 (App Router)**. Public pages are
  server-rendered from route-specific PostgreSQL queries
  (`server/services/public/`); the CMS at `/admin/` is a client-rendered area
  that loads its data from the staff-only `GET /api/cms/data`.

Data: PostgreSQL via Prisma 7 (`prisma/schema.prisma`).

Media (Phase C): uploads go through `server/media` (validation + sharp
processing into AVIF/WebP sizes) into a storage provider. The `local`
provider writes to `MEDIA_LOCAL_DIR` (default `storage/media`, served at
`/media`). That directory is content: it must be on persistent storage and
included in backups.

## Requirements

- Node.js 22+
- PostgreSQL (local for development). See `.env.example` and
  `DATABASE_OPERATIONS.md`. Never run `prisma migrate reset` against real data.

## Local development

```bash
npm install
cp .env.example .env          # set DATABASE_URL
npm run db:migrate:deploy     # apply migrations (never resets)
npm run dev                   # http://localhost:3000 (Next.js dev + hot reload)
```

## Production

```bash
npm ci
npm run db:migrate:deploy
npm run media:import-legacy   # once: process legacy /src/assets/images media (idempotent)
npm run build                 # tsc --noEmit && next build  (creates .next/)
npm run start:production      # NODE_ENV=production node --import tsx server/start-production.ts
```

Required environment in production: `DATABASE_URL`, `ALLOWED_ORIGIN` (the
public https origin; also the canonical URL base), plus `PORT`, `HOST`,
`TRUST_PROXY` as needed. Optional launch flags: `ENABLE_READER_ACCOUNTS`,
`ENABLE_COMMENTS` (both default off). `DEV_LOGIN_BYPASS` is refused in
production. The build does not need a database connection; the server does.

## Checks

```bash
npm run lint                  # TypeScript (tsc --noEmit)
npm run test:phase-c          # editor, preview, media pipeline, redirects, settings
npm run test:phase-b          # SSR, metadata, JSON-LD, 404s, data isolation
npm run test:phase-a          # launch configuration (flags off)
ENABLE_READER_ACCOUNTS=true ENABLE_COMMENTS=true npm run test:phase4
ENABLE_READER_ACCOUNTS=true ENABLE_COMMENTS=true npm run test:production
```

Browser checks run when `PLAYWRIGHT_MODULE` points at a Playwright
`index.mjs` and Chrome is installed. All suites need a prior `npm run build`
and a local database; they create and remove their own fixtures.

## Site Experience (Phase F.1)

Open **Admin → Site Experience** to edit homepage sections, desktop/mobile
navigation, footer columns/social links, reusable editorial blocks and
announcements. Save drafts, enable draft preview, then publish or schedule
each area from **Preview / Publish**. Admins publish all areas; Editors publish
homepage, announcements and blocks, with Admin approval for navigation/footer.

Public pages use the published configuration and safe defaults. Draft preview
requires an active staff session. Ads, consent and SEO continue to use their
existing systems. See [the audit](PHASE_F1_AUDIT.md) and
[implementation/verification report](PHASE_F1_IMPLEMENTATION.md).

Open the Homepage **Intro banner** to choose/upload a background image and
compare ten banner presets in a live desktop/mobile preview. Adjust image crop,
zoom, overlay, height and text position/size, then save draft and publish.

```bash
npm run test:site-experience
```

This suite requires a current production build, a local DATABASE_URL and
PLAYWRIGHT_EXECUTABLE_PATH pointing at installed Chromium. It verifies real
APIs and browser behavior, restores site documents and checks database integrity.
