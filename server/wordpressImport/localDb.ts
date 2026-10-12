/**
 * Local-only databases and environments for development and tests.
 *
 * Everything here works from an env FILE of its own (never the project .env)
 * and checks, before anything runs, that the database in it is on this
 * machine — first from the URL, then by asking the server itself.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { checkPilotIsolation, MUST_BE_EMPTY, PILOT_DATABASE_NAME } from './isolation';

const LOOPBACK = ['localhost', '127.0.0.1', '::1', '[::1]'];
const SERVER_LOOPBACK = ['127.0.0.1', '::1', 'local socket'];
const SYSTEM_VARIABLES = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PROGRAMDATA', 'PROGRAMFILES', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'HOME', 'LANG'];

export class LocalTargetError extends Error {}

export function readEnvFile(file: string): Record<string, string> {
  if (/(^|[\\/])\.env$/.test(file)) throw new LocalTargetError('The project .env is not a local-only env file.');
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

/**
 * A complete process environment built from an env file: operating-system
 * variables, every documented app setting blanked, then the file. Because
 * every known setting is defined (even if empty), neither dotenv nor Next.js
 * can fill one in from the project .env.
 */
export function environmentFrom(envFile: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && SYSTEM_VARIABLES.includes(key.toUpperCase())) env[key] = value;
  const names = new Set<string>(MUST_BE_EMPTY);
  for (const m of fs.readFileSync('.env.example', 'utf8').matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)) names.add(m[1]);
  for (const name of names) env[name] = '';
  Object.assign(env, readEnvFile(envFile), extra);
  env.DOTENV_CONFIG_PATH = envFile;
  return env;
}

/** Throws unless the environment's database is a local development database, confirmed by the server it connects to. */
export async function verifyLocalDatabase(env: Record<string, string | undefined>): Promise<{ name: string; address: string }> {
  const check = checkDatabaseUrlIsLocalDev(env.DATABASE_URL);
  if (!check.safe) throw new LocalTargetError(`Not a local database: ${check.reason}`);
  // A public media address may be set so images are READ from where the live site serves them; it is not a credential and nothing is written there.
  if ((env.MEDIA_STORAGE_PROVIDER || 'local') !== 'local' || MUST_BE_EMPTY.some((key) => key !== 'MEDIA_PUBLIC_BASE_URL' && env[key])) throw new LocalTargetError('The local environment must use local media storage and carry no storage or outbound keys.');
  const client = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 8000 });
  await client.connect();
  try {
    const row = (await client.query("select current_database() as name, coalesce(host(inet_server_addr()), 'local socket') as address")).rows[0];
    if (!SERVER_LOOPBACK.includes(row.address)) throw new LocalTargetError(`The database server answers from ${row.address}, not from this machine.`);
    return row;
  } finally { await client.end(); }
}

/** The local PostgreSQL login, taken from a local-development credentials file (never the project .env). The URL is returned, never printed. */
export function localServerUrl(credentialsFile: string, database: string): URL {
  if (/(^|[\\/])\.env$/.test(credentialsFile)) throw new LocalTargetError('The project .env is never used as a credentials source.');
  const line = fs.readFileSync(credentialsFile, 'utf8').split(/\r?\n/).find((l) => /^DATABASE_URL=/.test(l));
  if (!line) throw new LocalTargetError(`${credentialsFile} has no DATABASE_URL.`);
  const url = new URL(line.replace(/^DATABASE_URL=/, '').replace(/^"(.*)"$/, '$1'));
  if (!LOOPBACK.includes(url.hostname.toLowerCase())) throw new LocalTargetError(`${credentialsFile} does not point at this machine.`);
  url.pathname = `/${database}`;
  return url;
}

/**
 * Loads a verified production backup into the LOCAL database "sportingspy_live_copy",
 * replacing that local copy. Data only ever flows this way: from the backup
 * file to this machine. The dump must match the .sha256 file beside it.
 */
