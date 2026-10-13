/**
 * WordPress migration PILOT: imports the five approved pilot posts into the
 * isolated pilot database, and removes them again.
 *
 * Isolation. Nothing here reads the project .env or process.env for its
 * target: the database URL and every setting come from the pilot-only env
 * file, and checkPilotIsolation() is enforced before the database is opened,
 * before the server is started and before every import or rollback. The
 * server child gets a minimal environment (system variables + the pilot file
 * + every other known setting blanked) and re-checks itself in-process
 * (SPORTINGSPY_REQUIRE_PILOT_ISOLATION), so no value from the project .env
 * can reach it.
 *
 * Reuse. Articles, media and FAQ entries are created through the CMS's own
 * API (POST /api/articles with requireReview, /api/media/upload,
 * /api/faq/import), so every existing validation, audit entry and workflow
 * rule applies. The content comes from the dry run's output: the validated
 * documents, the final mapping and the media list.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import pg from 'pg';
import { hashPassword } from '../password';
import { AUTHOR_PROFILE_SLUGS, AUTHOR_ROLE_TITLE, NEW_SPORTS, PILOT_POSTS } from './decisions';
import { checkPilotIsolation, MUST_BE_EMPTY, PILOT_DATABASE_NAME } from './isolation';
import { ZipReader } from './zipReader';

export const PILOT_IDS = PILOT_POSTS.map((p) => p.id);
export const PILOT_ENV_FILE = 'migration-inventory/pilot.env';
export const PILOT_DIR = 'migration-inventory/wordpress-pilot';
export const PILOT_MANIFEST = `${PILOT_DIR}/pilot-manifest.json`;
export const DRY_RUN_DIR = 'migration-inventory/wordpress-dry-run';
const UPLOADS_ROOT = 'public_html/';
const SOURCE_NOTE = 'Previous SportingSpy WordPress site';

export class PilotIsolationError extends Error {}
export type Env = Record<string, string | undefined>;

/** KEY=value lines of the pilot env file (never the project .env). */
export function readPilotEnv(file = PILOT_ENV_FILE): Record<string, string> {
  if (/(^|[\\/])\.env$/.test(file)) throw new PilotIsolationError('The project .env is never used for the pilot.');
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

/** Every setting name the app documents; blanked in the child unless the pilot file sets it. */
function knownSettingNames(): string[] {
  const names = new Set<string>(MUST_BE_EMPTY);
  for (const m of fs.readFileSync('.env.example', 'utf8').matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)) names.add(m[1]);
  return [...names];
}

const SYSTEM_VARIABLES = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PROGRAMDATA', 'PROGRAMFILES', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'HOME', 'LANG'];

/** The complete environment of a pilot child process. process.env contributes operating-system variables only. */
export function pilotEnvironment(envFile = PILOT_ENV_FILE): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && SYSTEM_VARIABLES.includes(key.toUpperCase())) env[key] = value;
  for (const name of knownSettingNames()) env[name] = '';
  Object.assign(env, readPilotEnv(envFile));
  env.DOTENV_CONFIG_PATH = envFile;
  env.SPORTINGSPY_REQUIRE_PILOT_ISOLATION = '1';
  return env;
}

/** Throws unless `env` is the isolated pilot. Call before every write-capable step. */
export function assertIsolated(env: Env, step: string): void {
  const check = checkPilotIsolation(env);
  if (!check.safe) throw new PilotIsolationError(`Refusing "${step}": ${check.problems.join(' ')}`);
}

/** A connection to the pilot database, opened only after the isolation check and verified from inside the server. */
export async function openPilotDb(env: Env, step: string): Promise<pg.Client> {
  assertIsolated(env, step);
  const client = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 8000 });
  await client.connect();
  const { rows } = await client.query('select current_database() as name, coalesce(host(inet_server_addr()), \'local socket\') as address');
  const loopback = ['127.0.0.1', '::1', 'local socket'].includes(rows[0].address);
  if (!PILOT_DATABASE_NAME.test(rows[0].name) || !loopback) {
    await client.end();
    throw new PilotIsolationError(`Refusing "${step}": connected to database "${rows[0].name}" at ${rows[0].address}, which is not the local pilot database.`);
  }
  return client;
}

// ── Pilot staff: two throwaway Admin accounts that exist only in the pilot database ──
export interface PilotStaff { id: string; email: string; name: string; password: string }
const STAFF = [{ id: 'user-wp-pilot-a', email: 'wp-pilot-a@pilot.invalid', name: 'WP Pilot Admin A' }, { id: 'user-wp-pilot-b', email: 'wp-pilot-b@pilot.invalid', name: 'WP Pilot Admin B' }];

/** Creates or re-activates the pilot accounts with fresh random passwords (kept in memory only). */
export async function ensurePilotStaff(db: pg.Client): Promise<PilotStaff[]> {
  const staff: PilotStaff[] = [];
  for (const s of STAFF) {
    const password = `Pilot-${crypto.randomBytes(18).toString('base64url')}-9a`;
    await db.query(
      `insert into "User" (id, name, email, role, avatar, "joinedAt", "updatedAt", status, "passwordHash") values ($1, $2, $3, 'Admin', '', now(), now(), 'active', $4)
       on conflict (id) do update set status = 'active', "passwordHash" = excluded."passwordHash", "updatedAt" = now()`,
      [s.id, s.name, s.email, hashPassword(password)],
    );
    staff.push({ ...s, password });
  }
  return staff;
}
export async function deactivatePilotStaff(db: pg.Client) {
  await db.query(`update "User" set status = 'inactive' where id = any($1)`, [STAFF.map((s) => s.id)]);
  await db.query(`delete from "Session" where "userId" = any($1)`, [STAFF.map((s) => s.id)]);
}
export async function removePilotStaff(db: pg.Client) {
  await db.query(`delete from "User" where id = any($1)`, [STAFF.map((s) => s.id)]);
}

