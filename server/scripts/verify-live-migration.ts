/**
 * Test of the guarded migration command (npm run db:migrate:live) on a
 * disposable local database that is put into the state the hosted database is
 * expected to be in: every migration applied except the pending ones (the
 * two sport-group migrations, which the hosted database does not have yet).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { recreateDisposableDatabase } from '../wordpressImport/localDb';
import { describeTarget, isAdditive } from './migrate-live';

let checks = 0;
const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
const TEST_DB = 'sportingspy_wp_pilot_migratetest';
const MIGRATION = '20261016090000_sport_disciplines';
/** The second pending migration: a group's own landing-page settings. */
const GROUP_FIELDS = '20261017090000_group_landing_fields';
const PENDING = [MIGRATION, GROUP_FIELDS];

// ── The pending migrations are additive; destructive SQL is recognised ──
const fieldsSql = fs.readFileSync(`prisma/migrations/${GROUP_FIELDS}/migration.sql`, 'utf8');
assert.equal(isAdditive(fieldsSql), true);
assert.equal((fieldsSql.match(/ALTER TABLE "Discipline" ADD COLUMN "(tagline|icon|heroImage|heroMediaId|featuredEventIds)"/g) ?? []).length, 5, 'five columns on the group table');
assert.match(fieldsSql, /"tagline" TEXT NOT NULL DEFAULT ''/); assert.match(fieldsSql, /REFERENCES "MediaItem"\("id"\) ON DELETE RESTRICT/);
assert.equal((fieldsSql.replace(/--.*$/gm, '').match(/;/g) ?? []).length, 7, 'seven statements: five columns, one index, one foreign key');
assert(!/ALTER TABLE "(?!Discipline")/.test(fieldsSql), 'no other table is altered');
const sql = fs.readFileSync(`prisma/migrations/${MIGRATION}/migration.sql`, 'utf8');
assert.equal(isAdditive(sql), true);
assert.match(sql, /CREATE TABLE "Discipline"/); assert.match(sql, /ADD COLUMN "disciplineSlug" TEXT;/);
assert.equal((sql.match(/FOREIGN KEY \("sportSlug", "disciplineSlug"\) REFERENCES "Discipline"\("sportSlug", "slug"\) ON DELETE RESTRICT ON UPDATE CASCADE/g) ?? []).length, 2, 'events and articles reference a discipline of their own sport');
assert.equal((sql.replace(/--.*$/gm, '').match(/;/g) ?? []).length, 10, 'ten statements: one table, two nullable columns, four indexes, three foreign keys');
assert(!/NOT NULL/.test(sql.split('ALTER TABLE "SportEvent" ADD COLUMN')[1]), 'the columns added to existing tables are nullable, so every existing row stays valid');
for (const bad of ['DROP TABLE "Article";', 'ALTER TABLE "Article" DROP COLUMN "title";', 'TRUNCATE "User";', 'DELETE FROM "Article";', 'UPDATE "Article" SET status = \'published\';', 'ALTER TABLE "Article" ALTER COLUMN "title" TYPE TEXT;', 'ALTER TABLE "Article" RENAME TO "Old";', 'DROP INDEX "x";']) assert.equal(isAdditive(bad), false, bad);
for (const fine of ['ALTER TABLE "SportEvent" ADD COLUMN "descriptionBody" JSONB;', 'CREATE INDEX "i" ON "Article"("slug");', "ALTER TYPE \"AuditEntityType\" ADD VALUE 'Page';", 'INSERT INTO "Page" ("id") VALUES (\'a\');', '-- DROP TABLE mentioned in a comment only\nCREATE TABLE "T" ("id" TEXT);']) assert.equal(isAdditive(fine), true, fine);
assert.deepEqual(describeTarget('postgresql://user:secret@db.example.com:12345/defaultdb?sslmode=require'), { database: 'defaultdb', host: 'db.example.com' });
assert.throws(() => describeTarget('mysql://u:p@h/db')); assert.throws(() => describeTarget(undefined));
pass('the two pending migrations only add: one table, two nullable columns, four indexes and three foreign keys; then five group columns, one index and one foreign key; destructive statements are recognised');

