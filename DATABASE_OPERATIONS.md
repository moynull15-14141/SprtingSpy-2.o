# SportingSpy — Database Operations & Recovery Baseline

**Phase 2.1 deliverable.** This document is the practical, local-development
recovery baseline requested in Phase 2.1 — it deliberately does not build a
backup platform, just documents the commands that exist and the ones that
must never be run casually. This file is separate from the archived project notes
(which is not modified in this phase) and from `.env.example` (which only
holds placeholder configuration).

---

## 1. Where things live

| What | Where |
|---|---|
| Schema (source of truth) | `prisma/schema.prisma` |
| Applied migrations (source of truth for schema *history*) | `prisma/migrations/*/migration.sql` |
| Prisma CLI config (loads `.env`, points at the schema/migrations paths) | `prisma.config.ts` |
| Generated Prisma Client (build output — gitignored, regenerate anytime with `npm run db:generate`) | `server/generated/prisma/` |
| Live PostgreSQL connection string (local only, gitignored) | `.env` (`DATABASE_URL`) |
| Placeholder connection string for onboarding | `.env.example` |
| **Historical JSON backup / migration source** | `data/db.json` — removed from the repository after the PostgreSQL cutover; the point-in-time copy is kept in the project archive outside this repository, from before the PostgreSQL cutover |
| Prisma → PostgreSQL data importer (idempotent, read-only against the JSON) | `server/scripts/migrate-json-to-postgres.ts` (`npm run db:migrate-data`) |
| Database safety guard used by the importer | `server/dbSafety.ts` |

---

## 2. Commands you can run safely, any time

```bash
npm run db:validate        # Validates prisma/schema.prisma. No DB connection needed.
npm run db:status          # prisma migrate status — read-only. Shows whether the DB
                            # matches migration history. Never changes anything.
npm run db:generate        # Regenerates the Prisma Client from the schema. No DB writes.
npm run db:studio          # Opens Prisma Studio (a local GUI browser for the DB) at
                            # http://localhost:5555. Lets you view AND edit rows by hand —
                            # be as careful in it as you would be in psql.
```

## 3. Commands that change the database — know which one you're running

