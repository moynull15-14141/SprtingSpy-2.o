/**
 * WordPress migration, LIVE mode: imports through the CMS Admin API of an
 * allow-listed site over HTTPS. It never connects to a database and holds no
 * storage credentials: articles, media and FAQ entries are created by the
 * CMS itself, with all of its validation, audit entries and review rules.
 *
 * Safety model
 * - Target: only an origin in LIVE_TARGETS (or, for testing, a server on this
 *   machine with `allowLocalTest`). Every request stays on that origin.
 * - Identity: an Admin signs in for the run (password and, when the account
 *   has it, the current two-factor code). Nothing is stored or logged.
 * - Plan first: every operation is plan-only unless `execute` is set AND the
 *   exact confirmation phrase printed by the plan is supplied.
 * - Review: articles are created as drafts with requireReview and an import
 *   record. The CMS refuses a second import of the same WordPress ID.
 * - New sports are created hidden.
 * - Resume: the manifest is written after every step; a re-run skips what is
 *   done, finishes what is half done, and adopts an article whose creation
 *   succeeded but whose answer was lost (matched by its import record).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AUTHOR_PROFILE_SLUGS, NEW_SPORTS } from './decisions';
import { CmsApiClient, destinationSnapshot, ensureEntities, importPilot, loadManifest, locateBackup, rollbackPilot, PilotIsolationError, type ImportReport, type PilotContext, type RollbackReport, type Transport } from './pilot';

/** The only sites a live import may ever talk to. */
export const LIVE_TARGETS = ['https://sportingspy.com'] as const;
export const LIVE_DIR = 'migration-inventory/wordpress-live';
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];

export class LiveTargetError extends Error {}
export interface LiveTarget { origin: string; host: string; local: boolean; dir: string }

/** Validates a target address against the allow-list. A local server is accepted only for testing, and only when asked for. */
export function resolveLiveTarget(input: string, options: { allowLocalTest?: boolean } = {}): LiveTarget {
  let url: URL;
  try { url = new URL(input); } catch { throw new LiveTargetError(`"${input}" is not a URL.`); }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new LiveTargetError('The target must be a site address only (no path, query or credentials).');
  const local = url.protocol === 'http:' && LOOPBACK.includes(url.hostname);
  if ((LIVE_TARGETS as readonly string[]).includes(url.origin)) return { origin: url.origin, host: url.host, local: false, dir: path.join(LIVE_DIR, url.host.replace(/[^a-z0-9.-]/gi, '_')) };
  if (local && options.allowLocalTest) return { origin: url.origin, host: url.host, local: true, dir: path.join(LIVE_DIR, `local-test-${url.port || '80'}`) };
  throw new LiveTargetError(`${url.origin} is not an approved import target. Approved: ${LIVE_TARGETS.join(', ')}${local ? ' (a local server needs --local-test)' : ''}.`);
}

/** API client bound to one validated target. */
export class LiveApi extends CmsApiClient {
  constructor(readonly target: LiveTarget, transport?: Transport) {
    resolveLiveTarget(target.origin, { allowLocalTest: target.local }); // re-checked where the client is built
    super(target.origin, transport);
    this.readOnly = true; // plan-only until a confirmed run arms it
  }
}

export interface LiveCredentials { email: string; password: string; totpCode?: string }

/** Signs in and checks that the account and the site can run an import. Throws with the reason otherwise. */
export async function openLiveSession(target: LiveTarget, credentials: LiveCredentials, transport?: Transport): Promise<{ api: LiveApi; admin: string }> {
  const api = new LiveApi(target, transport);
  const who = await api.login(credentials);
  if (who.role !== 'Admin') { await api.logout(); throw new LiveTargetError(`The account is "${who.role}". An import needs an Admin (creating sports is Admin-only).`); }
  // The import release must be deployed: the origin filter exists only with the ArticleImport table and the import record API.
  const capability = await api.request('GET', '/api/cms/articles/search?origin=wordpress&limit=1');
  if (capability.status !== 200) { await api.logout(); throw new LiveTargetError(`${target.origin} does not have the import release yet (the import-record search answered ${capability.status}). Deploy it and apply its database migration first.`); }
  return { api, admin: who.name };
}

