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

/** An old URL as a site path (absolute URLs keep only path; no query/hash; no trailing slash). */
export function oldPath(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  let path: string;
  if (/^https?:\/\//i.test(value)) {
    try { path = new URL(value).pathname; } catch { return null; }
  } else if (value.startsWith('/') && !value.startsWith('//')) path = value.split(/[?#]/)[0];
  else return null;
  if (path.length > 1000 || /[\s<>"]/.test(path)) return null;
  return normalizeSource(path) || '/';
}

/** A new URL: an internal path (stored without trailing slash) or empty. */
function newPath(raw: string): string | null {
  const value = raw.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) {
    try {
      const u = new URL(value);
      if (u.origin !== new URL(siteOrigin()).origin) return null;
      return normalizeSource(u.pathname) || '/';
    } catch { return null; }
  }
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return normalizeSource(value.split(/[?#]/)[0]) || '/';
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
  const old = oldPath(text('oldUrl', 2000));
  if (!old) return { ok: false, error: 'Old URL must be a path (/old-page) or an absolute http(s) URL.' };
  const decision = (text('decision', 20).toUpperCase() || 'UNDECIDED') as Decision;
  if (!DECISIONS.includes(decision)) return { ok: false, error: `Decision must be one of: ${DECISIONS.join(', ')}.` };
  const target = newPath(text('newUrl', 2000));
  if (target === null) return { ok: false, error: 'New URL must be a path on this site (or a full URL on this site).' };
  return { ok: true, row: { oldUrl: old, oldCategory: text('oldCategory', 200), oldTitle: text('oldTitle', 500), decision, newCategory: text('newCategory', 200), newTitle: text('newTitle', 500), newUrl: target, notes: text('notes', 2000) } };
}

type Site = Awaited<ReturnType<typeof loadSiteIndex>>;

/** Problems with one row against the live site and the rest of the sheet. */
export function checkRow(row: Row, site: Site, redirects: Map<string, string>): { status: 'ok' | 'error' | 'pending'; problems: string[]; action: 'redirect' | 'none' | 'retire' | 'undecided' } {
  const problems: string[] = [];
  if (row.decision === 'UNDECIDED') return { status: 'pending', problems: ['No decision yet.'], action: 'undecided' };
  if (row.decision === 'RETIRE') {
    if (row.newUrl) problems.push('RETIRE rows do not redirect. Use MERGE to send this URL to a relevant replacement.');
    if (site.resolve(row.oldUrl)) problems.push(`${row.oldUrl}/ is a live page on the new site, so it is not retired.`);
    return { status: problems.length ? 'error' : 'ok', problems, action: 'retire' };
  }
  if (!row.newUrl) problems.push(`${row.decision} needs a New URL.`);
  else {
    if (row.newUrl === row.oldUrl) return { status: 'ok', problems: [], action: 'none' };
    if (row.newUrl === '/' && row.oldUrl !== '/') problems.push('Redirecting to the homepage is not allowed for unrelated pages (Spec §27.5). Choose the relevant new page, or RETIRE.');
    const chained = redirects.get(row.newUrl);
    if (chained) problems.push(`New URL ${row.newUrl}/ is itself redirected to ${chained}/ — point directly at the final URL.`);
    else if (!site.resolve(row.newUrl)) problems.push(`New URL ${row.newUrl}/ is not a live page yet (it would return 404). Publish the content first.`);
    const live = site.resolve(row.oldUrl);
    if (live) problems.push(`Old URL ${row.oldUrl}/ is a live page on the new site; a redirect would hide it.`);
    const existing = redirects.get(row.oldUrl);
    if (existing && existing !== row.newUrl) problems.push(`A redirect for ${row.oldUrl} already exists (→ ${existing}).`);
  }
  return { status: problems.length ? 'error' : 'ok', problems, action: 'redirect' };
}

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
      prisma.redirectRule.findMany({ where: { isActive: true }, select: { sourceUrl: true, targetUrl: true, id: true } }),
    ]);
    const redirects = new Map(rules.map((r) => [r.sourceUrl, r.targetUrl.replace(/\/$/, '') || '/']));
    const ownRedirects = new Set(rows.map((r) => r.redirectId).filter(Boolean));
    for (const row of rows) {
      // A row whose redirect was already applied is checked against its own rule.
      const ruleForRow = rules.find((r) => r.id === row.redirectId);
      const map = ruleForRow ? new Map([...redirects].filter(([src]) => src !== row.oldUrl)) : redirects;
      const result = checkRow(row as Row, site, map);
      const applied = !!ruleForRow && ownRedirects.has(ruleForRow.id);
      await prisma.migrationItem.update({ where: { id: row.id }, data: { checkStatus: result.status, validation: { problems: result.problems, action: result.action, applied } } });
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
    const rows = await prisma.migrationItem.findMany({ orderBy: { oldUrl: 'asc' } });
    const applied = new Set((await prisma.redirectRule.findMany({ where: { isActive: true, id: { in: rows.map((r) => r.redirectId).filter((v): v is string => !!v) } }, select: { id: true } })).map((r) => r.id));
    const lines = [SHEET_COLUMNS.join(','), ...rows.map((r) => [r.oldUrl, r.oldCategory, r.oldTitle, r.decision, r.newCategory, r.newTitle, r.newUrl ? `${r.newUrl}${r.newUrl === '/' ? '' : '/'}` : '', r.redirectId && applied.has(r.redirectId) ? 'yes' : 'no'].map((v) => csvCell(String(v))).join(','))];
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

  router.post('/apply', admin, wrap(async (req, res) => {
    const dryRun = req.body?.dryRun !== false;
    await revalidateAll();
    const rows = await prisma.migrationItem.findMany({ where: { checkStatus: 'ok', decision: { in: ['KEEP', 'REWRITE', 'MERGE'] } } });
    const todo = rows.filter((r) => r.newUrl && r.newUrl !== r.oldUrl && !(r.validation as { applied?: boolean } | null)?.applied);
    const plan = todo.map((r) => ({ id: r.id, from: r.oldUrl, to: r.newUrl }));
    const blocked = await prisma.migrationItem.count({ where: { checkStatus: 'error' } });
    if (dryRun) return res.json({ dryRun: true, redirects: plan, blockedRows: blocked });
    const created: string[] = [];
    try {
      await prisma.$transaction(async (tx) => {
        for (const r of todo) {
          const rule = await saveRedirect(tx, { sourceUrl: r.oldUrl, targetUrl: r.newUrl, statusCode: 301, origin: 'migration', notes: `Migration sheet (${r.decision}): ${r.oldTitle || r.oldUrl}` }, 'create');
          await tx.migrationItem.update({ where: { id: r.id }, data: { redirectId: rule.id } });
          created.push(rule.id);
        }
      }, { timeout: 120_000 });
    } catch (err) {
      if (err instanceof RedirectConflict) return res.status(409).json({ error: `Nothing was applied: ${err.message}` });
      throw err;
    }
    await revalidateAll();
    await recordAudit(prisma, { ...actor(req), action: 'Applied Migration Redirects', entityType: 'Migration', entityId: 'migration-sheet', details: `${req.authContext!.userName} created ${created.length} 301 redirect(s) from the migration sheet.` });
    return res.status(201).json({ dryRun: false, created: created.length, blockedRows: blocked });
  }));

  return router;
}
