/**
 * Runs a project command against the LOCAL development database only.
 *
 *   npm run local -- init                 create .env.local-dev (once)
 *   npm run local -- check                show which database it points at
 *   npm run local -- dev                  = npm run dev, on the local database
 *   npm run local -- db:migrate:deploy    any npm script, on the local database
 *   npm run local -- test:phase-j
 *
 *   npm run local -- live-copy:refresh [<public media address>]   replace the local copy of production with the newest verified backup
 *   npm run local -- live-copy dev                                the CMS on that copy: production data from a backup, images read from the public media address
 *
 * The command gets its whole configuration from .env.local-dev: every
 * documented setting is defined there or blanked, so nothing is taken from
 * the project .env (which may point at the hosted database). Before the
 * command starts, the database is checked twice: the URL must be on this
 * machine, and the server itself must answer from this machine.
 */
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { environmentFrom, localServerUrl, restoreLocalCopy, verifyLocalDatabase } from '../wordpressImport/localDb';

const LIVE_COPY_ENV = '.env.live-copy';
const LIVE_COPY_DB = 'sportingspy_live_copy';
const first = process.argv.slice(2);
// "live-copy <script>" runs the script on the local copy of production instead of the development database.
const onLiveCopy = first[0] === 'live-copy';
const ENV_FILE = onLiveCopy ? LIVE_COPY_ENV : '.env.local-dev';
const [command, ...given] = onLiveCopy ? first.slice(1) : first;
// "npm run local -- <script> -- <arguments>" and "npm run local -- <script> <arguments>" mean the same.
const args = given[0] === '--' ? given.slice(1) : given;

async function main() {
  if (!command) { console.error('Usage: npm run local -- init | check | <npm script> [arguments]'); process.exitCode = 2; return; }
  if (command === 'live-copy:refresh') {
    // Production data comes from a verified backup file, never from a live connection, and only ever flows to this machine.
    const dir = path.join(os.homedir(), 'SportingSpy-backups');
    const dump = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.dump')).map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs).pop() : undefined;
    if (!dump) throw new Error(`No backup in ${dir}. Take one with: npm run db:backup:live`);
    const result = await restoreLocalCopy({ name: LIVE_COPY_DB, dumpFile: dump, pgBin: process.env.PG_CLIENT_BIN ?? path.join(os.homedir(), 'pg18-client', 'bin') });
    if (!fs.existsSync(LIVE_COPY_ENV)) {
      const url = localServerUrl('backups/.env.before-aiven', LIVE_COPY_DB);
      const mediaBase = (args[0] ?? '').replace(/\/+$/, '');
      fs.writeFileSync(LIVE_COPY_ENV, ['# LOCAL copy of production, restored from a backup file. Used by "npm run local -- live-copy <script>". Not committed.', '# Changes made here stay on this machine. Images are read from the public media address; uploads made here are local only.', `DATABASE_URL="${url.toString()}"`, 'APP_ENV="development"', 'AUTH_MODE="development"', 'DEV_LOGIN_BYPASS="false"', 'PORT="3000"', 'HOST="127.0.0.1"', 'ALLOWED_ORIGIN="http://localhost:3000"', 'TRUST_PROXY="false"', 'MEDIA_STORAGE_PROVIDER="local"', 'MEDIA_LOCAL_DIR="storage/live-copy-media"', ...(/^https:\/\/[a-z0-9.-]+$/i.test(mediaBase) ? [`MEDIA_PUBLIC_BASE_URL="${mediaBase}"`] : []), ''].join('\n'));
    }
    console.log(`[local] "${LIVE_COPY_DB}" now holds ${path.basename(dump)}: ${result.tables} tables, ${result.rows} rows, ${result.articles} articles (${result.published} published).`);
    return;
  }
  if (command === 'init') {
    if (fs.existsSync(ENV_FILE)) { console.log(`[local] ${ENV_FILE} already exists; left as it is.`); return; }
    const database = args[0] ?? 'sportingspy';
    const url = localServerUrl('backups/.env.before-aiven', database);
    fs.writeFileSync(ENV_FILE, ['# LOCAL development only. Used by "npm run local -- <script>" instead of .env. Not committed (.env* is git-ignored).', `DATABASE_URL="${url.toString()}"`, 'APP_ENV="development"', 'AUTH_MODE="development"', 'DEV_LOGIN_BYPASS="false"', 'PORT="3000"', 'HOST="127.0.0.1"', 'ALLOWED_ORIGIN="http://localhost:3000"', 'TRUST_PROXY="false"', 'MEDIA_STORAGE_PROVIDER="local"', 'MEDIA_LOCAL_DIR="storage/media"', ''].join('\n'));
    console.log(`[local] Wrote ${ENV_FILE} for the local database "${database}".`);
    return;
  }
  if (!fs.existsSync(ENV_FILE)) { console.error(`[local] ${ENV_FILE} does not exist. Create it with: npm run local -- init`); process.exitCode = 1; return; }
  const env = environmentFrom(ENV_FILE);
  const db = await verifyLocalDatabase(env);
  console.log(`[local] Database "${db.name}" at ${db.address} (this machine); media storage local; project .env not used.`);
  if (command === 'check') return;
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', command, ...(args.length ? ['--', ...args] : [])], { env: env as NodeJS.ProcessEnv, stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
}

main().catch((err) => { console.error(`[local] ${err instanceof Error ? err.message : err}`); process.exit(1); });