export const confirmationPhrase = (action: 'IMPORT' | 'ROLLBACK', count: number, target: LiveTarget) => `${action} ${count} ${count === 1 ? 'POST' : 'POSTS'} ${action === 'IMPORT' ? 'INTO' : 'FROM'} ${target.host}`;

export interface LivePlan {
  target: string;
  mode: 'plan' | 'import';
  admin: string;
  entitiesToCreate: { sports: string[]; authorProfiles: string[] };
  wouldCreate: string[];
  alreadyImported: string[];
  toResume: string[];
  refused: { id: string; reason: string }[];
  confirmation: string;
}
export interface LiveOptions {
  /** Restrict the run to these WordPress IDs (for a first small batch). Default: every post. */
  only?: string[];
  execute?: boolean;
  confirm?: string;
  batchSize?: number;
  onProgress?: (line: string) => void;
}
export interface LiveRunResult { plan: LivePlan; executed: boolean; entities?: Awaited<ReturnType<typeof ensureEntities>>; import?: ImportReport; verification?: LiveVerification }

interface Run { target: LiveTarget; api: LiveApi; admin: string; state: { armed: boolean } }

/** The context the shared importer works with: no database, no local environment; the target's own guard. */
function contextOf(run: Run): PilotContext {
  const { target, api, state } = run;
  return {
    env: {}, api, ...locateBackup(), manifestFile: path.join(target.dir, 'manifest.json'), dryRunDir: path.join(target.dir, 'dry-run'),
    target: {
      name: target.origin,
      hideNewSports: true,
      guard: (step) => {
        resolveLiveTarget(target.origin, { allowLocalTest: target.local });
        if (api.base !== target.origin) throw new PilotIsolationError(`Refusing "${step}": the client is not bound to ${target.origin}.`);
        if (!state.armed && !/^(import WordPress posts|import WordPress post \d+)$/.test(step)) throw new PilotIsolationError(`Refusing "${step}": this run is plan-only.`);
      },
    },
  };
}

/** The dry run against the target's own state. It has no database code and gets a bare environment and file paths only. */
async function dryRunFor(run: Run, ctx: PilotContext): Promise<any> {
  fs.mkdirSync(run.target.dir, { recursive: true });
  const snapshotFile = path.join(run.target.dir, 'cms-snapshot.json');
  fs.writeFileSync(snapshotFile, JSON.stringify(await destinationSnapshot(ctx), null, 2));
  const bare = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|HOME)$/i.test(k)));
  const done = spawnSync(process.execPath, ['--import', 'tsx', 'server/scripts/wordpress-dry-run.ts', '--wxr', ctx.wxrFile, '--uploads-zip', ctx.zipFile, '--cms', snapshotFile, '--out', ctx.dryRunDir!], { env: bare as NodeJS.ProcessEnv, encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 });
  if (done.status !== 0) throw new Error(`The dry run against ${run.target.origin} failed.\n${(done.stderr || done.stdout).slice(-800)}`);
  return JSON.parse(fs.readFileSync(path.join(ctx.dryRunDir!, 'manifest.json'), 'utf8'));
}

function selection(dry: any, only?: string[]): string[] {
  const all: string[] = dry.posts.map((p: any) => p.wordpressId);
  if (!only) return all;
  const unknown = only.filter((id) => !all.includes(id));
  if (unknown.length || new Set(only).size !== only.length) throw new Error(`Not WordPress post IDs of this export (or repeated): ${unknown.join(', ') || 'duplicates'}.`);
  return all.filter((id) => only.includes(id));
}

