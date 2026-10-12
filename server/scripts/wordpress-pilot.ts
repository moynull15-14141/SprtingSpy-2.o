/**
 * WordPress migration pilot (five posts) against the ISOLATED pilot database.
 *
 *   npm run migration:wordpress-pilot -- setup      create the local pilot database + pilot env file, apply migrations
 *   npm run migration:wordpress-pilot -- check      isolation check only (writes nothing)
 *   npm run migration:wordpress-pilot -- import     import the five pilot posts as review-required drafts
 *   npm run migration:wordpress-pilot -- import-all create the approved sports and author profiles, then import every remaining post
 *   npm run migration:wordpress-pilot -- plan       what import-all would create or skip (writes nothing to the CMS)
 *   npm run migration:wordpress-pilot -- verify     check every imported article in the destination (read-only)
 *   npm run migration:wordpress-pilot -- label      add the "WordPress Import" record to articles imported before it existed
 *   npm run migration:wordpress-pilot -- serve      run the CMS on this machine against the pilot database, to look at the imports
 *   npm run migration:wordpress-pilot -- rollback   remove what the pilot created (untouched drafts only)
 *   npm run migration:wordpress-pilot -- status     what the pilot manifest lists
 *
 * Every command refuses to run unless checkPilotIsolation() passes for the
 * pilot-only env file (migration-inventory/pilot.env): a database named
 * sportingspy_wp_pilot on this machine, local media storage, no R2/S3 keys
 * and no outbound integrations. The project .env is never read. There is no
 * option to publish or schedule, to create redirects, or to target another
 * database: the destination is always the isolated local pilot database.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { PILOT_DATABASE_NAME } from '../wordpressImport/isolation';
import { backfillImportSources, deactivatePilotStaff, ensurePilotStaff, startPilotServer } from '../wordpressImport/pilot';
import { assertIsolated, destinationSnapshot, ensureEntities, importPilot, loadManifest, locateBackup, openPilotDb, pilotEnvironment, rollbackPilot, runWithPilot, removePilotStaff, PILOT_DIR, PILOT_ENV_FILE, PILOT_IDS, PILOT_MANIFEST, type ImportReport, type PilotSession } from '../wordpressImport/pilot';
import { verifyImport } from '../wordpressImport/verifyImport';

const [command, ...rest] = process.argv.slice(2);
const option = (name: string, fallback: string) => { const i = rest.indexOf(`--${name}`); return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback; };
const PILOT_DB = 'sportingspy_wp_pilot';
const LOOPBACK = ['localhost', '127.0.0.1', '::1', '[::1]'];
const COUNTED = ['Article', 'ArticleMedia', 'MediaItem', 'FaqEntry', 'Author', 'Sport', 'SportEvent', 'EventEdition', 'RedirectRule', 'User'];

export async function counts(db: pg.Client): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of COUNTED) out[table] = (await db.query(`select count(*)::int as n from "${table}"`)).rows[0].n;
  return out;
}

async function setup() {
  if (!PILOT_DATABASE_NAME.test(PILOT_DB)) throw new Error('Internal error: the pilot database name is not a pilot name.');
  if (!fs.existsSync(PILOT_ENV_FILE)) {
    // The local server's login comes from a local-development credentials file, never from the project .env.
    const source = option('credentials-from', 'backups/.env.before-aiven');
    if (/(^|[\\/])\.env$/.test(source)) throw new Error('The project .env is never used for the pilot.');
    const line = fs.readFileSync(source, 'utf8').split(/\r?\n/).find((l) => /^DATABASE_URL=/.test(l));
    if (!line) throw new Error(`${source} has no DATABASE_URL.`);
    const url = new URL(line.replace(/^DATABASE_URL=/, '').replace(/^"(.*)"$/, '$1'));
    if (!LOOPBACK.includes(url.hostname.toLowerCase())) throw new Error(`${source} does not point at this machine (${url.hostname}); refusing to derive a pilot database from it.`);
    url.pathname = `/${PILOT_DB}`;
    fs.mkdirSync(path.dirname(PILOT_ENV_FILE), { recursive: true });
    fs.writeFileSync(PILOT_ENV_FILE, ['# WordPress migration pilot ONLY: local database, local media, no outbound services.', '# Loaded through DOTENV_CONFIG_PATH instead of the project .env. Not committed (migration-inventory/ is git-ignored).',
      `DATABASE_URL="${url.toString()}"`, 'APP_ENV="development"', 'AUTH_MODE="development"', 'DEV_LOGIN_BYPASS="false"', 'PORT="3111"', 'HOST="127.0.0.1"', 'ALLOWED_ORIGIN="http://127.0.0.1:3111"', 'TRUST_PROXY="false"',
      'MEDIA_STORAGE_PROVIDER="local"', 'MEDIA_LOCAL_DIR="migration-inventory/pilot-media"', ''].join('\n'));
    console.log(`[pilot] Wrote ${PILOT_ENV_FILE} (database ${PILOT_DB} on ${url.hostname}).`);
  }
  const env = pilotEnvironment();
  assertIsolated(env, 'set up the pilot database');
  const target = new URL(env.DATABASE_URL);
  if (decodeURIComponent(target.pathname.slice(1)) !== PILOT_DB || !LOOPBACK.includes(target.hostname.toLowerCase())) throw new Error('The pilot env file does not name exactly sportingspy_wp_pilot on this machine.');

  // Create the database from the maintenance database of the same local server.
  const admin = new URL(target.toString()); admin.pathname = '/postgres';
  const server = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 8000 });
  await server.connect();
  try {
    const where = (await server.query("select coalesce(host(inet_server_addr()), 'local socket') as address")).rows[0].address;
    if (!['127.0.0.1', '::1', 'local socket'].includes(where)) throw new Error(`The PostgreSQL server answers from ${where}, not from this machine.`);
    const exists = (await server.query('select 1 from pg_database where datname = $1', [PILOT_DB])).rowCount;
    if (exists) console.log(`[pilot] Database ${PILOT_DB} already exists on ${where}; not recreated.`);
    else {
      // A copy of the local development database gives the pilot the sports, events and editions that already exist in the CMS.
      const template = option('template', 'sportingspy');
      if (!/^[a-z0-9_]+$/.test(template) || PILOT_DATABASE_NAME.test(template)) throw new Error('Invalid template database name.');
      const hasTemplate = (await server.query('select 1 from pg_database where datname = $1', [template])).rowCount;
      await server.query(hasTemplate ? `create database "${PILOT_DB}" template "${template}"` : `create database "${PILOT_DB}"`);
      console.log(`[pilot] Created database ${PILOT_DB} on ${where}${hasTemplate ? ` as a copy of the local database "${template}"` : ' (empty)'}.`);
    }
  } finally { await server.end(); }

  // Existing migrations, applied to the pilot database only. The status output must name it before anything is applied.
  const prisma = (args: string[]) => spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], { env: env as NodeJS.ProcessEnv, encoding: 'utf8', windowsHide: true });
  const status = prisma(['migrate', 'status']);
  const statusText = `${status.stdout}${status.stderr}`;
  if (!statusText.includes(`"${PILOT_DB}"`) || !/"localhost|"127\.0\.0\.1|localhost:\d+|127\.0\.0\.1:\d+/.test(statusText)) throw new Error(`Prisma does not report the pilot database as its target; nothing was migrated.\n${statusText.slice(0, 600)}`);
  const deploy = prisma(['migrate', 'deploy']);
  const deployText = `${deploy.stdout}${deploy.stderr}`;
  if (deploy.status !== 0 || !deployText.includes(`"${PILOT_DB}"`)) throw new Error(`prisma migrate deploy failed.\n${deployText.slice(0, 800)}`);
  console.log(`[pilot] Migrations: ${deployText.split(/\r?\n/).filter((l) => /migrations? found|No pending|applied|Applying/i.test(l)).join(' | ')}`);

  fs.mkdirSync(env.MEDIA_LOCAL_DIR, { recursive: true });
  fs.mkdirSync(PILOT_DIR, { recursive: true });
  const db = await openPilotDb(env, 'record the pilot baseline');
  try {
    const baselineFile = path.join(PILOT_DIR, 'baseline.json');
    if (!fs.existsSync(baselineFile)) fs.writeFileSync(baselineFile, JSON.stringify({ database: PILOT_DB, recordedAt: new Date().toISOString(), counts: await counts(db) }, null, 2));
    console.log(`[pilot] Baseline: ${fs.readFileSync(baselineFile, 'utf8').replace(/\s+/g, ' ')}`);
  } finally { await db.end(); }
}

/** The dry run against the destination's own state: its sports, editions and author profiles decide what is ready and which links can be rewritten. */
const DESTINATION_DRY_RUN = path.join(PILOT_DIR, 'dry-run');
async function destinationDryRun(session: PilotSession): Promise<any> {
  const snapshotFile = path.join(PILOT_DIR, 'cms-snapshot.json');
  fs.writeFileSync(snapshotFile, JSON.stringify(await destinationSnapshot(session), null, 2));
  const { wxrFile, zipFile } = locateBackup();
  // The dry run has no database code; it gets a bare environment and only file paths.
  const bare = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|HOME)$/i.test(k)));
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'server/scripts/wordpress-dry-run.ts', '--wxr', wxrFile, '--uploads-zip', zipFile, '--cms', snapshotFile, '--out', DESTINATION_DRY_RUN], { env: bare as NodeJS.ProcessEnv, encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 });
  if (run.status !== 0) throw new Error(`The dry run against the destination failed.\n${(run.stderr || run.stdout).slice(-800)}`);
  return JSON.parse(fs.readFileSync(path.join(DESTINATION_DRY_RUN, 'manifest.json'), 'utf8'));
}

