/**
 * WordPress migration, LIVE mode: plan / import / verify / rollback through
 * the CMS Admin API of an approved site. Plan-only unless --execute and the
 * exact --confirm phrase are given. See server/wordpressImport/live.ts.
 *
 *   npm run migration:wordpress-live -- plan     --target https://sportingspy.com [--only 3534,1163]
 *   npm run migration:wordpress-live -- import   --target … [--only …] [--batch 5] [--pause 20] --execute --confirm "IMPORT 5 POSTS INTO sportingspy.com"
 *       (--pause: seconds to wait before each image upload; the run stops at once if the site stops answering)
 *   npm run migration:wordpress-live -- verify   --target …
 *   npm run migration:wordpress-live -- rollback --target … [--execute --confirm "ROLLBACK 5 POSTS FROM sportingspy.com"]
 *   npm run migration:wordpress-live -- status   --target …        (reads the local manifest only; no network)
 *
 * Sign-in: an Admin's e-mail, password and (if the account has two-factor
 * authentication) the current 6-digit code. They are asked for on the
 * terminal, or read from SPORTINGSPY_IMPORT_EMAIL / SPORTINGSPY_IMPORT_PASSWORD /
 * SPORTINGSPY_IMPORT_TOTP. They are never written to disk or printed.
 *
 * --local-test allows a server on this machine as the target (for testing).
 * This command opens no database connection and reads no .env file.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { loadManifest } from '../wordpressImport/pilot';
import { LoginError } from '../wordpressImport/pilot';
import { openLiveSession, planFingerprint, resolveLiveTarget, runLiveImport, runLiveRollback, verifyLive, LiveTargetError, LIVE_TARGETS, type LiveCredentials } from '../wordpressImport/live';

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(`--${name}`);
const option = (name: string) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };

function ask(question: string, hidden = false): Promise<string> {
  if (!process.stdin.isTTY) throw new LiveTargetError(`${question.replace(/:\s*$/, '')} is needed. Run this in a terminal, or set the SPORTINGSPY_IMPORT_* variables.`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => { if (s.includes(question)) process.stdout.write(question); };
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); }));
}

/** Credentials for this run only. Taken out of the environment as soon as they are read. */
async function credentials(): Promise<LiveCredentials> {
  const take = (name: string) => { const v = process.env[name]; delete process.env[name]; return v; };
  const email = take('SPORTINGSPY_IMPORT_EMAIL') ?? await ask('Admin e-mail: ');
  const password = take('SPORTINGSPY_IMPORT_PASSWORD') ?? await ask('Password: ', true);
  return { email, password, totpCode: take('SPORTINGSPY_IMPORT_TOTP') };
}

async function main() {
  if (!['plan', 'import', 'verify', 'rollback', 'status'].includes(command)) {
    console.error(`Usage: npm run migration:wordpress-live -- plan | import | verify | rollback | status  --target <${LIVE_TARGETS.join(' | ')}>`);
    process.exitCode = 2; return;
  }
  const target = resolveLiveTarget(option('target') ?? '', { allowLocalTest: flag('local-test') });
  if (command === 'status') {
    const file = path.join(target.dir, 'manifest.json');
    if (!fs.existsSync(file)) { console.log(`[live] No import manifest for ${target.origin} yet.`); return; }
    const m = loadManifest(target.origin, file);
    console.log(JSON.stringify({ target: target.origin, manifest: file, posts: Object.keys(m.posts).length, unfinished: Object.entries(m.posts).filter(([, p]) => p.complete === false).map(([id]) => id), media: Object.keys(m.media).length, sports: Object.keys(m.sports ?? {}), authors: Object.keys(m.authors), lastEntries: m.history.slice(-5) }, null, 2));
    return;
  }
  console.log(`[live] Target: ${target.origin}${target.local ? ' (LOCAL TEST SERVER)' : ''}. ${command === 'import' && flag('execute') ? 'Import requested.' : 'Plan-only: nothing will be written.'}`);
  let login = await credentials();
  let session;
  try { session = await openLiveSession(target, login); }
  catch (err) {
    if (!(err instanceof LoginError) || !err.totpRequired || login.totpCode) throw err;
    login = { ...login, totpCode: await ask('6-digit authentication code: ') };
    session = await openLiveSession(target, login);
  }
  login = { email: '', password: '' };
  const only = option('only')?.split(',').map((s) => s.trim()).filter(Boolean);
  try {
    if (command === 'verify') { const v = await verifyLive({ target, ...session }); console.log(JSON.stringify(v, null, 2)); if (!v.ok) process.exitCode = 1; return; }
    if (command === 'rollback') {
      const r = await runLiveRollback({ target, ...session }, { execute: flag('execute'), confirm: option('confirm') });
      console.log(JSON.stringify(r, null, 2));
      if (!r.executed) console.log(`[live] Plan-only. To remove these untouched drafts: --execute --confirm "${r.confirmation}"`);
      return;
    }
    const result = await runLiveImport({ target, ...session }, { only, execute: command === 'import' && flag('execute'), confirm: option('confirm'), batchSize: Number(option('batch')) || undefined, uploadPauseSeconds: option('pause') === undefined ? undefined : Number(option('pause')), onProgress: (line) => console.log(`[live]   ${line}`) });
    console.log(JSON.stringify({ ...result, planFingerprint: planFingerprint(result.plan) }, null, 2));
    if (!result.executed && result.plan.wouldCreate.length + result.plan.toResume.length) console.log(`[live] Plan-only. Nothing was written. To import: npm run migration:wordpress-live -- import --target ${target.origin}${only ? ` --only ${only.join(',')}` : ''}${target.local ? ' --local-test' : ''} --execute --confirm "${result.plan.confirmation}"`);
    if (result.import?.refused.length || (result.verification && !result.verification.ok)) process.exitCode = 1;
  } finally { await session.api.logout(); }
}

main().catch((err) => { console.error(`[live] ${err instanceof Error ? err.message : err}`); process.exit(1); });