// ── The CMS server, started against the pilot environment only ──
export interface PilotServer { base: string; stop: () => Promise<void>; log: () => string }
export async function startPilotServer(env: Record<string, string>): Promise<PilotServer> {
  assertIsolated(env, 'start the CMS server');
  const origin = new URL(env.ALLOWED_ORIGIN || `http://127.0.0.1:${env.PORT}`);
  let output = '';
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { cwd: process.cwd(), env: env as NodeJS.ProcessEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout!.on('data', (c) => { output += c; });
  child.stderr!.on('data', (c) => { output += c; });
  const stop = () => new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The pilot server did not start in time.\n${output.slice(-1500)}`)), 180_000);
    const poll = setInterval(() => {
      if (/Server running at/.test(output)) { clearTimeout(timer); clearInterval(poll); resolve(); }
      else if (child.exitCode !== null) { clearTimeout(timer); clearInterval(poll); reject(new Error(`The pilot server exited (code ${child.exitCode}).\n${output.slice(-1500)}`)); }
    }, 250);
  }).catch(async (err) => { await stop(); throw err; });
  if (!/media storage: local\)/.test(output)) { await stop(); throw new PilotIsolationError('The pilot server did not report local media storage.'); }
  return { base: origin.origin, stop, log: () => output };
}

export type Transport = (url: string, init: RequestInit) => Promise<Response>;

/** Minimal CMS API client: session cookie + CSRF double-submit, like the browser app. Every request stays on `base`. */
export class CmsApiClient {
  private cookies = new Map<string, string>();
  /** Hosts this client has sent a request to (for audit and tests). */
  readonly contacted = new Set<string>();
  /** While true, anything but reading (and signing in or out) is refused before it is sent. */
  readOnly = false;
  /** Called with the HTTP status of every answer (a live run stops on a 5xx). */
  onAnswer: ((status: number, pathname: string) => void) | null = null;
  constructor(readonly base: string, private readonly transport: Transport = (url, init) => fetch(url, init)) {}
  private fetch(route: string, init: RequestInit): Promise<Response> {
    const url = new URL(route, this.base);
    if (url.origin !== new URL(this.base).origin) throw new PilotIsolationError(`Refusing a request outside ${this.base}.`);
    if (this.readOnly && !['GET', 'HEAD'].includes(String(init.method ?? 'GET').toUpperCase()) && !['/api/auth/login', '/api/auth/logout'].includes(url.pathname)) throw new PilotIsolationError(`Refusing ${init.method} ${url.pathname}: this run is plan-only.`);
    this.contacted.add(url.host);
    return this.transport(url.toString(), init).then((res) => { this.onAnswer?.(res.status, url.pathname); return res; });
  }
  private remember(res: Response) { for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const at = pair.indexOf('='); const value = pair.slice(at + 1); if (value) this.cookies.set(pair.slice(0, at), value); else this.cookies.delete(pair.slice(0, at)); } }
  private headers(extra: Record<string, string> = {}) { return { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'x-csrf-token': this.cookies.get('csrf_token') ?? '', ...extra }; }
  async request(method: string, route: string, body?: unknown): Promise<{ status: number; data: any }> {
    const res = await this.fetch(route, { method, headers: this.headers(body === undefined ? {} : { 'Content-Type': 'application/json' }), body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    this.remember(res);
    const text = await res.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, data };
  }
  async upload(route: string, fields: Record<string, string>, file: { data: Buffer; name: string; type: string }): Promise<{ status: number; data: any }> {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set('file', new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
    const res = await this.fetch(route, { method: 'POST', headers: this.headers(), body: form, redirect: 'manual' });
    this.remember(res);
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  /** Signs in. `totpCode` is the current 6-digit code when the account has two-factor authentication. Nothing is stored. */
  async login(staff: { email: string; password: string; totpCode?: string }): Promise<{ role: string; name: string }> {
    await this.request('GET', '/api/auth/me'); // any request past the CSRF middleware issues the csrf_token cookie
    const res = await this.request('POST', '/api/auth/login', { email: staff.email, password: staff.password, ...(staff.totpCode ? { totpCode: staff.totpCode } : {}) });
    if (res.status === 401 && res.data?.totpRequired) throw new LoginError(staff.totpCode ? 'The authentication code was not accepted.' : 'This account needs its 6-digit authentication code.', true);
    if (res.status !== 200) throw new LoginError(`Sign-in failed (${res.status}): ${String(res.data?.error ?? '').slice(0, 160)}`, false);
    return { role: res.data.user?.role, name: res.data.user?.name };
  }
  /** HTTP status of a public page on the target, without a session. */
  async pageStatus(route: string): Promise<number> { const res = await this.fetch(route, { method: 'GET', redirect: 'manual' }); await res.arrayBuffer(); return res.status; }
  async logout() { await this.request('POST', '/api/auth/logout').catch(() => undefined); this.cookies.clear(); }
}
export class LoginError extends Error { constructor(message: string, readonly totpRequired: boolean) { super(message); } }

/** The pilot's client: this machine only. */
export class PilotApi extends CmsApiClient {
  constructor(base: string, transport?: Transport) {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) throw new PilotIsolationError('The pilot API client only talks to this machine.');
    super(base, transport);
  }
}

// ── Manifest of everything the pilot created ──
export interface PilotManifest {
  version: 1;
  database: { name: string };
  authors: Record<string, { id: string; createdByPilot: boolean }>;
  sports?: Record<string, { id: string; createdByPilot: boolean }>;
  media: Record<string, { id: string; sha256: string; createdByPilot: boolean }>;
  /** `complete: false` = the article exists but a later step (its FAQ entries) has not finished; the next run resumes it. */
  posts: Record<string, { articleId: string; slug: string; path: string; importedAt: string; updatedAt: string; reviewVersion: number; mediaFiles: string[]; faq: { id: string; updatedAt: string }[]; complete?: boolean }>;
  history: string[];
}
export function loadManifest(databaseName: string, file = PILOT_MANIFEST): PilotManifest {
  if (!fs.existsSync(file)) return { version: 1, database: { name: databaseName }, authors: {}, media: {}, posts: {}, history: [] };
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as PilotManifest;
  if (manifest.database.name !== databaseName) throw new PilotIsolationError(`The import manifest belongs to "${manifest.database.name}", not "${databaseName}".`);
  return manifest;
}
export function saveManifest(manifest: PilotManifest, file = PILOT_MANIFEST) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(manifest, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

/**
 * A destination other than the isolated pilot (see live.ts). It names itself
 * (the manifest is bound to that name) and brings the check that must pass
 * before every write. Without a target, the pilot isolation guard applies.
 */
export interface ImportTarget { name: string; guard: (step: string) => void; hideNewSports: boolean; /** Pause before each image upload, so a small server can finish and release the previous one. */ uploadPauseMs?: number; /** Raised while a run is going on (failed readiness check, 5xx answer); checked before every write. */ stop?: StopSignal }

/** Shared between a run's health monitor and its import loop. A reason, once set, stays set for that run. */
export interface StopSignal { reason: string | null }

/** The destination stopped answering properly (restart, overload, gateway error). The run stops at once; nothing is retried blindly. */
export class DestinationUnavailable extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Stops the run before `next` starts when the stop signal is raised. Whatever is already stored stays; the next run resumes from it. */
function haltIfStopped(ctx: Pick<PilotContext, 'target'>, next: string) {
  const reason = ctx.target?.stop?.reason;
  if (reason) throw new DestinationUnavailable(`${reason} The run stopped before ${next}. Finished posts are kept; run it again when the site is healthy.`);
}
export interface PilotContext { env: Record<string, string>; api: CmsApiClient; db?: pg.Client; wxrFile: string; zipFile: string; manifestFile?: string; dryRunDir?: string; target?: ImportTarget }
const guard = (ctx: Pick<PilotContext, 'env' | 'target'>, step: string) => (ctx.target ? ctx.target.guard(step) : assertIsolated(ctx.env, step));
const targetName = (ctx: Pick<PilotContext, 'env' | 'target'>) => ctx.target?.name ?? databaseNameOf(ctx.env);
const sha256 = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex');
const mimeOf = (file: string) => (/\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : /\.avif$/i.test(file) ? 'image/avif' : 'image/jpeg');
const databaseNameOf = (env: Env) => decodeURIComponent(new URL(env.DATABASE_URL!).pathname.slice(1));

export interface ImportReport { created: string[]; resumed: string[]; wouldCreate: string[]; skipped: { id: string; reason: string }[]; refused: { id: string; reason: string }[]; media: { uploaded: number; reused: number }; faq: number; authorsCreated: string[] }
export interface ImportOptions {
  /** WordPress IDs this run may import. Default: the five pilot posts. */
  allowed?: string[];
  /** Report what would be created or skipped; write nothing. */
  planOnly?: boolean;
  onProgress?: (line: string) => void;
}

/** The approved sports and source-attribution profiles, created through the CMS's Admin API when missing. Never duplicates one that exists. */
export async function ensureEntities(ctx: PilotContext, only?: { sports?: string[]; authors?: string[] }): Promise<{ sportsCreated: string[]; sportsExisting: string[]; authorsCreated: string[]; authorsExisting: string[] }> {
  guard(ctx, 'create the approved sports and author profiles');
  const manifest = loadManifest(targetName(ctx), ctx.manifestFile);
  manifest.sports ??= {};
  const cms = (await ctx.api.request('GET', '/api/cms/data')).data;
  const out = { sportsCreated: [] as string[], sportsExisting: [] as string[], authorsCreated: [] as string[], authorsExisting: [] as string[] };
  for (const sport of NEW_SPORTS.filter((s) => !only?.sports || only.sports.includes(s.slug))) {
    const existing = cms.sports.find((s: any) => s.slug === sport.slug);
    if (existing) { out.sportsExisting.push(sport.slug); manifest.sports[sport.slug] ??= { id: existing.id, createdByPilot: false }; continue; }
    haltIfStopped(ctx, `creating the sport "${sport.slug}"`);
    // On a live site a new sport stays hidden until an Admin shows it, once its first article is published.
    const made = await ctx.api.request('POST', '/api/sports', { name: sport.name, slug: sport.slug, ...(ctx.target?.hideNewSports ? { isVisible: false } : {}) });
    if (made.status !== 201) throw new Error(`Sport "${sport.slug}" could not be created through the CMS (${made.status}): ${made.data?.error ?? ''}`);
    manifest.sports[sport.slug] = { id: made.data.id, createdByPilot: true };
    out.sportsCreated.push(sport.slug);
    saveManifest(manifest, ctx.manifestFile);
  }
  for (const [name, slug] of Object.entries(AUTHOR_PROFILE_SLUGS).filter(([, s]) => !only?.authors || only.authors.includes(s))) {
    const existing = cms.authors.find((a: any) => a.slug === slug);
    if (existing) { out.authorsExisting.push(slug); manifest.authors[slug] ??= { id: existing.id, createdByPilot: false }; continue; }
    haltIfStopped(ctx, `creating the author profile "${slug}"`);
    const author = await createAuthorProfile(ctx, name, slug);
    manifest.authors[slug] = { id: author.id, createdByPilot: true };
    out.authorsCreated.push(slug);
    saveManifest(manifest, ctx.manifestFile);
  }
  saveManifest(manifest, ctx.manifestFile);
  return out;
}

/** An unlinked source-attribution profile: a name, a slug and a role label. No login, no e-mail, no picture. */
async function createAuthorProfile(ctx: PilotContext, name: string, slug: string): Promise<any> {
  const made = await ctx.api.request('POST', '/api/authors', { name, slug, roleTitle: AUTHOR_ROLE_TITLE, bio: '' });
  if (made.status !== 201) throw new Error(`Author profile "${slug}" could not be created through the CMS (${made.status}): ${made.data?.error ?? ''}`);
  // The create route fills in a stock portrait when no picture is given; an imported byline must not carry one.
  const cleared = await ctx.api.request('PUT', `/api/authors/${made.data.id}`, { avatar: '' });
  return cleared.status === 200 ? cleared.data : made.data;
}

/** Imports WordPress posts as review-required drafts. Default scope: the five pilot posts. Safe to re-run. */
export async function importPilot(ctx: PilotContext, ids: string[] = PILOT_IDS, options: ImportOptions = {}): Promise<ImportReport> {
  guard(ctx, 'import WordPress posts');
  const allowed = options.allowed ?? PILOT_IDS;
  const outside = ids.filter((id) => !allowed.includes(id));
  if (outside.length || ids.length > allowed.length || new Set(ids).size !== ids.length) throw new Error(`This run imports only WordPress IDs ${allowed.join(', ')}. Refused: ${outside.join(', ') || 'duplicate or too many IDs'}.`);
  const dryRunDir = ctx.dryRunDir ?? DRY_RUN_DIR;
  const dry = JSON.parse(fs.readFileSync(path.join(dryRunDir, 'manifest.json'), 'utf8'));
  if (dry.mode !== 'dry-run' || dry.sources.wxrSha256 !== sha256(fs.readFileSync(ctx.wxrFile, 'utf8')) || dry.sources.uploadsZip.bytes !== fs.statSync(ctx.zipFile).size) {
    throw new Error('The dry-run output does not match the backup files. Run npm run migration:wordpress-dry-run again first.');
  }
  const manifest = loadManifest(targetName(ctx), ctx.manifestFile);
  const save = () => saveManifest(manifest, ctx.manifestFile);
  const report: ImportReport = { created: [], resumed: [], wouldCreate: [], skipped: [], refused: [], media: { uploaded: 0, reused: 0 }, faq: 0, authorsCreated: [] };
  const progress = options.onProgress ?? (() => undefined);
  const mediaFiles = new Map<string, any>((dry.mediaFiles as any[]).map((m) => [m.placeholderMediaId, m]));
  const zip = new ZipReader(ctx.zipFile, `${UPLOADS_ROOT}wp-content/uploads/`);
  try {
    for (const id of ids) {
      guard(ctx, `import WordPress post ${id}`);
      haltIfStopped(ctx, `post ${id}`);
      const entry = (dry.posts as any[]).find((p) => p.wordpressId === id);
      const file = fs.readdirSync(path.join(dryRunDir, 'posts')).find((f) => f.startsWith(`${id}-`));
      if (!entry || !file) { report.refused.push({ id, reason: 'Not in the dry-run output.' }); continue; }
      const post = JSON.parse(fs.readFileSync(path.join(dryRunDir, 'posts', file), 'utf8'));
      const plan = entry.plannedDraft;
      const refuse = (reason: string) => { report.refused.push({ id, reason }); progress(`post ${id} REFUSED: ${reason}`); };
      if (!entry.conversion.ok || !post.document) { refuse('The dry run could not convert this post.'); continue; }
      if (plan.status !== 'draft' || plan.requireReview !== true || plan.scheduledFor !== null) { refuse('The planned draft is not a review-required draft.'); continue; }
      if (!plan.sportSlug || entry.sport.status === 'unresolved') { refuse('No sport is approved for this post.'); continue; }
      if (!plan.authorSlug) { refuse('No Author profile is approved for this post.'); continue; }

      // The CMS as it is now: the target sport/edition must exist, and the address must be free or ours.
      const cmsAnswer = await ctx.api.request('GET', '/api/cms/data');
      if (cmsAnswer.status !== 200 || !Array.isArray(cmsAnswer.data?.sports)) throw new DestinationUnavailable(`The CMS did not answer (HTTP ${cmsAnswer.status}) before post ${id}. The run stopped; nothing was written for this post. Run it again when the site is healthy.`);
      const cms = cmsAnswer.data;
      if (!cms.sports?.some((s: any) => s.slug === plan.sportSlug)) { refuse(`Sport "${plan.sportSlug}" does not exist in the destination; the importer creates no sports.`); continue; }
      if (plan.eventSlug && !cms.editions.some((e: any) => e.sportSlug === plan.sportSlug && e.eventSlug === plan.eventSlug && e.year === plan.editionYear)) { refuse(`Event edition ${plan.sportSlug}/${plan.eventSlug}/${plan.editionYear} does not exist in the pilot database.`); continue; }
      if (!cms.articleTypes.some((t: any) => t.name === plan.articleType && t.isActive)) { refuse(`Article type "${plan.articleType}" is not an active type.`); continue; }
      const known = manifest.posts[id];
      const atAddress = cms.articles.find((a: any) => a.slug === entry.slug && a.sportSlug === plan.sportSlug && (a.eventSlug ?? null) === plan.eventSlug && (a.editionYear ?? null) === plan.editionYear);
      /** Finishes a post whose article exists but whose FAQ entries were not (all) stored. The FAQ import skips entries that are already there. */
      const finish = async (articleId: string): Promise<boolean> => {
        if (post.faqs.length) {
          haltIfStopped(ctx, `the FAQ entries of post ${id}`);
          const faq = await ctx.api.request('POST', '/api/faq/import', { articleId, faqs: post.faqs.map((q: any) => ({ question: q.question, answer: q.answer })) });
          if (faq.status !== 201) { refuse(`The article exists (${articleId}) but its FAQ entries were refused (${faq.status}): ${faq.data?.error ?? ''}`); return false; }
          report.faq += faq.data.created.length;
          const all = (await ctx.api.request('GET', `/api/faq?context=article:${articleId}`)).data;
          manifest.posts[id].faq = (Array.isArray(all) ? all : []).map((f: any) => ({ id: f.id, updatedAt: f.updatedAt }));
        }
        const stored = (await ctx.api.request('GET', `/api/articles/${articleId}`)).data;
        manifest.posts[id].updatedAt = stored.updatedAt; manifest.posts[id].reviewVersion = stored.reviewVersion; manifest.posts[id].complete = true;
        save();
        return true;
      };
      if (known && cms.articles.some((a: any) => a.id === known.articleId)) {
        if (known.complete === false && !options.planOnly) {
          if (await finish(known.articleId)) { manifest.history.push(`${new Date().toISOString()} post ${id}: resumed and completed article ${known.articleId}.`); save(); report.resumed.push(id); progress(`post ${id} resumed: ${known.articleId} completed`); }
          continue;
        }
        report.skipped.push({ id, reason: known.complete === false ? `Imported as ${known.articleId} but not finished; the next import run resumes it.` : `Already imported as ${known.articleId}.` }); progress(`post ${id} skipped: already imported as ${known.articleId}`); continue;
      }
      if (atAddress) {
        // A run that lost the server's answer leaves the article without a manifest entry. It is ours only if the CMS itself records this WordPress ID as its origin.
        const origin = (await ctx.api.request('GET', `/api/articles/${atAddress.id}/import-source`)).data?.importSource;
        if (origin?.source === 'wordpress' && origin.sourceId === id && atAddress.status === 'draft' && atAddress.reviewStatus === 'draft') {
          if (options.planOnly) { report.skipped.push({ id, reason: `Already in the CMS as ${atAddress.id} (import record WP #${id}) but not in the manifest; the next import run adopts and completes it.` }); continue; }
          const mediaFilesUsed = [...new Set([...(entry.featuredImage.available ? [entry.featuredImage.placeholderMediaId] : []), ...post.images.filter((i: any) => i.placed && i.mediaId).map((i: any) => i.mediaId)])].map((p) => mediaFiles.get(p as string)?.file).filter(Boolean) as string[];
          manifest.posts[id] = { articleId: atAddress.id, slug: atAddress.slug, path: entry.proposedPath, importedAt: new Date().toISOString(), updatedAt: '', reviewVersion: 0, mediaFiles: mediaFilesUsed, faq: [], complete: false };
          save();
          if (await finish(atAddress.id)) { manifest.history.push(`${new Date().toISOString()} post ${id}: adopted article ${atAddress.id} (import record WP #${id}) and completed it.`); save(); report.resumed.push(id); progress(`post ${id} resumed: adopted ${atAddress.id}`); }
          continue;
        }
        refuse(`An article that this import did not create already uses ${entry.proposedPath} (${atAddress.id}). Nothing was written.`); continue;
      }
      if (options.planOnly) { report.wouldCreate.push(id); continue; }
      if (known) { manifest.history.push(`${new Date().toISOString()} post ${id}: article ${known.articleId} no longer exists; importing again.`); delete manifest.posts[id]; save(); }

      // Author profile: an unlinked source-attribution profile, created in the pilot database only.
      let author = cms.authors.find((a: any) => a.slug === plan.authorSlug);
      if (!author) {
        if (AUTHOR_PROFILE_SLUGS[plan.sourceAttribution] !== plan.authorSlug) { refuse(`"${plan.authorSlug}" is not an approved profile for "${plan.sourceAttribution}".`); continue; }
        haltIfStopped(ctx, `the author profile of post ${id}`);
        try { author = await createAuthorProfile(ctx, plan.sourceAttribution, plan.authorSlug); } catch (err) { refuse(err instanceof Error ? err.message : String(err)); continue; }
        manifest.authors[plan.authorSlug] = { id: author.id, createdByPilot: true }; save();
        report.authorsCreated.push(plan.authorSlug);
      } else if (!manifest.authors[plan.authorSlug]) { manifest.authors[plan.authorSlug] = { id: author.id, createdByPilot: false }; save(); }
      if (author.userId || author.email) { refuse(`Author profile "${plan.authorSlug}" is linked to a login or has an e-mail; an imported byline must be unlinked.`); continue; }

      // Media: the featured image and every placed inline image, into the local Media Library.
      const needed: string[] = [...new Set([...(entry.featuredImage.available ? [entry.featuredImage.placeholderMediaId] : []), ...post.images.filter((i: any) => i.placed && i.mediaId).map((i: any) => i.mediaId)])] as string[];
      const realId = new Map<string, string>();
      const usedFiles: string[] = [];
      let mediaProblem = '';
      for (const placeholder of needed) {
        const m = mediaFiles.get(placeholder);
        if (!m) { mediaProblem = `No media file is listed for ${placeholder}.`; break; }
        usedFiles.push(m.file);
        const have = manifest.media[m.file];
        if (have && cms.mediaItems.some((x: any) => x.id === have.id)) { realId.set(placeholder, have.id); report.media.reused++; continue; }
        const data = zip.read(UPLOADS_ROOT + m.file);
        if (sha256(data) !== m.sha256) { mediaProblem = `${m.file} differs from the file the dry run inspected.`; break; }
        haltIfStopped(ctx, `uploading ${m.file}`);
        if (ctx.target?.uploadPauseMs) {
          await sleep(ctx.target.uploadPauseMs);
          haltIfStopped(ctx, `uploading ${m.file}`);
          if ((await ctx.api.pageStatus('/api/health/ready')) !== 200) throw new DestinationUnavailable(`The site was not ready before uploading ${m.file}. The run stopped; run it again when the site is healthy.`);
        }
        const up = await ctx.api.upload('/api/media/upload', { title: String(m.title).slice(0, 200), altText: String(m.alt).slice(0, 300), caption: String(m.caption).slice(0, 500), source: `${SOURCE_NOTE} (${m.file})`.slice(0, 200), creationType: 'Other' }, { data, name: m.file.split('/').pop()!, type: mimeOf(m.file) });
        if (up.status === 201) { manifest.media[m.file] = { id: up.data.id, sha256: m.sha256, createdByPilot: true }; realId.set(placeholder, up.data.id); report.media.uploaded++; }
        else if (up.status === 409 && up.data?.duplicateOf?.id) { manifest.media[m.file] = { id: up.data.duplicateOf.id, sha256: m.sha256, createdByPilot: false }; realId.set(placeholder, up.data.duplicateOf.id); report.media.reused++; }
        else if (up.status >= 500) throw new DestinationUnavailable(`The site failed while storing ${m.file} (HTTP ${up.status}); it may have restarted. The run stopped at post ${id}. Finished posts are kept; run it again when the site is healthy.`);
        else { mediaProblem = `${m.file} was not accepted (${up.status}): ${up.data?.error ?? ''}`; break; }
        save();
      }
      if (mediaProblem) { refuse(mediaProblem); continue; }

      // The validated document from the dry run, with its placeholder media ids replaced by the real ones.
      const swap = (node: any): any => ({ ...node, ...(node.type === 'image' ? { attrs: { ...node.attrs, mediaId: realId.get(node.attrs.mediaId) } } : {}), ...(node.content ? { content: node.content.map(swap) } : {}) });
      const body: any = { type: 'doc', content: post.document.content.map(swap) };
      if (entry.featuredImage.available && entry.featuredImage.caption) body.attrs = { featuredCaption: String(entry.featuredImage.caption).slice(0, 500) };
      if (JSON.stringify(body).includes('"wp-att-') || JSON.stringify(body).includes('"wp-file-')) { refuse('A placeholder media id was left in the document.'); continue; }

      const seo: Record<string, unknown> = { keywords: entry.seo.keywords };
      if (entry.seo.metaDescription) seo.metaDescription = entry.seo.metaDescription;
      const payload: Record<string, unknown> = {
        title: entry.title, slug: entry.slug, sportSlug: plan.sportSlug, articleType: plan.articleType, authorId: author.id, body, seo,
        excerpt: entry.excerpt ?? '', publishedAt: plan.publishedAt, status: 'draft', requireReview: true,
        importSource: { source: 'wordpress', sourceId: id, sourceTitle: entry.title, sourceUrl: entry.oldPath },
        ...(plan.eventSlug ? { eventSlug: plan.eventSlug, editionYear: plan.editionYear } : {}),
        ...(entry.featuredImage.available ? { featuredMediaId: realId.get(entry.featuredImage.placeholderMediaId) } : {}),
      };
      haltIfStopped(ctx, `creating the article of post ${id}`);
      const created = await ctx.api.request('POST', '/api/articles', payload);
      if (created.status !== 201) { refuse(`The CMS refused the article (${created.status}): ${created.data?.error ?? ''}`); continue; }
      const article = created.data;
      if (article.status !== 'draft' || article.reviewStatus !== 'draft' || article.scheduledFor) {
        await ctx.api.request('DELETE', `/api/articles/${article.id}`);
        throw new Error(`Post ${id} was not stored as a review-required draft (status ${article.status}, review ${article.reviewStatus}); it was removed again and the pilot stopped.`);
      }
      manifest.posts[id] = { articleId: article.id, slug: article.slug, path: entry.proposedPath, importedAt: new Date().toISOString(), updatedAt: article.updatedAt, reviewVersion: article.reviewVersion, mediaFiles: usedFiles, faq: [], complete: false };
      save();

      if (!(await finish(article.id))) continue;
      manifest.history.push(`${new Date().toISOString()} post ${id}: created article ${article.id} (draft, review required).`);
      save();
      report.created.push(id);
      progress(`post ${id} created: ${article.id} ${entry.proposedPath} (draft, review required; ${usedFiles.length} image(s), ${manifest.posts[id].faq.length} FAQ)`);
    }
  } finally { zip.close(); }
  return report;
}