async function planFor(run: Run, ctx: PilotContext, dry: any, ids: string[]): Promise<LivePlan> {
  const cms = (await run.api.request('GET', '/api/cms/data')).data;
  const sportsMissing = NEW_SPORTS.map((s) => s.slug).filter((slug) => !cms.sports.some((s: any) => s.slug === slug));
  const authorsMissing = Object.values(AUTHOR_PROFILE_SLUGS).filter((slug) => !cms.authors.some((a: any) => a.slug === slug));
  const report = await importPilot(ctx, ids, { allowed: ids, planOnly: true });
  // A post that only waits for an approved sport counts as "would create": the import creates that sport first.
  const waiting = report.refused.filter((r) => { const slug = (dry.posts as any[]).find((p) => p.wordpressId === r.id)?.plannedDraft.sportSlug; return /does not exist in the destination/.test(r.reason) && sportsMissing.includes(slug); });
  const wouldCreate = ids.filter((id) => report.wouldCreate.includes(id) || waiting.some((w) => w.id === id));
  const toResume = report.skipped.filter((s) => /not finished|not in the manifest/.test(s.reason)).map((s) => s.id);
  const neededSports = new Set(wouldCreate.map((id) => (dry.posts as any[]).find((p) => p.wordpressId === id).plannedDraft.sportSlug));
  const neededAuthors = new Set(wouldCreate.map((id) => (dry.posts as any[]).find((p) => p.wordpressId === id).plannedDraft.authorSlug));
  return {
    target: run.target.origin, mode: 'plan', admin: run.admin,
    entitiesToCreate: { sports: sportsMissing.filter((s) => neededSports.has(s)), authorProfiles: authorsMissing.filter((a) => neededAuthors.has(a)) },
    wouldCreate, toResume,
    alreadyImported: report.skipped.filter((s) => !toResume.includes(s.id)).map((s) => s.id),
    refused: report.refused.filter((r) => !waiting.includes(r)),
    confirmation: confirmationPhrase('IMPORT', wouldCreate.length + toResume.length, run.target),
  };
}

/**
 * Plans, and — only with `execute` and the exact confirmation phrase — imports.
 * Safe to re-run at any point.
 */
export async function runLiveImport(session: { target: LiveTarget; api: LiveApi; admin: string }, options: LiveOptions = {}): Promise<LiveRunResult> {
  const run: Run = { ...session, state: { armed: false } };
  const ctx = contextOf(run);
  const say = options.onProgress ?? (() => undefined);
  const dry = await dryRunFor(run, ctx);
  const ids = selection(dry, options.only);
  const plan = await planFor(run, ctx, dry, ids);
  const todo = plan.wouldCreate.length + plan.toResume.length;
  if (!options.execute) return { plan, executed: false };
  if (!todo) { say('Nothing to import: every selected post is already imported or refused.'); return { plan, executed: false }; }
  if (options.confirm !== plan.confirmation) throw new LiveTargetError(`Not confirmed. To import, repeat the command with --execute --confirm "${plan.confirmation}"`);

  run.state.armed = true;
  run.api.readOnly = false;
  try {
    const manifest = loadManifest(run.target.origin, ctx.manifestFile);
    manifest.history.push(`${new Date().toISOString()} run started by ${run.admin}: ${plan.confirmation}`);
    fs.mkdirSync(run.target.dir, { recursive: true });
    fs.writeFileSync(ctx.manifestFile!, JSON.stringify(manifest, null, 2));
    // Only the sports and profiles this selection needs.
    const neededSports = new Set(plan.entitiesToCreate.sports);
    const entities = neededSports.size || plan.entitiesToCreate.authorProfiles.length ? await ensureEntities(ctx, { sports: [...neededSports], authors: plan.entitiesToCreate.authorProfiles }) : { sportsCreated: [], sportsExisting: [], authorsCreated: [], authorsExisting: [] };
    say(`Sports created (hidden): ${entities.sportsCreated.join(', ') || 'none'}. Author profiles created: ${entities.authorsCreated.join(', ') || 'none'}.`);
    const fresh = entities.sportsCreated.length || entities.authorsCreated.length ? await dryRunFor(run, ctx) : dry;
    const size = Math.min(10, Math.max(1, options.batchSize ?? 5));
    const total: ImportReport = { created: [], resumed: [], wouldCreate: [], skipped: [], refused: [], media: { uploaded: 0, reused: 0 }, faq: 0, authorsCreated: [] };
    const work = selection(fresh, ids);
    for (let i = 0; i < work.length; i += size) {
      const batch = work.slice(i, i + size);
      const r = await importPilot(ctx, batch, { allowed: work, onProgress: say });
      for (const key of ['created', 'resumed', 'skipped', 'refused', 'authorsCreated'] as const) (total[key] as unknown[]).push(...r[key]);
      total.media.uploaded += r.media.uploaded; total.media.reused += r.media.reused; total.faq += r.faq;
      say(`Batch ${Math.floor(i / size) + 1}/${Math.ceil(work.length / size)}: created ${r.created.length}, resumed ${r.resumed.length}, skipped ${r.skipped.length}, refused ${r.refused.length}. Total so far: ${total.created.length} created, ${total.resumed.length} resumed, ${total.refused.length} refused.`);
    }
    const verification = await verifyLive(session, { ids: work });
    return { plan: { ...plan, mode: 'import' }, executed: true, entities, import: total, verification };
  } finally { run.state.armed = false; run.api.readOnly = true; }
}