| Command | What it does | When to use it |
|---|---|---|
| `npm run db:migrate` (`prisma migrate dev`) | Compares `schema.prisma` to the DB, and if they differ, generates a **new** migration file, applies it, and regenerates the client. Interactive — will prompt if it detects drift. Uses a **temporary shadow database** to validate the new migration (see §7) — this shadow DB is separate from `sportingspy` and is created/dropped automatically. | Only when you have actually changed `prisma/schema.prisma` and want to create the migration file for that change. |
| `npm run db:migrate:deploy` (`prisma migrate deploy`) | Applies migrations that **already exist** in `prisma/migrations/` to the target database. Never creates a new migration, never prompts, never touches a shadow database. | Reproducing the current schema on a fresh database (e.g. a teammate's machine, or after `db:studio`/manual edits desynced things) without risking an accidental new migration. |
| `npm run db:migrate-data` (the JSON importer) | Upserts rows from `data/db.json` into PostgreSQL, keyed by existing id. Safe to re-run — never duplicates, never deletes. Refuses to run against a `DATABASE_URL` that doesn't look like a local dev database unless `ALLOW_DESTRUCTIVE_DB_OPS=true` is set (see `server/dbSafety.ts`). | Re-importing/repairing rows from the historical JSON backup. Not needed for day-to-day development once the DB is populated. |

## 4. Commands you must NEVER run against this database

```
prisma migrate reset          # DROPS the entire database and re-applies migrations from scratch.
prisma db push --force-reset  # Force-syncs schema and can silently drop/recreate columns/tables.
DROP DATABASE sportingspy;
DROP SCHEMA public CASCADE;
TRUNCATE ... (on any table, without a specific, deliberate reason)
```

If any of these ever seem necessary, **stop and back up first** (§5), and only proceed with the person who owns this environment aware of exactly what will be lost.

## 5. Backing up PostgreSQL safely

Requires `pg_dump`, which ships alongside `psql` (already on this machine
at `C:\Program Files\PostgreSQL\17\bin`).

```bash
# From the project root, produces a single restorable file — does not touch the live database.
pg_dump -h localhost -U sportingspy -d sportingspy -F c -f "backups/sportingspy_$(date +%Y%m%d_%H%M%S).dump"
```

You'll be prompted for the `sportingspy` role's password (never put it on
the command line or in a script — that would land it in shell history and
process listings). `backups/` is a plain local folder — create it and
consider adding it to `.gitignore` if you start using this, since a DB dump
can contain user data (password hashes, emails) that shouldn't be committed.

## 6. Restoring PostgreSQL safely

**Restoring overwrites data — always know which direction you're going
before running this.**

```bash
# Restores INTO the existing sportingspy database (adds/overwrites matching objects).
# Does not run automatically — this project does not invoke this for you.
pg_restore -h localhost -U sportingspy -d sportingspy --clean --if-exists "backups/sportingspy_<timestamp>.dump"
```

`--clean --if-exists` drops each object immediately before recreating it
from the dump — appropriate for restoring onto a database you intend to
fully replace with the dump's contents. Do not run this against a database
holding work you haven't backed up first.

**PHASE G — preferred, non-destructive restore:** restore into a *new*
database, verify it, then point `DATABASE_URL` at it. The live database is
never cleaned or overwritten, so a bad backup cannot make things worse:

```bash
createdb -h <host> -U <user> sportingspy_restored
pg_restore -h <host> -U <user> -d sportingspy_restored --no-owner --exit-on-error "backups/<file>.dump"
```

`npm run db:backup-drill` performs this whole cycle against a local
database (dump → new drill database → restore → compare every table →
drop only the drill database) and is the verified reference for the steps.
See DEPLOYMENT.md, "Backup, restore and disaster recovery".

## 7. About the Prisma "shadow database" (Phase 2.1 investigation)

`prisma migrate dev` needs a **temporary, throwaway database** to safely
test whether a new migration applies cleanly before touching your real
data — this is the "shadow database." **This project does not define a
`shadowDatabaseUrl` anywhere** (not in `prisma/schema.prisma`, not in
`prisma.config.ts`). That's fine and intentional: for a local PostgreSQL
server where the connected role has `CREATEDB` privilege (the
`sportingspy` role does — see the `CREATE ROLE ... CREATEDB` from Phase 2
setup), Prisma automatically creates a short-lived shadow database with an
auto-generated name, uses it, and drops it again — **it never runs its
drift-detection against the real `sportingspy` database itself.**

**Verified in this phase:** `npx prisma migrate status` (read-only, doesn't
touch any shadow database) reports the live `sportingspy` database as
"up to date" against the 2 existing migrations, with no drift — so there is
currently no pending schema change that would even trigger shadow-database
usage. No shadow database configuration was added, per the explicit
instruction not to invent one where the existing workflow doesn't need it.

**If `sportingspy` ever loses `CREATEDB` privilege**, `prisma migrate dev`
would fail with a clear permissions error rather than silently doing
anything unsafe — Prisma does not fall back to using the real database as
its own shadow database.

## 8a. Test database isolation (Phase 2.1 finding)

**There is no automated test suite in this project** (`package.json` has no
`test` script; no `*.test.ts`/`*.spec.ts` files exist). This was verified,
not assumed. Consequently:

- There is currently **no risk from an existing test suite** hitting the
  real `sportingspy` database, because no such suite runs today. The only
  things that have written to `sportingspy` are the running application
  server and the manual verification steps performed during Phase 1/Phase 2
  (real HTTP requests against a real dev server — not an automated test
  harness).
- **This project has exactly one `DATABASE_URL`** (in `.env`), with no
  separate test-database configuration. If a test suite is added later, it
  must not simply reuse this same connection for anything destructive
  (bulk deletes, `TRUNCATE`, resets between test runs) without first
  provisioning a separate database (e.g. `sportingspy_test`) and pointing a
  distinct `TEST_DATABASE_URL` at it.
- `server/dbSafety.ts` (added this phase) is written generically enough to
  be reused by a future test setup file — the same
  `assertSafeForBulkDbOperation()` / `checkDatabaseUrlIsLocalDev()` guard
  that protects the JSON importer today can protect a future test
  bootstrap/teardown script from accidentally running against the real
  development database.

**Remaining limitation, stated plainly:** no isolated test database exists
yet because no tests exist yet. Building one now — before there's a test
suite to isolate — would be speculative infrastructure, which this phase's
brief explicitly says not to do. This is the correct point to revisit once
a real test suite is introduced.

## 8. Before introducing a future schema change

1. Run `npm run db:status` first — confirm you're starting from a clean,
   fully-applied state (no drift).
2. Edit `prisma/schema.prisma` only — never hand-edit a file under
   `prisma/migrations/`.
3. Run `npm run db:migrate` and give the migration a clear, specific name
   when prompted (matches the existing `20260926084750_init`,
   `20260926085036_string_type_fields` naming pattern).
4. Read the generated `migration.sql` before trusting it — Prisma will warn
   you inline (as it did for the Phase 2 `string_type_fields` migration) if
   a change could cause data loss. If real data exists and the warning
   applies, back up first (§5).
5. Run `npm run db:generate` (usually automatic after `db:migrate`, but
   confirm) and then `npm run lint` / `npm run build` to catch any
   TypeScript fallout from the schema change.
6. Commit the new migration folder under `prisma/migrations/` — it is part
   of the schema's source-controlled history, same as the two that already
   exist.

---

*This document covers local development recovery only. Production
deployment, automated backups, and a hosted database are explicitly out of
scope for this phase — see the archived project notes for
later phases.*
