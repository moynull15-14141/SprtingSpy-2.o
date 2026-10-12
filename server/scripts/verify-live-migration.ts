/**
 * Test of the guarded migration command (npm run db:migrate:live) on a
 * disposable local database that is put into the state the hosted database is
 * expected to be in: every migration applied except the newest one.
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
const MIGRATION = '20261015090000_article_import_source';

// ── The pending migration is additive; destructive SQL is recognised ──
const sql = fs.readFileSync(`prisma/migrations/${MIGRATION}/migration.sql`, 'utf8');
assert.equal(isAdditive(sql), true);
assert.match(sql, /CREATE TABLE "ArticleImport"/); assert.match(sql, /REFERENCES "Article"\("id"\) ON DELETE CASCADE/);
assert.equal((sql.replace(/--.*$/gm, '').match(/;/g) ?? []).length, 3, 'three statements: one table, one unique index, one foreign key');
for (const bad of ['DROP TABLE "Article";', 'ALTER TABLE "Article" DROP COLUMN "title";', 'TRUNCATE "User";', 'DELETE FROM "Article";', 'UPDATE "Article" SET status = \'published\';', 'ALTER TABLE "Article" ALTER COLUMN "title" TYPE TEXT;', 'ALTER TABLE "Article" RENAME TO "Old";', 'DROP INDEX "x";']) assert.equal(isAdditive(bad), false, bad);
for (const fine of ['ALTER TABLE "SportEvent" ADD COLUMN "descriptionBody" JSONB;', 'CREATE INDEX "i" ON "Article"("slug");', "ALTER TYPE \"AuditEntityType\" ADD VALUE 'Page';", 'INSERT INTO "Page" ("id") VALUES (\'a\');', '-- DROP TABLE mentioned in a comment only\nCREATE TABLE "T" ("id" TEXT);']) assert.equal(isAdditive(fine), true, fine);
assert.deepEqual(describeTarget('postgresql://user:secret@db.example.com:12345/defaultdb?sslmode=require'), { database: 'defaultdb', host: 'db.example.com' });
assert.throws(() => describeTarget('mysql://u:p@h/db')); assert.throws(() => describeTarget(undefined));
pass('the pending migration only adds one table, one unique index and one foreign key; destructive statements are recognised');

// ── A disposable database, one migration behind ──
const env = await recreateDisposableDatabase({ name: TEST_DB, envFile: 'migration-inventory/migratetest.env', port: 3114, mediaDir: 'migration-inventory/migratetest-media' });
const db = new pg.Client({ connectionString: env.DATABASE_URL });
await db.connect();
const tables = async () => Object.fromEntries((await db.query(`select c.relname as name, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I', c.relname), false, true, '')))[1]::text::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and c.relname <> '_prisma_migrations' order by 1`)).rows.map((r) => [r.name, r.n]));
await db.query('drop table "ArticleImport"');
await db.query('delete from _prisma_migrations where migration_name = $1', [MIGRATION]);
const before = await tables();
assert.equal(before.ArticleImport, undefined);
const run = (args: string[]) => { const r = spawnSync(process.execPath, ['--import', 'tsx', 'server/scripts/migrate-live.ts', ...args], { env: env as NodeJS.ProcessEnv, encoding: 'utf8', windowsHide: true }); return { status: r.status, text: `${r.stdout}${r.stderr}` }; };
const password = new URL(env.DATABASE_URL).password;
const phrase = `APPLY 1 MIGRATION TO ${TEST_DB}@localhost`;

try {
  const plan = run([]);
  assert.equal(plan.status, 0);
  assert.match(plan.text, new RegExp(`Target: database "${TEST_DB}" on localhost`)); assert.match(plan.text, new RegExp(`Pending \\(1\\): ${MIGRATION}`)); assert.match(plan.text, /Additive only[^\n]*: yes/); assert.match(plan.text, /Plan only\. Nothing was changed/);
  assert(plan.text.includes(phrase));
  assert(!password || !plan.text.includes(password), 'the connection password is never printed');
  assert.deepEqual(await tables(), before);
  pass('plan: names the target and the one pending migration, reports it additive, changes nothing, prints no credentials');

  for (const args of [['--apply'], ['--apply', '--confirm', phrase], ['--apply', '--backup-taken', 'x', '--confirm', phrase], ['--apply', '--backup-taken', 'Aiven console backup 2026-10-12 18:00', '--confirm', 'yes'], ['--apply', '--backup-taken', 'Aiven console backup 2026-10-12 18:00', '--confirm', 'APPLY 1 MIGRATION TO defaultdb@other-host']]) {
    const r = run(args);
    assert.equal(r.status, 1, `${args.join(' ')} must be refused`); assert(!password || !r.text.includes(password));
  }
  assert.deepEqual(await tables(), before, 'refused attempts change nothing');
  pass('apply is refused without a named backup, without the confirmation, or with a phrase for another target');

  const applied = run(['--apply', '--backup-taken', 'local test clone, no backup needed', '--confirm', phrase]);
  assert.equal(applied.status, 0, applied.text.slice(-400)); assert.match(applied.text, /The schema is up to date/);
  const after = await tables();
  assert.equal(after.ArticleImport, 0, 'the new table exists and is empty');
  for (const [name, n] of Object.entries(before)) assert.equal(after[name], n, `${name} keeps its ${n} rows`);
  assert.equal((await db.query('select count(*)::int as n from _prisma_migrations where migration_name = $1 and finished_at is not null', [MIGRATION])).rows[0].n, 1);
  const again = run(['--apply', '--backup-taken', 'local test clone, no backup needed', '--confirm', phrase]);
  assert.equal(again.status, 0); assert.match(again.text, /up to date\. Nothing to apply/);
  pass('apply with the exact phrase: the table is created, every existing table keeps its row count, and a second run does nothing');
} finally { await db.end(); }
console.log(`Live-migration command verification passed: ${checks} checks (disposable database ${TEST_DB}).`);