export async function restoreLocalCopy(spec: { name: string; dumpFile: string; pgBin: string; credentialsFile?: string }): Promise<{ tables: number; rows: number; articles: number; published: number }> {
  if (spec.name !== 'sportingspy_live_copy') throw new LocalTargetError('Only the local database "sportingspy_live_copy" is ever replaced by a restore.');
  const recorded = fs.existsSync(`${spec.dumpFile}.sha256`) ? fs.readFileSync(`${spec.dumpFile}.sha256`, 'utf8').split(/\s+/)[0] : '';
  const actual = crypto.createHash('sha256').update(fs.readFileSync(spec.dumpFile)).digest('hex');
  if (!recorded || recorded !== actual) throw new LocalTargetError('The backup file does not match its recorded SHA-256 (or has none). Take a new one with npm run db:backup:live.');
  const target = localServerUrl(spec.credentialsFile ?? 'backups/.env.before-aiven', spec.name);
  const admin = new URL(target.toString()); admin.pathname = '/postgres';
  const server = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 8000 });
  await server.connect();
  try {
    const where = (await server.query("select coalesce(host(inet_server_addr()), 'local socket') as address")).rows[0].address;
    if (!SERVER_LOOPBACK.includes(where)) throw new LocalTargetError(`The PostgreSQL server answers from ${where}, not from this machine.`);
    await server.query(`drop database if exists "${spec.name}" with (force)`);
    await server.query(`create database "${spec.name}"`);
  } finally { await server.end(); }
  const exe = process.platform === 'win32' ? '.exe' : '';
  const password = decodeURIComponent(target.password);
  const done = spawnSync(path.join(spec.pgBin, `pg_restore${exe}`), ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', spec.name, spec.dumpFile], { env: { ...process.env, PGHOST: target.hostname, PGPORT: target.port || '5432', PGUSER: decodeURIComponent(target.username), PGPASSWORD: password } as NodeJS.ProcessEnv, encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 });
  if (done.status !== 0) throw new LocalTargetError(`pg_restore failed: ${String(done.stderr).split(password).join('***').slice(0, 300)}`);
  const copy = new pg.Client({ connectionString: target.toString() });
  await copy.connect();
  try {
    const names = (await copy.query("select c.relname as name from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r'")).rows.map((r) => r.name as string);
    let rows = 0;
    for (const n of names) rows += (await copy.query(`select count(*)::int as n from "${n}"`)).rows[0].n;
    const a = (await copy.query(`select count(*)::int as articles, (count(*) filter (where status = 'published'))::int as published from "Article"`)).rows[0];
    return { tables: names.length, rows, articles: a.articles, published: a.published };
  } finally { await copy.end(); }
}

export interface DisposableDatabase { name: string; envFile: string; port: number; mediaDir: string; credentialsFile?: string; template?: string; extraEnv?: Record<string, string> }

/**
 * (Re)creates a disposable local test database as a copy of a local
 * development database, writes its env file, and applies the migrations to
 * it. Only a database whose name is a pilot/test name can be dropped here.
 */
export async function recreateDisposableDatabase(spec: DisposableDatabase): Promise<Record<string, string>> {
  if (!PILOT_DATABASE_NAME.test(spec.name) || spec.name === 'sportingspy_wp_pilot') throw new LocalTargetError(`"${spec.name}" is not a disposable test database name (the populated pilot database is never recreated).`);
  const target = localServerUrl(spec.credentialsFile ?? 'backups/.env.before-aiven', spec.name);
  fs.mkdirSync(path.dirname(spec.envFile), { recursive: true });
  fs.writeFileSync(spec.envFile, ['# Disposable local TEST database for the live-import tests. Recreated by the test; not committed.', `DATABASE_URL="${target.toString()}"`, 'APP_ENV="development"', 'AUTH_MODE="development"', 'DEV_LOGIN_BYPASS="false"', `PORT="${spec.port}"`, 'HOST="127.0.0.1"', `ALLOWED_ORIGIN="http://127.0.0.1:${spec.port}"`, 'TRUST_PROXY="false"', 'MEDIA_STORAGE_PROVIDER="local"', `MEDIA_LOCAL_DIR="${spec.mediaDir}"`, ...Object.entries(spec.extraEnv ?? {}).map(([k, v]) => `${k}="${v}"`), ''].join('\n'));
  const env = environmentFrom(spec.envFile, { SPORTINGSPY_REQUIRE_PILOT_ISOLATION: '1' });
  const isolation = checkPilotIsolation(env);
  if (!isolation.safe) throw new LocalTargetError(`The test environment is not isolated: ${isolation.problems.join(' ')}`);

  const admin = new URL(target.toString()); admin.pathname = '/postgres';
  const server = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 8000 });
  await server.connect();
  try {
    const where = (await server.query("select coalesce(host(inet_server_addr()), 'local socket') as address")).rows[0].address;
    if (!SERVER_LOOPBACK.includes(where)) throw new LocalTargetError(`The PostgreSQL server answers from ${where}, not from this machine.`);
    const template = spec.template ?? 'sportingspy';
    if (!/^[a-z0-9_]+$/.test(template) || PILOT_DATABASE_NAME.test(template)) throw new LocalTargetError('Invalid template database name.');
    await server.query(`drop database if exists "${spec.name}" with (force)`);
    await server.query(`create database "${spec.name}" template "${template}"`);
  } finally { await server.end(); }

  const prisma = (args: string[]) => spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], { env: env as NodeJS.ProcessEnv, encoding: 'utf8', windowsHide: true });
  const status = prisma(['migrate', 'status']);
  if (!`${status.stdout}${status.stderr}`.includes(`"${spec.name}"`)) throw new LocalTargetError('Prisma does not report the test database as its target; nothing was migrated.');
  const deploy = prisma(['migrate', 'deploy']);
  if (deploy.status !== 0) throw new LocalTargetError(`prisma migrate deploy failed on the test database.\n${`${deploy.stdout}${deploy.stderr}`.slice(-600)}`);
  fs.rmSync(spec.mediaDir, { recursive: true, force: true });
  fs.mkdirSync(spec.mediaDir, { recursive: true });
  return env;
}