async function importAll(planOnly: boolean) {
  const batchSize = Math.min(10, Math.max(1, Number(option('batch', '5')) || 5));
  const outcome = await runWithPilot(async (session) => {
    const entities = planOnly ? null : await ensureEntities(session);
    if (entities) console.log(`[import] Sports created: ${entities.sportsCreated.join(', ') || 'none'}; already there: ${entities.sportsExisting.join(', ') || 'none'}. Author profiles created: ${entities.authorsCreated.join(', ') || 'none'}; already there: ${entities.authorsExisting.join(', ') || 'none'}.`);
    const dry = await destinationDryRun(session);
    const ctx = { ...session, dryRunDir: DESTINATION_DRY_RUN };
    const all: string[] = dry.posts.map((p: any) => p.wordpressId);
    const total: ImportReport = { created: [], resumed: [], wouldCreate: [], skipped: [], refused: [], media: { uploaded: 0, reused: 0 }, faq: 0, authorsCreated: [] };
    for (let i = 0; i < all.length; i += batchSize) {
      const batch = all.slice(i, i + batchSize);
      const r = await importPilot(ctx, batch, { allowed: all, planOnly, onProgress: (line) => console.log(`[import]   ${line}`) });
      for (const key of ['created', 'resumed', 'wouldCreate', 'skipped', 'refused', 'authorsCreated'] as const) (total[key] as unknown[]).push(...r[key]);
      total.media.uploaded += r.media.uploaded; total.media.reused += r.media.reused; total.faq += r.faq;
      console.log(`[import] Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(all.length / batchSize)} (${batch.join(', ')}): created ${r.created.length}, would create ${r.wouldCreate.length}, skipped ${r.skipped.length}, refused ${r.refused.length}. Running total: ${total.created.length} created, ${total.skipped.length} skipped, ${total.refused.length} refused.`);
    }
    const verification = planOnly ? null : await verifyImport(ctx, DESTINATION_DRY_RUN);
    const row = (await session.db.query("select current_database() as name, coalesce(host(inet_server_addr()), 'local socket') as address")).rows[0];
    return { destination: { database: row.name, address: row.address, mediaStorage: `local: ${session.env.MEDIA_LOCAL_DIR}` }, mode: planOnly ? 'plan (nothing written to the CMS)' : 'import', entities, import: total, links: dry.summary.links, verification, counts: await counts(session.db) };
  });
  if (!planOnly) fs.writeFileSync(path.join(PILOT_DIR, 'import-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), ...outcome }, null, 2));
  console.log(JSON.stringify({ ...outcome, import: { ...outcome.import, skipped: outcome.import.skipped.length, created: outcome.import.created.length, wouldCreate: outcome.import.wouldCreate.length } }, null, 2));
  if (outcome.import.refused.length || (outcome.verification && !outcome.verification.ok)) process.exitCode = 1;
}

async function main() {
  if (command === 'setup') return setup();
  if (command === 'serve') {
    // The same isolated environment as the import: local pilot database, local media, project .env never loaded.
    const env = pilotEnvironment();
    assertIsolated(env, 'serve the pilot');
    const db = await openPilotDb(env, 'serve the pilot');
    const [admin] = await ensurePilotStaff(db);
    const server = await startPilotServer(env);
    const open = server.base.replace('127.0.0.1', 'localhost');
    console.log(`[pilot] Running at ${open}/ (database sportingspy_wp_pilot, local media). CMS: ${open}/admin/`);
    console.log(`[pilot] Sign in with ${admin.email} and password ${admin.password} (this throwaway Admin exists only in the pilot database; the password changes on every start).`);
    const stop = async () => { await server.stop(); await deactivatePilotStaff(db).catch(() => undefined); await db.end().catch(() => undefined); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    await new Promise(() => undefined);
  }
  if (command === 'label') {
    const env = pilotEnvironment();
    const db = await openPilotDb(env, 'label the imported articles');
    try { console.log(JSON.stringify(await backfillImportSources({ env, db, dryRunDir: fs.existsSync(DESTINATION_DRY_RUN) ? DESTINATION_DRY_RUN : undefined } as never), null, 2)); } finally { await db.end(); }
    return;
  }
  if (command === 'import-all') return importAll(false);
  if (command === 'plan') return importAll(true);
  if (command === 'verify') {
    const result = await runWithPilot((session) => verifyImport({ ...session, dryRunDir: DESTINATION_DRY_RUN }, fs.existsSync(DESTINATION_DRY_RUN) ? DESTINATION_DRY_RUN : 'migration-inventory/wordpress-dry-run'));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === 'check') {
    const env = pilotEnvironment();
    assertIsolated(env, 'isolation check');
    const db = await openPilotDb(env, 'isolation check');
    const row = (await db.query("select current_database() as name, coalesce(host(inet_server_addr()), 'local socket') as address")).rows[0];
    await db.end();
    console.log(`[pilot] Isolated: database "${row.name}" at ${row.address}; media ${env.MEDIA_STORAGE_PROVIDER} in ${env.MEDIA_LOCAL_DIR}; R2/S3 and outbound settings empty; project .env not loaded.`);
    return;
  }
  if (command === 'status') {
    const env = pilotEnvironment();
    assertIsolated(env, 'read the pilot manifest');
    const m = loadManifest(PILOT_DB);
    console.log(JSON.stringify({ manifest: PILOT_MANIFEST, posts: Object.fromEntries(Object.entries(m.posts).map(([id, p]) => [id, { articleId: p.articleId, path: p.path, faq: p.faq.length, media: p.mediaFiles.length }])), media: Object.keys(m.media).length, authors: m.authors }, null, 2));
    return;
  }
  if (command === 'import') {
    if (rest.some((a) => /^--(all|ids?|posts?|publish|schedule|database|env)/.test(a))) throw new Error(`The pilot imports exactly WordPress IDs ${PILOT_IDS.join(', ')} into the pilot database; it takes no options.`);
    const report = await runWithPilot((session) => importPilot(session));
    console.log(JSON.stringify(report, null, 2));
    if (report.refused.length) process.exitCode = 1;
    return;
  }
  if (command === 'rollback') {
    const report = await runWithPilot(async (session) => { const r = await rollbackPilot(session); if (!Object.keys(loadManifest(PILOT_DB).posts).length) await removePilotStaff(session.db); return r; });
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.error('Usage: npm run migration:wordpress-pilot -- setup | check | serve | import | import-all | plan | verify | rollback | status');
  process.exitCode = 2;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve('server/scripts/wordpress-pilot.ts')) {
  main().catch((err) => { console.error(`[pilot] ${err instanceof Error ? err.message : err}`); process.exit(1); });
}
