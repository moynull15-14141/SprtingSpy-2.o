/**
 * Applies pending Prisma migrations to the database in DATABASE_URL, with a
 * plan first and an explicit confirmation — meant for the hosted (Aiven)
 * database, where `prisma migrate deploy` should never be typed blind.
 *
 *   npm run db:migrate:live                      plan: target, pending migrations, whether they are additive
 *   npm run db:migrate:live -- --apply --backup-taken "<where/when>" --confirm "APPLY 1 MIGRATION TO <database>@<host>"
 *
 * It only ever runs `prisma migrate status` and `prisma migrate deploy`
 * (existing migrations, in order; never reset, never `migrate dev`, no seed).
 * It refuses to apply when: the history has drifted or a migration has failed;
 * a pending migration contains a destructive statement; no backup is named;
 * or the confirmation phrase does not match the target exactly.
 * The connection string is never printed: only the database name and host.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DESTRUCTIVE = /\b(DROP\s+(TABLE|COLUMN|INDEX|TYPE|SCHEMA|DATABASE|CONSTRAINT)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"?\w+"?\s+SET|ALTER\s+TABLE\s+[^;]*\b(DROP|ALTER\s+COLUMN|RENAME)\b|ALTER\s+TYPE\s+[^;]*\bRENAME\b)/i;

/** True when the SQL only adds things (new tables, columns, indexes, constraints, enum values, inserted rows). */
export function isAdditive(sql: string): boolean {
  return !DESTRUCTIVE.test(sql.replace(/--.*$/gm, ''));
}

export function describeTarget(databaseUrl: string | undefined): { database: string; host: string } {
  if (!databaseUrl) throw new Error('DATABASE_URL is not set.');
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new Error('DATABASE_URL is not a URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL is not a PostgreSQL URL.');
  return { database: decodeURIComponent(url.pathname.slice(1)), host: url.hostname };
}

const prisma = (args: string[]) => {
  const r = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], { encoding: 'utf8', windowsHide: true });
  return { status: r.status ?? 1, text: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const target = describeTarget(process.env.DATABASE_URL);
  const secret = new URL(process.env.DATABASE_URL!).password;
  const clean = (text: string) => (secret ? text.split(secret).join('***') : text).replace(/(postgres(?:ql)?:\/\/)[^@\s]*@/g, '$1***@');

  const status = prisma(['migrate', 'status']);
  // Prisma must be looking at the same database this script describes.
  if (!status.text.includes(`"${target.database}"`) || !status.text.includes(target.host)) throw new Error(`Prisma does not report ${target.database}@${target.host} as its target. Nothing was done.\n${clean(status.text).slice(0, 400)}`);
  const upToDate = /Database schema is up to date/i.test(status.text);
  const pending = upToDate ? [] : [...status.text.matchAll(/^\s*(\d{14}_[a-z0-9_]+)\s*$/gim)].map((m) => m[1]);
  const drift = /failed|drift|not found locally|have been modified|are different|P3\d{3}/i.test(status.text) && !upToDate && !/have not yet been applied/i.test(status.text);
  const files = pending.map((name) => ({ name, file: path.join('prisma/migrations', name, 'migration.sql') }));
  const missing = files.filter((f) => !fs.existsSync(f.file)).map((f) => f.name);
  const notAdditive = files.filter((f) => fs.existsSync(f.file) && !isAdditive(fs.readFileSync(f.file, 'utf8'))).map((f) => f.name);
  const phrase = `APPLY ${pending.length} ${pending.length === 1 ? 'MIGRATION' : 'MIGRATIONS'} TO ${target.database}@${target.host}`;

  console.log(`[migrate] Target: database "${target.database}" on ${target.host}.`);
  if (upToDate) { console.log('[migrate] The database schema is up to date. Nothing to apply.'); return; }
  if (drift || !pending.length || missing.length) throw new Error(`The migration history is not a clean "pending" state (drift, a failed migration, or a migration missing from this checkout). Nothing was done.\n${clean(status.text).slice(0, 600)}`);
  console.log(`[migrate] Pending (${pending.length}): ${pending.join(', ')}`);
  console.log(`[migrate] Additive only (no drop, rename, delete or rewrite of existing data): ${notAdditive.length ? `NO — ${notAdditive.join(', ')}` : 'yes'}`);

  if (!args.includes('--apply')) {
    console.log(`[migrate] Plan only. Nothing was changed. After a backup, apply with:\n  npm run db:migrate:live -- --apply --backup-taken "<where and when>" --confirm "${phrase}"`);
    return;
  }
  if (notAdditive.length) throw new Error(`Refusing to apply: ${notAdditive.join(', ')} is not additive. Review it and apply it by hand if it is intended.`);
  const backup = (value('backup-taken') ?? '').trim();
  if (backup.length < 8) throw new Error('Refusing to apply: name the backup taken first with --backup-taken "<where and when>".');
  if (value('confirm') !== phrase) throw new Error(`Not confirmed. The exact phrase is: --confirm "${phrase}"`);

  console.log(`[migrate] Backup on record: ${backup}`);
  const deploy = prisma(['migrate', 'deploy']);
  console.log(clean(deploy.text).split(/\r?\n/).filter((l) => /Applying|applied|No pending|migrations? found/i.test(l)).join('\n'));
  if (deploy.status !== 0) throw new Error(`prisma migrate deploy failed. The database may be partly migrated; check "npm run db:migrate:live" before anything else.\n${clean(deploy.text).slice(-600)}`);
  const after = prisma(['migrate', 'status']);
  if (!/Database schema is up to date/i.test(after.text)) throw new Error(`The migration ran but the status is not "up to date".\n${clean(after.text).slice(0, 400)}`);
  console.log(`[migrate] Done: ${pending.join(', ')} applied to ${target.database}@${target.host}. The schema is up to date.`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve('server/scripts/migrate-live.ts')) {
  main().catch((err) => { console.error(`[migrate] ${err instanceof Error ? err.message : err}`); process.exit(1); });
}
