/**
 * Backup + restore drill (PHASE G). Proves that a pg_dump backup of the
 * database can actually be restored, without touching the live database:
 *
 *   1. pg_dump (custom format) the DATABASE_URL database   -> backups/*.dump  (read-only on the source)
 *   2. CREATE a new, empty drill database on the same server (name: <db>_restore_drill_<timestamp>)
 *   3. pg_restore the dump into that drill database
 *   4. compare every table (row count + content hash), the migration history,
 *      extensions and the generated search column between source and drill
 *   5. DROP the drill database — only a database whose name matches the drill
 *      pattern this script created; the live database is never dropped, cleaned
 *      or overwritten
 *
 * Local development databases only (server/dbSafety.ts). For production, run
 * the same steps against a restored copy on a disposable server (see
 * PHASE_G_IMPLEMENTATION.md, Recovery runbook). The dump file is kept.
 *
 *   npm run db:backup-drill
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';

const sourceUrl = process.env.DATABASE_URL!;
const safety = checkDatabaseUrlIsLocalDev(sourceUrl);
assert(safety.safe, `Drill refused: ${safety.reason}`);

function pgBin(tool: string): string {
  const exe = process.platform === 'win32' ? `${tool}.exe` : tool;
  const dirs = [process.env.PG_BIN, ...(process.platform === 'win32' && fs.existsSync('C:/Program Files/PostgreSQL')
    ? fs.readdirSync('C:/Program Files/PostgreSQL').sort().reverse().map((v) => `C:/Program Files/PostgreSQL/${v}/bin`) : [])].filter(Boolean) as string[];
  for (const dir of dirs) if (fs.existsSync(path.join(dir, exe))) return path.join(dir, exe);
  return tool; // rely on PATH
}

const source = new URL(sourceUrl);
source.searchParams.delete('schema');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
const drillName = `${source.pathname.slice(1)}_restore_drill_${stamp}`;
assert(/^[a-z0-9_]+_restore_drill_\d{8}_\d{6}$/.test(drillName), 'unexpected drill database name');
const drill = new URL(source); drill.pathname = `/${drillName}`;
// Credentials go to the tools through the environment, never on a command line.
const env = { ...process.env, PGPASSWORD: decodeURIComponent(source.password) };
const conn = (u: URL) => ['-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username)];

fs.mkdirSync('backups', { recursive: true });
const dumpFile = path.join('backups', `${source.pathname.slice(1)}_${stamp}.dump`);

async function fingerprint(url: URL) {
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const tables = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)).rows.map((r) => r.tablename as string);
    const out: Record<string, string> = {};
    for (const t of tables) {
      const q = `SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, E'\\n' ORDER BY x::text), '')) AS h FROM "${t.replace(/"/g, '""')}" x`;
      const { n, h } = (await client.query(q)).rows[0];
      out[t] = `${n}:${h}`;
    }
    out['@extensions'] = (await client.query(`SELECT string_agg(extname, ',' ORDER BY extname) AS e FROM pg_extension`)).rows[0].e;
    out['@searchVector'] = (await client.query(`SELECT attgenerated::text AS g FROM pg_attribute WHERE attrelid = '"Article"'::regclass AND attname = 'searchVector'`)).rows[0]?.g ?? 'missing';
    return out;
  } finally { await client.end(); }
}

const admin = new pg.Client({ connectionString: source.toString() });
let created = false;
const t0 = Date.now();
try {
  execFileSync(pgBin('pg_dump'), [...conn(source), '-d', source.pathname.slice(1), '-F', 'c', '-f', dumpFile], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  const size = fs.statSync(dumpFile).size;
  console.log(`1. backup written: ${dumpFile} (${Math.round(size / 1024)} KB)`);

  await admin.connect();
  await admin.query(`CREATE DATABASE "${drillName}"`);
  created = true;
  console.log(`2. drill database created: ${drillName}`);

  execFileSync(pgBin('pg_restore'), [...conn(drill), '-d', drillName, '--no-owner', '--exit-on-error', dumpFile], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  console.log('3. restore completed into the drill database');

  const [a, b] = await Promise.all([fingerprint(source), fingerprint(drill)]);
  const diff = Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]);
  assert.deepEqual(diff, [], `restored copy differs in: ${diff.join(', ')}`);
  const tables = Object.keys(a).filter((k) => !k.startsWith('@'));
  const rows = tables.reduce((n, t) => n + Number(a[t].split(':')[0]), 0);
  console.log(`4. verified: ${tables.length} tables, ${rows} rows, migration history, extensions (${a['@extensions']}) and the generated search column match the source`);
} finally {
  if (created) {
    assert(/_restore_drill_\d{8}_\d{6}$/.test(drillName));
    await admin.query(`DROP DATABASE IF EXISTS "${drillName}" WITH (FORCE)`);
    console.log(`5. drill database removed: ${drillName} (the source database was only read)`);
  }
  await admin.end().catch(() => undefined);
}
console.log(`PASS backup/restore drill in ${Math.round((Date.now() - t0) / 1000)} s; backup kept at ${dumpFile}`);