export interface RollbackReport { removedArticles: string[]; kept: { id: string; reason: string }[]; removedFaq: number; removedMedia: number; keptMedia: { file: string; reason: string }[]; removedAuthors: string[]; keptAuthors: { slug: string; reason: string }[]; removedSports: string[]; keptSports: { slug: string; reason: string }[] }

/**
 * Removes what the pilot created, and only that: an article is deleted only
 * while it is still the untouched draft the pilot stored (same review state,
 * version and modification time; FAQ entries unchanged). Anything edited
 * since is kept and reported.
 */
export async function rollbackPilot(ctx: PilotContext): Promise<RollbackReport> {
  guard(ctx, 'roll back the import');
  const manifest = loadManifest(targetName(ctx), ctx.manifestFile);
  const save = () => saveManifest(manifest, ctx.manifestFile);
  const report: RollbackReport = { removedArticles: [], kept: [], removedFaq: 0, removedMedia: 0, keptMedia: [], removedAuthors: [], keptAuthors: [], removedSports: [], keptSports: [] };
  for (const [id, record] of Object.entries(manifest.posts)) {
    guard(ctx, `roll back WordPress post ${id}`);
    const found = await ctx.api.request('GET', `/api/articles/${record.articleId}`);
    if (found.status === 404) { delete manifest.posts[id]; manifest.history.push(`${new Date().toISOString()} post ${id}: article ${record.articleId} was already gone.`); save(); continue; }
    const a = found.data;
    const keep = (reason: string) => { report.kept.push({ id, reason }); };
    if (found.status !== 200) { keep(`Could not read the article (${found.status}).`); continue; }
    if (a.status !== 'draft' || a.reviewStatus !== 'draft') { keep(`No longer an untouched draft (status ${a.status}, review ${a.reviewStatus}).`); continue; }
    if (record.complete !== false && (a.reviewVersion !== record.reviewVersion || a.updatedAt !== record.updatedAt)) { keep('Edited since the import.'); continue; }
    const faq = await ctx.api.request('GET', `/api/faq?context=article:${record.articleId}`);
    const entries: any[] = Array.isArray(faq.data) ? faq.data : faq.data?.entries ?? faq.data?.items ?? [];
    const expected = new Map(record.faq.map((f) => [f.id, f.updatedAt]));
    if (faq.status !== 200 || entries.some((e) => e.status !== 'draft' || e.source !== 'editor') || (record.complete !== false && (entries.length !== expected.size || entries.some((e) => expected.get(e.id) !== e.updatedAt)))) { keep('Its FAQ entries were changed since the import.'); continue; }
    for (const e of entries) { const gone = await ctx.api.request('DELETE', `/api/faq/${e.id}`); if (gone.status === 200) report.removedFaq++; }
    const gone = await ctx.api.request('DELETE', `/api/articles/${record.articleId}`);
    if (gone.status !== 200) { keep(`The CMS refused to delete it (${gone.status}): ${gone.data?.error ?? ''}`); continue; }
    delete manifest.posts[id];
    manifest.history.push(`${new Date().toISOString()} post ${id}: removed article ${record.articleId}.`);
    save();
    report.removedArticles.push(id);
  }
  // Media the pilot uploaded, once no remaining pilot article lists it. The CMS itself refuses while anything uses it.
  const stillListed = new Set(Object.values(manifest.posts).flatMap((p) => p.mediaFiles));
  for (const [file, m] of Object.entries(manifest.media)) {
    if (stillListed.has(file)) { report.keptMedia.push({ file, reason: 'Used by a pilot article that was kept.' }); continue; }
    if (!m.createdByPilot) { delete manifest.media[file]; continue; }
    const gone = await ctx.api.request('DELETE', `/api/media/${m.id}`);
    if (gone.status === 200 || gone.status === 404) { delete manifest.media[file]; if (gone.status === 200) report.removedMedia++; }
    else report.keptMedia.push({ file, reason: gone.data?.error ?? `The CMS refused (${gone.status}).` });
    save();
  }
  // Author profiles the pilot created, once they have no article. The CMS has no author delete route, so this is the one direct delete.
  for (const [slug, a] of Object.entries(manifest.authors)) {
    if (!a.createdByPilot) { delete manifest.authors[slug]; continue; }
    // Without direct database access (a live target) a profile cannot be removed: the CMS has no route for it.
    if (!ctx.db) { report.keptAuthors.push({ slug, reason: 'The CMS has no way to delete an author profile; an Admin removes or keeps it.' }); continue; }
    const { rows } = await ctx.db.query('select (select count(*) from "Article" where "authorId" = $1)::int as articles, (select "userId" from "Author" where id = $1) as "userId"', [a.id]);
    if (rows[0].articles > 0) { report.keptAuthors.push({ slug, reason: `Still the byline of ${rows[0].articles} article(s).` }); continue; }
    if (rows[0].userId) { report.keptAuthors.push({ slug, reason: 'Has been linked to a login since the import.' }); continue; }
    guard(ctx, `remove author profile ${slug}`);
    await ctx.db.query('delete from "Author" where id = $1 and slug = $2 and "userId" is null', [a.id, slug]);
    delete manifest.authors[slug];
    report.removedAuthors.push(slug);
  }
  // Sports the pilot created, once nothing belongs to them. The CMS refuses while a sport still has events or articles.
  for (const [slug, sport] of Object.entries(manifest.sports ?? {})) {
    if (!sport.createdByPilot) { delete manifest.sports![slug]; continue; }
    const gone = await ctx.api.request('DELETE', `/api/sports/${sport.id}`);
    if (gone.status === 200 || gone.status === 404) { delete manifest.sports![slug]; if (gone.status === 200) report.removedSports.push(slug); }
    else report.keptSports.push({ slug, reason: gone.data?.error ?? `The CMS refused (${gone.status}).` });
  }
  save();
  return report;
}

