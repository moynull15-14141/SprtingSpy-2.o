/**
 * Old-site migration sheet (PHASE R, Spec §27).
 *
 * The sheet holds one row per old URL with the columns the specification
 * names: Old URL | Old Category | Old Title | Decision | New Category |
 * New Title | New URL | 301. The INVENTORY ITSELF IS OWNER INPUT (a crawl or
 * export of the current site); this module stores it, validates every row
 * and applies the resulting 301s through the redirect manager.
 *
 * Decisions: KEEP / REWRITE / MERGE redirect old → new with a 301 (unless the
 * URL is unchanged); RETIRE has no redirect (the old URL returns a real 404,
 * Spec §20.5 / §27.5 — never a blanket homepage redirect).
 *
 * PHASE N (v2.2 §25): chains and loops are also detected inside the sheet
 * before anything is applied; a RETIRE row is an error while any active rule
 * still redirects its URL; a KEEP row with an unchanged URL must be a live
 * page; editing an applied row's New URL makes the next apply update its rule
 * (never a silent mismatch); absolute URLs must be on this site or the old
 * site (LEGACY_SITE_HOSTS). The dry run performs the real writes in a
 * transaction that is always rolled back.
 *
 *   GET    /api/migration                 rows + counts          Admin, Editor
 *   GET    /api/migration/export          CSV                    Admin, Editor
 *   POST   /api/migration/import          { csv } or { rows }    Admin
 *   PUT    /api/migration/:id             edit one row           Admin, Editor
 *   DELETE /api/migration/:id                                    Admin
 *   POST   /api/migration/validate        re-check every row     Admin, Editor
 *   POST   /api/migration/apply           { dryRun }             Admin
 */

import crypto from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import { prisma } from './db';
import { requireRole, type AuthLookup } from './auth';
import { recordAudit } from './audit';
import { loadSiteIndex } from './seo/siteIndex';
import { saveRedirect, normalizeSource, RedirectConflict } from './redirects';
import { siteOrigin } from '../src/lib/paths';

export const DECISIONS = ['UNDECIDED', 'KEEP', 'REWRITE', 'MERGE', 'RETIRE'] as const;
export type Decision = (typeof DECISIONS)[number];
export const SHEET_COLUMNS = ['Old URL', 'Old Category', 'Old Title', 'Decision', 'New Category', 'New Title', 'New URL', '301'] as const;
const MAX_ROWS = 20000;

/**
 * PHASE N: hosts whose absolute URLs belong to this site — the canonical
 * host, its www/apex twin, and the old site's hosts (LEGACY_SITE_HOSTS,
 * comma-separated; default the current WordPress site www.sportingspy.com).
 * Anything else is a cross-domain mistake, never silently reduced to a path.
 */
export function siteHosts(): Set<string> {
  const own = new URL(siteOrigin()).hostname.toLowerCase();
  const bare = own.replace(/^www\./, '');
  const legacy = (process.env.LEGACY_SITE_HOSTS ?? 'www.sportingspy.com,sportingspy.com').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  return new Set([own, bare, `www.${bare}`, ...legacy]);
}