export interface LiveVerification { ok: boolean; problems: string[]; checked: number; drafts: number; reviewRequired: number; scheduled: number; published: number; faq: number; images: number; importRecords: number; workflowProbed: boolean }

/**
 * Reads every imported article back through the API and compares it with the
 * manifest and the dry run. Read-only on a real site. Only against a local
 * test server does it also try to publish (which must be refused).
 */
export async function verifyLive(session: { target: LiveTarget; api: LiveApi; admin: string }, options: { ids?: string[] } = {}): Promise<LiveVerification> {
  const ctx = contextOf({ ...session, state: { armed: false } });
  const manifest = loadManifest(session.target.origin, ctx.manifestFile);
  const dry = JSON.parse(fs.readFileSync(path.join(ctx.dryRunDir!, 'manifest.json'), 'utf8'));
  const problems: string[] = [];
  const out: LiveVerification = { ok: false, problems, checked: 0, drafts: 0, reviewRequired: 0, scheduled: 0, published: 0, faq: 0, images: 0, importRecords: 0, workflowProbed: session.target.local };
  for (const [id, record] of Object.entries(manifest.posts)) {
    if (options.ids && !options.ids.includes(id)) continue;
    const want = (dry.posts as any[]).find((p) => p.wordpressId === id);
    const got = await session.api.request('GET', `/api/articles/${record.articleId}`);
    if (got.status !== 200 || !want) { problems.push(`Post ${id}: article ${record.articleId} could not be read (${got.status}).`); continue; }
    const a = got.data;
    out.checked++;
    if (a.status === 'draft') out.drafts++; else problems.push(`Post ${id}: status is ${a.status}.`);
    if (a.reviewStatus === 'draft') out.reviewRequired++; else problems.push(`Post ${id}: review status is ${a.reviewStatus}.`);
    if (a.scheduledFor || a.status === 'scheduled') { out.scheduled++; problems.push(`Post ${id}: has a publication time.`); }
    if (a.status === 'published') out.published++;
    if (a.title !== want.title || a.slug !== want.slug || a.sportSlug !== want.plannedDraft.sportSlug || (a.eventSlug ?? null) !== want.plannedDraft.eventSlug) problems.push(`Post ${id}: title, slug, sport or event differs from the plan.`);
    if (new Date(a.publishedAt).toISOString() !== new Date(want.plannedDraft.publishedAt).toISOString()) problems.push(`Post ${id}: publication date differs.`);
    const seen = { tables: 0, merged: 0, images: 0, embeds: 0, links: 0 };
    const walk = (n: any) => { if (n.type === 'table') seen.tables++; if ((n.type === 'tableCell' || n.type === 'tableHeader') && (n.attrs.colspan > 1 || n.attrs.rowspan > 1)) seen.merged++; if (n.type === 'image') seen.images++; if (n.type === 'embed') seen.embeds++; for (const m of n.marks ?? []) if (m.type === 'link') seen.links++; (n.content ?? []).forEach(walk); };
    (a.body?.content ?? []).forEach(walk);
    if (seen.tables !== want.counts.tables || seen.merged !== want.counts.mergedCells || seen.images !== want.counts.inlineImagesPlaced || seen.embeds !== want.counts.embeds || seen.links !== want.counts.links) problems.push(`Post ${id}: body differs (tables ${seen.tables}/${want.counts.tables}, merged cells ${seen.merged}/${want.counts.mergedCells}, images ${seen.images}/${want.counts.inlineImagesPlaced}, embeds ${seen.embeds}/${want.counts.embeds}, links ${seen.links}/${want.counts.links}).`);
    if (want.featuredImage.available && !a.featuredMediaId) problems.push(`Post ${id}: featured image is missing.`);
    out.images += seen.images + (a.featuredMediaId ? 1 : 0);
    const faq = await session.api.request('GET', `/api/faq?context=article:${record.articleId}`);
    const entries: any[] = Array.isArray(faq.data) ? faq.data : [];
    if (entries.length !== want.counts.faq || entries.some((e) => e.status !== 'draft')) problems.push(`Post ${id}: ${entries.length} FAQ entries (expected ${want.counts.faq} drafts).`);
    out.faq += entries.length;
    const origin = (await session.api.request('GET', `/api/articles/${record.articleId}/import-source`)).data?.importSource;
    if (origin?.source === 'wordpress' && origin.sourceId === id) out.importRecords++; else problems.push(`Post ${id}: no matching import record.`);
    if (record.complete === false) problems.push(`Post ${id}: the import did not finish; run it again.`);
    if (session.target.local) {
      // Test servers only: the workflow must refuse; a refused request changes nothing.
      const wasReadOnly = session.api.readOnly; session.api.readOnly = false;
      if ((await session.api.request('PUT', `/api/articles/${record.articleId}`, { status: 'published' })).status !== 409) problems.push(`Post ${id}: publishing was NOT refused.`);
      if ((await session.api.request('PUT', `/api/articles/${record.articleId}`, { status: 'scheduled', scheduledFor: new Date(Date.now() + 86_400_000).toISOString() })).status !== 409) problems.push(`Post ${id}: scheduling was NOT refused.`);
      session.api.readOnly = wasReadOnly;
    }
  }
  out.ok = problems.length === 0;
  return out;
}