/**
 * Labels articles that were imported before the import record existed. Uses the
 * manifest (which article came from which WordPress post) and the dry run (its
 * original title and address). Adds missing labels only; changes no article.
 */
export async function backfillImportSources(ctx: PilotContext): Promise<{ added: number; alreadyLabelled: number; missingArticle: string[] }> {
  assertIsolated(ctx.env, 'label the imported articles');
  if (!ctx.db) throw new Error('Labelling needs the pilot database connection.');
  const manifest = loadManifest(databaseNameOf(ctx.env), ctx.manifestFile);
  const dry = JSON.parse(fs.readFileSync(path.join(ctx.dryRunDir ?? DRY_RUN_DIR, 'manifest.json'), 'utf8'));
  const out = { added: 0, alreadyLabelled: 0, missingArticle: [] as string[] };
  for (const [id, record] of Object.entries(manifest.posts)) {
    const entry = (dry.posts as any[]).find((p) => p.wordpressId === id);
    const exists = (await ctx.db.query('select 1 from "Article" where id = $1', [record.articleId])).rowCount;
    if (!exists || !entry) { out.missingArticle.push(id); continue; }
    const done = await ctx.db.query(`insert into "ArticleImport" ("articleId", source, "sourceId", "sourceTitle", "sourceUrl", "importedAt") values ($1, 'wordpress', $2, $3, $4, $5) on conflict do nothing`, [record.articleId, id, entry.title, entry.oldPath, record.importedAt]);
    if (done.rowCount) out.added++; else out.alreadyLabelled++;
  }
  return out;
}