// ── A disposable database, one migration behind ──
const env = await recreateDisposableDatabase({ name: TEST_DB, envFile: 'migration-inventory/migratetest.env', port: 3114, mediaDir: 'migration-inventory/migratetest-media' });
const db = new pg.Client({ connectionString: env.DATABASE_URL });
await db.connect();
const tables = async () => Object.fromEntries((await db.query(`select c.relname as name, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I', c.relname), false, true, '')))[1]::text::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and c.relname <> '_prisma_migrations' order by 1`)).rows.map((r) => [r.name, r.n]));
await db.query('alter table "Article" drop column "disciplineSlug"');
await db.query('alter table "SportEvent" drop column "disciplineSlug"');
await db.query('drop table "Discipline"');
await db.query('delete from _prisma_migrations where migration_name = any($1)', [PENDING]);
const before = await tables();
assert.equal(before.Discipline, undefined);
const run = (args: string[]) => { const r = spawnSync(process.execPath, ['--import', 'tsx', 'server/scripts/migrate-live.ts', ...args], { env: env as NodeJS.ProcessEnv, encoding: 'utf8', windowsHide: true }); return { status: r.status, text: `${r.stdout}${r.stderr}` }; };
const password = new URL(env.DATABASE_URL).password;
const phrase = `APPLY 2 MIGRATIONS TO ${TEST_DB}@localhost`;

try {
  const plan = run([]);
  assert.equal(plan.status, 0);
  assert.match(plan.text, new RegExp(`Target: database "${TEST_DB}" on localhost`)); assert.match(plan.text, new RegExp(`Pending \\(2\\): ${MIGRATION}, ${GROUP_FIELDS}`)); assert.match(plan.text, /Additive only[^\n]*: yes/); assert.match(plan.text, /Plan only\. Nothing was changed/);
  assert(plan.text.includes(phrase));
  assert(!password || !plan.text.includes(password), 'the connection password is never printed');
  assert.deepEqual(await tables(), before);
  pass('plan: names the target and the two pending migrations in order, reports them additive, changes nothing, prints no credentials');

  for (const args of [['--apply'], ['--apply', '--confirm', phrase], ['--apply', '--backup-taken', 'x', '--confirm', phrase], ['--apply', '--backup-taken', 'Aiven console backup 2026-10-12 18:00', '--confirm', 'yes'], ['--apply', '--backup-taken', 'Aiven console backup 2026-10-12 18:00', '--confirm', 'APPLY 1 MIGRATION TO defaultdb@other-host']]) {
    const r = run(args);
    assert.equal(r.status, 1, `${args.join(' ')} must be refused`); assert(!password || !r.text.includes(password));
  }
  assert.deepEqual(await tables(), before, 'refused attempts change nothing');
  pass('apply is refused without a named backup, without the confirmation, or with a phrase for another target');

  const applied = run(['--apply', '--backup-taken', 'local test clone, no backup needed', '--confirm', phrase]);
  assert.equal(applied.status, 0, applied.text.slice(-400)); assert.match(applied.text, /The schema is up to date/);
  const after = await tables();
  assert.equal(after.Discipline, 0, 'the new table exists and is empty');
  const columns = (await db.query(`select column_name, is_nullable, column_default from information_schema.columns where table_name = 'Discipline' and column_name = any($1) order by 1`, [['tagline', 'icon', 'heroImage', 'heroMediaId', 'featuredEventIds']])).rows;
  assert.deepEqual(columns.map((c) => c.column_name), ['featuredEventIds', 'heroImage', 'heroMediaId', 'icon', 'tagline'], 'the group settings columns exist');
  assert.equal(columns.find((c) => c.column_name === 'tagline').is_nullable, 'NO'); assert.match(columns.find((c) => c.column_name === 'tagline').column_default, /''/);
  assert.deepEqual((await db.query('select (select count(*)::int from "Article" where "disciplineSlug" is not null) as articles, (select count(*)::int from "SportEvent" where "disciplineSlug" is not null) as events')).rows[0], { articles: 0, events: 0 }, 'no existing article or event was given a discipline');
  for (const [name, n] of Object.entries(before)) assert.equal(after[name], n, `${name} keeps its ${n} rows`);
  assert.equal((await db.query('select count(*)::int as n from _prisma_migrations where migration_name = any($1) and finished_at is not null', [PENDING])).rows[0].n, 2);
  const again = run(['--apply', '--backup-taken', 'local test clone, no backup needed', '--confirm', phrase]);
  assert.equal(again.status, 0); assert.match(again.text, /up to date\. Nothing to apply/);
  pass('apply with the exact phrase: both migrations run in order, the group table with its settings columns and the two empty columns exist, every existing table keeps its row count, nothing is assigned, and a second run does nothing');
} finally { await db.end(); }
console.log(`Live-migration command verification passed: ${checks} checks (disposable database ${TEST_DB}).`);