/** Removes untouched drafts this import created, after the exact confirmation phrase. Plan-only by default. */
export async function runLiveRollback(session: { target: LiveTarget; api: LiveApi; admin: string }, options: { execute?: boolean; confirm?: string } = {}): Promise<{ wouldRemove: string[]; confirmation: string; executed: boolean; report?: RollbackReport }> {
  const run: Run = { ...session, state: { armed: false } };
  const ctx = contextOf(run);
  const manifest = loadManifest(session.target.origin, ctx.manifestFile);
  const wouldRemove = Object.keys(manifest.posts);
  const confirmation = confirmationPhrase('ROLLBACK', wouldRemove.length, session.target);
  if (!options.execute) return { wouldRemove, confirmation, executed: false };
  if (options.confirm !== confirmation) throw new LiveTargetError(`Not confirmed. To roll back, repeat the command with --execute --confirm "${confirmation}"`);
  run.state.armed = true;
  run.api.readOnly = false;
  try { return { wouldRemove, confirmation, executed: true, report: await rollbackPilot(ctx) }; } finally { run.state.armed = false; run.api.readOnly = true; }
}

/** A stable fingerprint of a plan, written to the run log for audit. */
export const planFingerprint = (plan: LivePlan) => crypto.createHash('sha256').update(JSON.stringify([plan.target, plan.wouldCreate, plan.toResume, plan.entitiesToCreate])).digest('hex').slice(0, 16);
