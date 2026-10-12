/**
 * Logical backup of the database in DATABASE_URL (the hosted database) with
 * pg_dump, verified before it is called a backup. Read-only on the server.
 *
 *   npm run db:backup:live [-- --out <folder outside the repository> --label <text>]
 *
 * - The file is written OUTSIDE the repository (default: SportingSpy-backups in
 *   the user's home folder), never under the project or a public folder.
 * - pg_dump must be at least the server's major version. It is looked for in
 *   PG_CLIENT_BIN, then <home>/pg18-client/bin, then PATH.
 * - TLS: the server certificate is verified against the CA file named in
 *   DATABASE_URL (sslrootcert). Full host-name verification is tried first; a
 *   client that cannot parse the certificate's address entries falls back to
 *   CA-only verification, and says so. It never connects without verification.
 * - Verified: pg_dump exit code, pg_restore --list, and the row count of every
 *   table inside the archive against the server before and after the dump.
 * The connection string, user and password are never printed.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import pg from 'pg';

const args = process.argv.slice(2);
const value = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const url = new URL(process.env.DATABASE_URL);
  const database = decodeURIComponent(url.pathname.slice(1));
  const scrub = (s: unknown) => [decodeURIComponent(url.password), url.hostname, decodeURIComponent(url.username)].filter(Boolean).reduce((text, secret) => text.split(secret).join('***'), String(s));
  const outDir = path.resolve(value('out') ?? path.join(os.homedir(), 'SportingSpy-backups'));
  const relative = path.relative(process.cwd(), outDir);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('The backup folder must be outside the repository.');
  const caSetting = url.searchParams.get('sslrootcert');
  const ca = [caSetting, caSetting && path.resolve(caSetting), path.resolve('certs/aiven-ca.pem')].find((p): p is string => !!p && fs.existsSync(p) && fs.statSync(p).isFile());
  if (!ca) throw new Error('No CA certificate file found (sslrootcert in DATABASE_URL, or certs/aiven-ca.pem). Refusing to connect without verifying the server.');

  const counts = async () => {
    const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 20000 });
    await client.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const names = (await client.query(`select c.relname as name from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' order by 1`)).rows.map((r) => r.name as string);
    const rows: Record<string, number> = {};
    for (const n of names) rows[n] = (await client.query(`select count(*)::int as n from "${n}"`)).rows[0].n;
    const info = (await client.query("select current_setting('server_version') as version, (select count(*)::int from _prisma_migrations where finished_at is not null) as migrations, (select migration_name from _prisma_migrations where finished_at is not null order by finished_at desc limit 1) as latest")).rows[0];
    await client.query('ROLLBACK');
    await client.end();
    return { rows, info };
  };
  const before = await counts();
  const serverMajor = Number(String(before.info.version).split('.')[0]);

  const exe = process.platform === 'win32' ? '.exe' : '';
  const bins = [process.env.PG_CLIENT_BIN, path.join(os.homedir(), 'pg18-client', 'bin'), ''].filter((b): b is string => b !== undefined);
  const bin = bins.find((b) => { const r = spawnSync(path.join(b, `pg_dump${exe}`), ['--version'], { encoding: 'utf8', windowsHide: true }); return r.status === 0 && Number((r.stdout.match(/(\d+)\./) ?? [])[1]) >= serverMajor; });
  if (bin === undefined) throw new Error(`No pg_dump of version ${serverMajor} or newer was found (the server is PostgreSQL ${before.info.version}). Set PG_CLIENT_BIN to a folder that has one.`);
  const tool = (name: string) => path.join(bin, `${name}${exe}`);

  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const label = (value('label') ?? 'backup').replace(/[^a-z0-9-]+/gi, '-').slice(0, 40);
  const file = path.join(outDir, `aiven-${database}-${label}-${stamp}.dump`);
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port, PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: database, PGSSLROOTCERT: ca, PGAPPNAME: 'sportingspy-backup', PGCONNECT_TIMEOUT: '20' } as NodeJS.ProcessEnv;
  delete env.DATABASE_URL;
  let tls = 'verify-full';
  let dump = spawnSync(tool('pg_dump'), ['--format=custom', '--compress=9', '--no-password', '--file', file], { env: { ...env, PGSSLMODE: tls }, encoding: 'utf8', windowsHide: true });
  if (dump.status !== 0 && /certificate contains IP address with invalid length/.test(dump.stderr)) {
    tls = 'verify-ca';
    dump = spawnSync(tool('pg_dump'), ['--format=custom', '--compress=9', '--no-password', '--file', file], { env: { ...env, PGSSLMODE: tls }, encoding: 'utf8', windowsHide: true });
  }
  if (dump.status !== 0) { fs.rmSync(file, { force: true }); throw new Error(`pg_dump failed (exit ${dump.status}): ${scrub(dump.stderr).slice(0, 400)}`); }
  const after = await counts();

  const list = spawnSync(tool('pg_restore'), ['--list', file], { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 });
  if (list.status !== 0) throw new Error(`pg_restore --list cannot read the archive: ${list.stderr.slice(0, 300)}`);
  const toc = list.stdout.split(/\r?\n/);
  // Row counts inside the archive, read by streaming its data out (nothing is written and no database is involved).
  const inArchive = await new Promise<Record<string, number>>((resolve, reject) => {
    const child = spawn(tool('pg_restore'), ['--data-only', '--file=-', file], { windowsHide: true });
    const found: Record<string, number> = {}; let current: string | null = null; let rest = '';
    child.stdout.on('data', (chunk: Buffer) => {
      const lines = (rest + chunk.toString('utf8')).split('\n'); rest = lines.pop() ?? '';
      for (const l of lines) {
        if (current === null) { const m = l.match(/^COPY public\."?([A-Za-z_]+)"? \(/); if (m) { current = m[1]; found[current] = 0; } }
        else if (l.replace(/\r$/, '') === '\\.') current = null;
        else found[current]++;
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(found) : reject(new Error(`pg_restore data stream exit ${code}`))));
  });
  const names = Object.keys(before.rows);
  const outOfRange = names.filter((n) => { const got = inArchive[n] ?? 0; return got < Math.min(before.rows[n], after.rows[n]) || got > Math.max(before.rows[n], after.rows[n]); });
  const size = fs.statSync(file).size;
  if (outOfRange.length || size < 10_000 || toc.filter((l) => / TABLE DATA public /.test(l)).length !== names.length) { throw new Error(`The archive does not match the server (${outOfRange.join(', ') || 'table list or size'}). Do not rely on ${file}.`); }
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  fs.writeFileSync(`${file}.sha256`, `${sha}  ${path.basename(file)}\n`);

  console.log(`[backup] Database "${database}" (PostgreSQL ${before.info.version}; ${before.info.migrations} migrations, latest ${before.info.latest}).`);
  console.log(`[backup] pg_dump ${(spawnSync(tool('pg_dump'), ['--version'], { encoding: 'utf8' }).stdout.match(/[\d.]+/) ?? [''])[0]}, TLS ${tls} against the CA file${tls === 'verify-ca' ? ' (this client cannot parse the certificate\'s address entries, so the host name is not checked)' : ''}.`);
  console.log(`[backup] File: ${file}`);
  console.log(`[backup] Size: ${size} bytes. SHA-256: ${sha}`);
  console.log(`[backup] Verified: pg_restore --list reads it (${toc.filter((l) => / TABLE public /.test(l)).length} tables); all ${names.length} tables have the server's row counts (${Object.values(inArchive).reduce((a, b) => a + b, 0)} rows); tables that changed during the dump: ${names.filter((n) => before.rows[n] !== after.rows[n]).join(', ') || 'none'}.`);
  console.log(`[backup] Key tables: ${['Article', 'ArticleImport', 'User', 'MediaItem', 'FaqEntry', 'Sport', 'Author', 'RedirectRule'].filter((n) => n in inArchive).map((n) => `${n} ${inArchive[n]}`).join(', ')}.`);
}

main().catch((err) => { console.error(`[backup] FAILED: ${err instanceof Error ? err.message : err}`); process.exit(1); });