/** A site path from a path or an absolute http(s) URL on one of `siteHosts()`; query/hash dropped. */
function sitePath(value: string): { path: string; query: boolean } | { error: 'format' | 'host'; host?: string } {
  if (/^https?:\/\//i.test(value)) {
    let u: URL;
    try { u = new URL(value); } catch { return { error: 'format' }; }
    if (!siteHosts().has(u.hostname.toLowerCase())) return { error: 'host', host: u.hostname };
    return { path: u.pathname, query: !!u.search };
  }
  if (!value.startsWith('/') || value.startsWith('//')) return { error: 'format' };
  return { path: value.split(/[?#]/)[0], query: /\?./.test(value.split('#')[0]) };
}

/** An old URL as a site path (absolute URLs keep only path; no query/hash; no trailing slash). */
export function oldPath(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const parsed = sitePath(value);
  if ('error' in parsed) return null;
  if (parsed.path.length > 1000 || /[\s<>"]/.test(parsed.path)) return null;
  return normalizeSource(parsed.path) || '/';
}

/** A new URL: an internal path (stored without trailing slash) or empty. */
function newPath(raw: string): string | null {
  const value = raw.trim();
  if (!value) return '';
  const parsed = sitePath(value);
  if ('error' in parsed) return null;
  return normalizeSource(parsed.path) || '/';
}

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

type Row = { oldUrl: string; oldCategory: string; oldTitle: string; decision: Decision; newCategory: string; newTitle: string; newUrl: string; notes: string };

function parseRow(input: Record<string, unknown>): { ok: true; row: Row } | { ok: false; error: string } {
  const text = (k: string, max: number) => (typeof input[k] === 'string' ? (input[k] as string).trim().slice(0, max) : '');
  const rawOld = text('oldUrl', 2000);
  const parsedOld = rawOld ? sitePath(rawOld) : null;
  if (parsedOld && 'error' in parsedOld && parsedOld.error === 'host') return { ok: false, error: `Old URL host ${parsedOld.host} is not this site or the old site (${[...siteHosts()].join(', ')}). Set LEGACY_SITE_HOSTS if the old site used another host.` };
  const old = oldPath(rawOld);
  if (!old) return { ok: false, error: 'Old URL must be a path (/old-page) or an absolute http(s) URL.' };
  // Redirects match paths only, so "/?p=123" would silently become a rule for the homepage.
  if (old === '/' && parsedOld && 'query' in parsedOld && parsedOld.query) return { ok: false, error: 'Old URL is the homepage with a query string (such as /?p=123). Redirects match the path only, so this URL cannot be redirected on its own; list the post\'s real URL instead.' };
  const decision = (text('decision', 20).toUpperCase() || 'UNDECIDED') as Decision;
  if (!DECISIONS.includes(decision)) return { ok: false, error: `Decision must be one of: ${DECISIONS.join(', ')}.` };
  const target = newPath(text('newUrl', 2000));
  if (target === null) return { ok: false, error: 'New URL must be a path on this site (or a full URL on this site).' };
  return { ok: true, row: { oldUrl: old, oldCategory: text('oldCategory', 200), oldTitle: text('oldTitle', 500), decision, newCategory: text('newCategory', 200), newTitle: text('newTitle', 500), newUrl: target, notes: text('notes', 2000) } };
}

type Site = Awaited<ReturnType<typeof loadSiteIndex>>;

const REDIRECTING: Decision[] = ['KEEP', 'REWRITE', 'MERGE'];

/**
 * PHASE N: what else a row is checked against.
 * - `sheet`: every row by Old URL (chains/loops inside the sheet, before anything is applied)
 * - `ownRule`: the redirect this row applied earlier (active or not)
 * - `inactiveSources`: sources of inactive rules the row does not own (one rule per source)
 */
export interface RowContext {
  sheet?: Map<string, Pick<Row, 'decision' | 'newUrl'>>;
  ownRule?: { targetUrl: string; isActive: boolean } | null;
  inactiveSources?: Lookup;
}

/** Source → normalised target (only `get` is used, so a row's own rule can be excluded cheaply). */
type Lookup = Pick<Map<string, string>, 'get'>;

/** Problems with one row against the live site and the rest of the sheet. `redirects` = active rules NOT owned by this row. */
export function checkRow(row: Row, site: Site, redirects: Lookup, ctx: RowContext = {}): { status: 'ok' | 'error' | 'pending'; problems: string[]; action: 'redirect' | 'none' | 'retire' | 'undecided' } {
  const problems: string[] = [];
  const ownActive = ctx.ownRule?.isActive ? ctx.ownRule.targetUrl : undefined;
  const activeAtOld = ownActive ?? redirects.get(row.oldUrl);
  if (row.decision === 'UNDECIDED') return { status: 'pending', problems: ['No decision yet.'], action: 'undecided' };
  if (row.decision === 'RETIRE') {
    if (row.newUrl) problems.push('RETIRE rows do not redirect. Use MERGE to send this URL to a relevant replacement.');
    if (site.resolve(row.oldUrl)) problems.push(`${row.oldUrl}/ is a live page on the new site, so it is not retired.`);
    // A retired URL must answer 404; an active rule would keep sending visitors elsewhere.
    else if (activeAtOld) problems.push(`An active redirect still sends ${row.oldUrl}/ to ${activeAtOld}/, so it does not return 404. Deactivate or delete that redirect in URL Redirects.`);
    return { status: problems.length ? 'error' : 'ok', problems, action: 'retire' };
  }
  if (!row.newUrl) problems.push(`${row.decision} needs a New URL.`);
  else if (row.newUrl === row.oldUrl) {
    // Same URL on the new site: it must really be served there.
    if (activeAtOld) problems.push(`An active redirect sends ${row.oldUrl}/ to ${activeAtOld}/, so the page is not served at its old URL.`);
    else if (!site.resolve(row.oldUrl)) problems.push(`${row.oldUrl}/ is not a live page on the new site (it would return 404). Publish it there, or give a New URL.`);
    return { status: problems.length ? 'error' : 'ok', problems, action: 'none' };
  } else {
    if (row.newUrl === '/' && row.oldUrl !== '/') problems.push('Redirecting to the homepage is not allowed for unrelated pages (Spec §27.5). Choose the relevant new page, or RETIRE.');
    const chained = redirects.get(row.newUrl);
    const next = ctx.sheet?.get(row.newUrl);
    if (chained) problems.push(`New URL ${row.newUrl}/ is itself redirected to ${chained}/ — point directly at the final URL.`);
    else if (next && next.decision === 'RETIRE') problems.push(`New URL ${row.newUrl}/ is RETIRED in this sheet (it will return 404). Choose a live replacement.`);
    else if (next && REDIRECTING.includes(next.decision as Decision) && next.newUrl && next.newUrl !== row.newUrl) {
      problems.push(next.newUrl === row.oldUrl
        ? `New URL ${row.newUrl}/ redirects back to ${row.oldUrl}/ in this sheet — that is a loop.`
        : `New URL ${row.newUrl}/ is itself an Old URL in this sheet (→ ${next.newUrl}/) — point directly at the final URL.`);
    } else if (!site.resolve(row.newUrl)) problems.push(`New URL ${row.newUrl}/ is not a live page yet (it would return 404). Publish the content first.`);
    const live = site.resolve(row.oldUrl);
    if (live) problems.push(`Old URL ${row.oldUrl}/ is a live page on the new site; a redirect would hide it.`);
    const existing = redirects.get(row.oldUrl);
    if (existing && existing !== row.newUrl) problems.push(`A redirect for ${row.oldUrl} already exists (→ ${existing}).`);
    const inactive = ctx.inactiveSources?.get(row.oldUrl);
    if (inactive) problems.push(`An inactive redirect rule for ${row.oldUrl} (→ ${inactive}) already exists. Reactivate or delete it in URL Redirects; a URL can have only one rule.`);
  }
  return { status: problems.length ? 'error' : 'ok', problems, action: 'redirect' };
}

/** A row's redirect is applied when the rule it created is active and points at its New URL. */
const isApplied = (row: Pick<Row, 'newUrl'>, own: { targetUrl: string; isActive: boolean } | null | undefined) =>
  !!own && own.isActive && (own.targetUrl.replace(/\/$/, '') || '/') === row.newUrl;

export function migrationRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
  const staff = requireRole(getLookup, ['Admin', 'Editor']);
  const admin = requireRole(getLookup, ['Admin']);
  const actor = (req: Request) => ({ userId: req.authContext!.userId, userName: req.authContext!.userName });

  async function revalidateAll() {
    const [rows, site, rules] = await Promise.all([
      prisma.migrationItem.findMany(),
      loadSiteIndex(siteOrigin()),
      prisma.redirectRule.findMany({ select: { sourceUrl: true, targetUrl: true, id: true, isActive: true } }),
    ]);
    const target = (url: string) => url.replace(/\/$/, '') || '/';
    const ruleById = new Map(rules.map((r) => [r.id, r]));
    const sheet = new Map(rows.map((r) => [r.oldUrl, r as Row]));
    const active = new Map(rules.filter((r) => r.isActive).map((r) => [r.sourceUrl, r]));
    const inactive = new Map(rules.filter((r) => !r.isActive).map((r) => [r.sourceUrl, r]));
    // One rule per source, so "every rule except the row's own" is a lookup that skips its id.
    const except = (map: Map<string, (typeof rules)[number]>, ownId?: string): Lookup => ({ get: (src) => { const r = map.get(src); return r && r.id !== ownId ? target(r.targetUrl) : undefined; } });
    for (const row of rows) {
      // PHASE N: the rule this row applied is checked as the row's own (even if
      // it was later deactivated or re-targeted); every other rule is a conflict.
      const own = row.redirectId ? ruleById.get(row.redirectId) : undefined;
      const redirects = except(active, own?.id);
      const inactiveSources = except(inactive, own?.id);
      const ownRule = own ? { targetUrl: target(own.targetUrl), isActive: own.isActive } : null;
      const result = checkRow(row as Row, site, redirects, { sheet, ownRule, inactiveSources });
      const applied = result.action === 'redirect' && isApplied(row as Row, ownRule);
      const appliedTo = own?.isActive ? target(own.targetUrl) : null;
      await prisma.migrationItem.update({ where: { id: row.id }, data: { checkStatus: result.status, validation: { problems: result.problems, action: result.action, applied, appliedTo } } });
    }
    return rows.length;
  }

  router.get('/', staff, wrap(async (req, res) => {
    const where: Record<string, unknown> = {};
    if (typeof req.query.decision === 'string' && DECISIONS.includes(req.query.decision as Decision)) where.decision = req.query.decision;
    if (typeof req.query.status === 'string' && ['ok', 'error', 'pending'].includes(req.query.status)) where.checkStatus = req.query.status;
    const page = Math.max(1, Number(req.query.page) || 1);
    const [rows, total, byDecision, byStatus] = await Promise.all([
      prisma.migrationItem.findMany({ where, orderBy: [{ oldUrl: 'asc' }], take: 200, skip: (page - 1) * 200 }),
      prisma.migrationItem.count({ where }),
      prisma.migrationItem.groupBy({ by: ['decision'], _count: { _all: true } }),
      prisma.migrationItem.groupBy({ by: ['checkStatus'], _count: { _all: true } }),
    ]);
    return res.json({ rows, total, page, pageSize: 200, counts: { decision: Object.fromEntries(byDecision.map((r) => [r.decision, r._count._all])), status: Object.fromEntries(byStatus.map((r) => [r.checkStatus, r._count._all])) }, columns: SHEET_COLUMNS });
  }));

  router.get('/export', staff, wrap(async (_req, res) => {
    // PHASE N: "301 = yes" only when the row's own rule is active AND points at its New URL.
    const rows = await prisma.migrationItem.findMany({ orderBy: { oldUrl: 'asc' } });
    const rules = new Map((await prisma.redirectRule.findMany({ where: { id: { in: rows.map((r) => r.redirectId).filter((v): v is string => !!v) } }, select: { id: true, targetUrl: true, isActive: true } })).map((r) => [r.id, r]));
    const lines = [SHEET_COLUMNS.join(','), ...rows.map((r) => [r.oldUrl, r.oldCategory, r.oldTitle, r.decision, r.newCategory, r.newTitle, r.newUrl ? `${r.newUrl}${r.newUrl === '/' ? '' : '/'}` : '', REDIRECTING.includes(r.decision as Decision) && isApplied(r, r.redirectId ? rules.get(r.redirectId) : null) ? 'yes' : 'no'].map((v) => csvCell(String(v))).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sportingspy-migration-sheet.csv"');
    return res.send(lines.join('\r\n'));
  }));

  router.post('/import', admin, wrap(async (req, res) => {
    let inputs: Record<string, unknown>[] = [];
    if (typeof req.body?.csv === 'string') {
      const table = parseCsv(req.body.csv);
      if (!table.length) return res.status(400).json({ error: 'The CSV is empty.' });
      const header = table[0].map((h) => h.trim().toLowerCase());
      const col = (name: string) => header.indexOf(name.toLowerCase());
      if (col('Old URL') === -1) return res.status(400).json({ error: `The first row must be the header: ${SHEET_COLUMNS.join(', ')}.` });
      inputs = table.slice(1).map((cells) => ({
        oldUrl: cells[col('Old URL')] ?? '', oldCategory: cells[col('Old Category')] ?? '', oldTitle: cells[col('Old Title')] ?? '', decision: cells[col('Decision')] ?? '',
        newCategory: cells[col('New Category')] ?? '', newTitle: cells[col('New Title')] ?? '', newUrl: cells[col('New URL')] ?? '', notes: col('Notes') >= 0 ? cells[col('Notes')] : '',
      }));
    } else if (Array.isArray(req.body?.rows)) inputs = req.body.rows;
    else return res.status(400).json({ error: 'Send { csv } or { rows }.' });
    if (!inputs.length) return res.status(400).json({ error: 'No rows to import.' });
    if (inputs.length > MAX_ROWS) return res.status(400).json({ error: `At most ${MAX_ROWS} rows per import.` });
    const errors: { row: number; error: string }[] = [];
    const parsed: Row[] = [];
    const seen = new Set<string>();
    inputs.forEach((input, i) => {
      const r = parseRow(input || {});
      if (!r.ok) errors.push({ row: i + 2, error: (r as { error: string }).error });
      else if (seen.has(r.row.oldUrl)) errors.push({ row: i + 2, error: `Duplicate Old URL ${r.row.oldUrl}.` });
      else { seen.add(r.row.oldUrl); parsed.push(r.row); }
    });
    if (errors.length) return res.status(400).json({ error: `${errors.length} row(s) could not be read. Nothing was imported.`, errors: errors.slice(0, 200) });
    const now = new Date();
    for (let i = 0; i < parsed.length; i += 500) {
      await prisma.$transaction(parsed.slice(i, i + 500).map((r) => prisma.migrationItem.upsert({
        where: { oldUrl: r.oldUrl },
        create: { id: `mig-${crypto.randomUUID()}`, ...r, checkStatus: 'pending', updatedBy: req.authContext!.userName, updatedAt: now },
        update: { ...r, checkStatus: 'pending', updatedBy: req.authContext!.userName },
      })));
    }
    await revalidateAll();
    await recordAudit(prisma, { ...actor(req), action: 'Imported Migration Sheet', entityType: 'Migration', entityId: 'migration-sheet', details: `${req.authContext!.userName} imported ${parsed.length} migration row(s).` });
    return res.status(201).json({ imported: parsed.length });
  }));

  router.put('/:id', staff, wrap(async (req, res) => {
    const existing = await prisma.migrationItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Migration row not found.' });
    const parsed = parseRow({ ...existing, ...req.body, oldUrl: existing.oldUrl });
    if (!parsed.ok) return res.status(400).json({ error: (parsed as { error: string }).error });
    const updated = await prisma.migrationItem.update({ where: { id: existing.id }, data: { ...parsed.row, updatedBy: req.authContext!.userName } });
    await revalidateAll();
    await recordAudit(prisma, { ...actor(req), action: 'Updated Migration Row', entityType: 'Migration', entityId: existing.id, details: `${req.authContext!.userName} updated ${existing.oldUrl}.`, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, fields: ['decision', 'newCategory', 'newTitle', 'newUrl', 'notes'] });
    return res.json(await prisma.migrationItem.findUnique({ where: { id: existing.id } }));
  }));

  router.delete('/:id', admin, wrap(async (req, res) => {
    const existing = await prisma.migrationItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Migration row not found.' });
    await prisma.migrationItem.delete({ where: { id: existing.id } });
    await recordAudit(prisma, { ...actor(req), action: 'Deleted Migration Row', entityType: 'Migration', entityId: existing.id, details: `${req.authContext!.userName} removed ${existing.oldUrl} from the migration sheet (its redirect, if any, is kept).` });
    return res.json({ success: true });
  }));

  router.post('/validate', staff, wrap(async (_req, res) => res.json({ checked: await revalidateAll() })));

  /**
   * PHASE N: the dry run runs exactly the writes a real apply would (same
   * redirect-manager checks, inside a transaction that is always rolled
   * back), so a conflict found only at write time shows up in the preview.
   * A real apply is all-or-nothing: any conflict rolls the whole batch back.
   */
  router.post('/apply', admin, wrap(async (req, res) => {
    const dryRun = req.body?.dryRun !== false;
    await revalidateAll();
    const rows = await prisma.migrationItem.findMany({ orderBy: { oldUrl: 'asc' } });
    const v = (r: (typeof rows)[number]) => (r.validation || {}) as { action?: string; applied?: boolean; problems?: string[] };
    const ownIds = rows.map((r) => r.redirectId).filter((id): id is string => !!id);
    const owned = new Set((await prisma.redirectRule.findMany({ where: { id: { in: ownIds } }, select: { id: true } })).map((r) => r.id));
    const todo = rows.filter((r) => r.checkStatus === 'ok' && v(r).action === 'redirect' && !v(r).applied);
    const plan = todo.map((r) => ({ id: r.id, from: r.oldUrl, to: r.newUrl, change: r.redirectId && owned.has(r.redirectId) ? 'update' as const : 'create' as const }));
    const summary = {
      create: plan.filter((p) => p.change === 'create').length,
      update: plan.filter((p) => p.change === 'update').length,
      alreadyApplied: rows.filter((r) => r.checkStatus === 'ok' && v(r).applied).length,
      unchanged: rows.filter((r) => r.checkStatus === 'ok' && v(r).action === 'none').length,
      retire: rows.filter((r) => r.checkStatus === 'ok' && v(r).action === 'retire').length,
      undecided: rows.filter((r) => r.checkStatus === 'pending').length,
      errors: rows.filter((r) => r.checkStatus === 'error').length,
    };
    const errors = rows.filter((r) => r.checkStatus === 'error').slice(0, 500).map((r) => ({ from: r.oldUrl, problems: v(r).problems ?? [] }));
    const retire = rows.filter((r) => r.checkStatus === 'ok' && v(r).action === 'retire').slice(0, 2000).map((r) => r.oldUrl);

    class RolledBack extends Error {}
    const conflicts: { from: string; error: string }[] = [];
    let created = 0, updated = 0;
    try {
      await prisma.$transaction(async (tx) => {
        for (const [i, p] of plan.entries()) {
          const r = todo[i];
          const input = { sourceUrl: r.oldUrl, targetUrl: r.newUrl, statusCode: 301, isActive: true, origin: 'migration' as const, notes: `Migration sheet (${r.decision}): ${r.oldTitle || r.oldUrl}` };
          try {
            const rule = p.change === 'update' ? await saveRedirect(tx, input, 'update', r.redirectId!) : await saveRedirect(tx, input, 'create');
            await tx.migrationItem.update({ where: { id: r.id }, data: { redirectId: rule.id } });
            if (p.change === 'update') updated++; else created++;
          } catch (err) {
            if (!(err instanceof RedirectConflict)) throw err;
            conflicts.push({ from: r.oldUrl, error: err.message });
          }
        }
        if (dryRun || conflicts.length) throw new RolledBack();
      }, { timeout: 120_000 });
    } catch (err) {
      if (!(err instanceof RolledBack)) throw err;
    }
    const report = { redirects: plan, blockedRows: summary.errors, summary, errors, retire, conflicts };
    if (dryRun) return res.json({ dryRun: true, ...report });
    if (conflicts.length) return res.status(409).json({ error: `Nothing was applied: ${conflicts.length} redirect(s) conflict with existing rules.`, dryRun: false, ...report });
    await revalidateAll();
    await recordAudit(prisma, { ...actor(req), action: 'Applied Migration Redirects', entityType: 'Migration', entityId: 'migration-sheet', details: `${req.authContext!.userName} created ${created} and updated ${updated} 301 redirect(s) from the migration sheet.`, before: null, after: { created: plan.filter((p) => p.change === 'create').map((p) => `${p.from} → ${p.to}`).slice(0, 500), updated: plan.filter((p) => p.change === 'update').map((p) => `${p.from} → ${p.to}`).slice(0, 500) }, fields: ['created', 'updated'] });
    return res.status(201).json({ dryRun: false, created, updated, blockedRows: summary.errors, summary });
  }));

  return router;
}
