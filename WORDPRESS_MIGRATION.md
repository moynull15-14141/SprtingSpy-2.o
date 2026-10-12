# WordPress migration: local work and release checklist

The 50 posts of the old WordPress site are imported into SportingSpy as **drafts that require review**. This file says how to work on it safely on this machine, what the release contains, and the steps that remain on production, in order.

## 1. Working locally without touching production

The project `.env` points at the hosted (Aiven) database. Until that is changed:

- **Do not run plain `npm run dev`, `npm run db:*` or the older `npm run test:phase-*` / `verify-*` suites.** They read `.env`, and several of them write test data.
- Use the local runner instead. It takes its whole configuration from `.env.local-dev`, blanks every other setting so nothing is picked up from `.env`, and checks the database twice before the command starts (the address must be this machine, and the server itself must answer from this machine).

```
npm run local -- check                 # which database it will use
npm run local -- dev                   # the CMS on the local database "sportingspy"
npm run local -- db:migrate:deploy     # migrations, local database only
npm run local -- test:wordpress-converter
```

`npm run local -- init` creates `.env.local-dev` if it is missing. The file is git-ignored.

**Seeing production data locally.** Aiven is the source of truth. To look at it on this machine without touching it, use the local copy, which is restored from a verified backup file:

```
npm run db:backup:live                  # a fresh verified backup (reads Aiven; writes nothing there)
npm run local -- live-copy:refresh      # replace the local copy with the newest backup
npm run local -- live-copy dev          # the CMS on that copy, http://localhost:3000
```

Sign in with your real CMS account. Images are read from the public media address. Anything changed or uploaded there stays on this machine and is replaced by the next refresh; nothing flows back to Aiven.

| Local database | Purpose | Who may reset it |
| --- | --- | --- |
| `sportingspy` | ordinary local development (its own sample content) | you |
| `sportingspy_live_copy` | read-mostly copy of production, from a backup | `live-copy:refresh` |
| `sportingspy_wp_pilot` | the 50 imported drafts, for inspection | nobody: never reset or rolled back |
| `sportingspy_wp_pilot_livetest`, `…_migratetest` | disposable; recreated by the tests | the tests |

To look at the imported drafts: `npm run migration:wordpress-pilot -- serve`, then http://localhost:3111/admin/ (it prints a throwaway sign-in). Only one development server can run in this folder at a time.

## 2. What the migration covers

Checked against the export, the dry run and the pilot manifest:

| Item | Count |
| --- | --- |
| Source posts / imported as drafts | 50 / 50, each linked to its WordPress ID |
| Media files | 76 |
| FAQ entries | 45 |
| Author profiles | 2 (`jamie` 21 articles, `sergio-j-bynum` 29): unlinked, role "Contributor", no e-mail, no picture |
| New sports | 5 (`rodeo`, `horse-racing`, `curling`, `australian-football`, `triathlon`); created hidden on a live site |
| Event editions | 118 and 3866 → golf / the-masters / 2026; 3906 → tennis / french-open / 2026; 68 stays sport-level |
| Links | 139: 62 external kept; internal ones rewritten where the destination is verified; `/wnfr-2024-rodeo-guide/` unresolved |
| SEO | keywords on all 50; meta description on 37; excerpt on 7. Missing ones are left empty |
| Redirects | none created. `redirect-proposals.csv` lists old → new addresses for later (section 5) |

Formatting that could not be kept (table and inline styling, justified text, H5 headings) is listed per post in the dry-run reports under `migration-inventory/`.

## 3. Files in this release

Modified: `server.ts`, `server/editorialWorkflow.ts`, `src/lib/editorialWorkflow.ts`, `prisma/schema.prisma`, `server/services/search/articleSearch.ts`, `server/services/search/params.ts`, `server/services/search/routes.ts`, `src/components/admin/AdminArticles.tsx`, `src/components/admin/useArticleSearch.ts`, `next.config.mjs`, `package.json`, `package-lock.json`.

New: `prisma/migrations/20261015090000_article_import_source/`, `server/wordpressImport/` (all files), `server/scripts/wordpress-dry-run.ts`, `wordpress-pilot.ts`, `wordpress-live.ts`, `local-run.ts`, `migrate-live.ts`, `backup-live.ts`, `verify-wordpress-converter.ts`, `verify-wordpress-pilot.ts`, `verify-wordpress-live.ts`, `verify-live-migration.ts`, `src/components/admin/ImportSource.tsx`, `WORDPRESS_MIGRATION.md`.

Not part of it: `SportingSpy_Website_Owner_Guide.pdf`, the modified screenshots under `verification/`, and everything git-ignored (`migration-inventory/`, `.env*`, `backups/`).

## 4. Production checklist, in order

Each remaining step needs its own go-ahead. Steps 1 and 2 were done on 12 October 2026; the rest has not been run.