/** What the destination CMS holds now, in the shape the dry run maps against. Sport pages are checked over HTTP on this machine. */
export async function destinationSnapshot(ctx: PilotContext): Promise<Record<string, unknown>> {
  const cms = (await ctx.api.request('GET', '/api/cms/data')).data;
  const pages = (await ctx.api.request('GET', '/api/pages')).data;
  const sportPages: string[] = [];
  // A sport page counts only if it is public: hidden sports answer 404, so links to them stay pending.
  for (const s of cms.sports) { if ((await ctx.api.pageStatus(`/${s.slug}/`)) === 200) sportPages.push(s.slug); }
  return {
    capturedAt: new Date().toISOString().slice(0, 10),
    source: `The destination itself (${targetName(ctx)}), read through the CMS API; sport pages checked over HTTP at ${ctx.api.base}.`,
    sports: cms.sports.map((s: any) => ({ slug: s.slug, visible: s.isVisible })), sportPages,
    events: cms.events.map((e: any) => ({ sportSlug: e.sportSlug, slug: e.slug })),
    editions: cms.editions.map((e: any) => ({ sportSlug: e.sportSlug, eventSlug: e.eventSlug, year: e.year })),
    articleTypes: cms.articleTypes.map((t: any) => ({ name: t.name, isActive: t.isActive })),
    authors: cms.authors.map((a: any) => ({ slug: a.slug })),
    pages: (Array.isArray(pages) ? pages : pages.pages ?? pages.items ?? []).filter((p: any) => p.status === 'published').map((p: any) => `/${p.slug}`),
    articlePaths: cms.articles.filter((a: any) => a.status === 'published').map((a: any) => (a.eventSlug && a.editionYear ? `/${a.sportSlug}/${a.eventSlug}/${a.editionYear}/${a.slug}` : `/${a.sportSlug}/${a.slug}`)),
  };
}

