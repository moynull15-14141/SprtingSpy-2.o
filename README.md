# SportingSpy v2.0

Multi-sport information site (sports, events, yearly editions and guides) with its own editorial CMS at `/admin/`.

- **Stack:** one Node.js 22 process — Express (`server.ts`) for the API, security and redirects, plus Next.js 16 for every page.
- **Data:** PostgreSQL via Prisma 7 (`prisma/schema.prisma`); media in Cloudflare R2 (or local storage in development).
- **Content model:** Sport → Group → Event → Edition → Article; groups are chosen in the CMS with one Sport / Group tree picker.
- **Local run:** `npm ci`, copy `.env.example` to `.env` (local database), `npm run db:generate`, `npm run db:migrate:deploy`, `npm run dev`.
- **Production (Render):** build `npm ci --include=dev && npm run build`, start `npm run start:production`; migrations run separately with `npm run db:migrate:deploy`.
- **Checks:** `npm run lint` (TypeScript) and the `npm run test:*` suites (they need a build and a local database).
- **More detail:** [ARCHITECTURE.md](ARCHITECTURE.md), [DEPLOYMENT.md](DEPLOYMENT.md), [DATABASE_OPERATIONS.md](DATABASE_OPERATIONS.md), [DISCIPLINES.md](DISCIPLINES.md).