1. **Back up Aiven.** *Done 12 Oct 2026 12:19 UTC as a logical backup: `aiven-defaultdb-before-article-import-20261012T121916Z.dump` in `C:UsersTSportingSpy-backups` (outside the repository, readable by this Windows user only), with its SHA-256 beside it. Verified: `pg_restore --list` reads it, and all 32 tables have the same row counts as the server had. The Aiven console backup was not checked. Take a fresh backup before the import (step 6).* For a new one: `npm run db:backup:live -- --label <why>` takes and verifies a logical backup in the same folder; also take a backup or fork in the Aiven console and note the time. Also keep a dump on a trusted machine: `pg_dump -d "<service URI from the Aiven console>" -F c -f backups/aiven-before-import-<date>.dump`, then `pg_restore -l` on the file to confirm it is readable. The server runs PostgreSQL 18, so the dump needs the version 18 client: it is in `C:UsersTpg18-clientin` (the installed PostgreSQL 17 `pg_dump` refuses). That client rejects the host certificate under `sslmode=verify-full`; use `verify-ca` with the Aiven CA file. Never restore over the live database: a recovery goes into a new service or fork, which Render is then pointed at.
2. **Apply the one pending migration**, `20261015090000_article_import_source`. *Done 12 Oct 2026 through the guarded command. The database now has 23 migrations, all finished, and an empty `ArticleImport` table; the 31 other tables were byte-for-byte unchanged apart from the migration history. `npm run db:migrate:live` now reports "up to date".* For reference, the migration is (one new table, one unique index, one foreign key; nothing existing changes, and the current code ignores the table, so this is safe before the deploy).
   ```
   npm run db:migrate:live
   ```
   For any later migration it must show the Aiven database and host and the pending migrations, marked additive. Then, with the phrase it prints:
   ```
   npm run db:migrate:live -- --apply --backup-taken "<where and when>" --confirm "APPLY 1 MIGRATION TO <database>@<host>"
   ```
   This command reads `.env` on purpose. Do not run it through `npm run local`.
3. **Commit and push** the files of section 3.
4. **Deploy on Render.** No environment variable changes. Check `/api/health/ready`, sign in to `/admin/`, and confirm the Articles list shows the new "Source" filter and the existing articles unchanged.
5. **Preflight over HTTPS** (plan-only; writes nothing):
   ```
   npm run migration:wordpress-live -- plan --target https://sportingspy.com --only 3534,1163,1186,240,3866
   ```
   It asks for an Admin's e-mail, password and, if the account has it, the 6-digit code. It must report 5 posts to create and the author profiles to create, and no refusals.
6. **Import 5 articles** with the phrase the plan printed: `… -- import --target https://sportingspy.com --only 3534,1163,1186,240,3866 --execute --confirm "IMPORT 5 POSTS INTO sportingspy.com"`.
7. **Verify.** `… -- verify --target https://sportingspy.com`, then look at the five drafts in the CMS: images load from the media address, tables and FAQ entries are there, status is Draft with review required.
8. **Import the remaining 45 in batches**: `… -- plan --target https://sportingspy.com`, then `… -- import … --batch 5 --execute --confirm "IMPORT 45 POSTS INTO sportingspy.com"`. If it stops, run the same plan and import again: finished posts are skipped and a half-finished one is completed.
9. **Reconcile.** `… -- verify` must report 50 checked, 50 drafts, 50 review required, 45 FAQ entries and 50 import records. In the CMS, "Source: WordPress imports" must list 50.
10. **Review and publish by hand.** Each draft is submitted for review and approved by a second Admin or Editor before it can be published. Nothing is published or scheduled by the import.

Media: the import uploads the 76 images through the CMS, which stores them wherever the site is configured to (today the `r2.dev` bucket). No storage setting changes.

## 5. After articles are published

- **New sports** are hidden. An Admin makes a sport visible when its first article is published. Until then, links to that sport's page and to posts in it keep their old address in the drafts.
- **Redirects.** `redirect-proposals.csv` (from the plan's dry run) is a Site Migration sheet: each post's old address, and its older slugs, with the new address. Import it in CMS → Site Migration only for published articles; the tool refuses a redirect to a page that is not live. Rows without a decision need yours: the 22 category archives, the 636 tag archives and 29 old Rank Math rules in `url-inventory.csv`, and `/wnfr-2024-rodeo-guide/`, which has no verified destination and gets no redirect.
- **Author profiles**: add a biography or picture if wanted; none was invented.
- **Media**: every imported image is "pending" copyright review; licence and credit are unknown.

## 6. Rollback and its limits

`npm run migration:wordpress-live -- rollback --target …` lists what it would remove, and removes it only with `--execute` and its confirmation phrase.

- It deletes **untouched drafts only**. An article that was edited, submitted, approved or published is kept and reported.
- **Author profiles are not removed**: the CMS has no way to delete one. An Admin can leave or rename them.
- **Media**: the image records the import uploaded are deleted through the CMS, which also deletes their files. If a file deletion fails in storage, the record is gone but the object may remain in the bucket; nothing reports that. An image that was already in the library before the import is never deleted.
- **Sports** created by the import are removed once no article or event belongs to them.
- Audit-log entries of the import remain.
- The migration itself needs no rollback: the table is unused by older code.