/** The export and the site-files archive in ../backup (read-only sources). */
export function locateBackup(dir = path.resolve('..', 'backup')): { wxrFile: string; zipFile: string } {
  const find = (test: RegExp) => { const hit = fs.readdirSync(dir).find((f) => test.test(f)); if (!hit) throw new Error(`Backup file not found in ${dir}: ${test}`); return path.join(dir, hit); };
  return { wxrFile: find(/\.WordPress\..*\.xml$/i), zipFile: find(/public_html.*\.zip$/i) };
}

export interface PilotSession extends PilotContext { staff: PilotStaff[]; server: PilotServer; second: PilotApi }

/**
 * Opens the pilot database, starts the CMS against it and signs in, runs
 * `work`, then always stops the server and disables the pilot accounts. The
 * successful sign-in is itself evidence of the target: the account exists
 * only in the pilot database.
 */
export async function runWithPilot<T>(work: (session: PilotSession) => Promise<T>, options: { envFile?: string; manifestFile?: string } = {}): Promise<T> {
  const env = pilotEnvironment(options.envFile);
  assertIsolated(env, 'open the pilot');
  const db = await openPilotDb(env, 'open the pilot database');
  let server: PilotServer | undefined;
  try {
    const staff = await ensurePilotStaff(db);
    server = await startPilotServer(env);
    const api = new PilotApi(server.base);
    await api.login(staff[0]);
    const second = new PilotApi(server.base);
    await second.login(staff[1]);
    return await work({ env, api, second, db, staff, server, manifestFile: options.manifestFile, ...locateBackup() });
  } finally {
    await server?.stop();
    await deactivatePilotStaff(db).catch(() => undefined);
    await db.end();
  }
}
