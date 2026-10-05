/**
 * Redirect management (PHASE C).
 *
 * One code path for manual rules (CMS) and automatic article-URL redirects.
 * Guarantees, enforced on every write:
 *   - one rule per source path (DB unique index; sources stored without trailing slash)
 *   - no self-redirects, no loops
 *   - no chains: a new rule points at the FINAL destination, and existing
 *     rules that pointed at the new rule's source are re-targeted to it
 *     (A→B + B→C  becomes  A→C + B→C)
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import type { Prisma } from './generated/prisma/client';
import { prisma } from './db';
import { requireRole, type AuthLookup } from './auth';
import { firstError, validateRedirectSource, validateSafeUrl, validateText } from './validation';
import { stripTrailingSlash } from '../src/config/urls';
import { siteOrigin } from '../src/lib/paths';
import { loadSiteIndex } from './seo/siteIndex';
import { recordAudit } from './audit';

type Db = Prisma.TransactionClient | typeof prisma;

const isInternal = (url: string) => url.startsWith('/') && !url.startsWith('//');
export const normalizeSource = (url: string) => stripTrailingSlash(url.trim());
export const normalizeTarget = (url: string) => (isInternal(url.trim()) ? stripTrailingSlash(url.trim()) : url.trim());

export class RedirectConflict extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

/** Follows active rules from `target` to the final destination; throws on loops. */
async function finalDestination(db: Db, source: string, target: string): Promise<string> {
  let current = target;
  const seen = new Set([source]);
  for (let hop = 0; hop < 20 && isInternal(current); hop++) {
    if (seen.has(current)) throw new RedirectConflict(`This redirect would create a loop (${source} → … → ${current}).`, 400);
    seen.add(current);
    const next = await db.redirectRule.findFirst({ where: { sourceUrl: current, isActive: true } });
    if (!next) return current;
    current = normalizeTarget(next.targetUrl);
  }
  if (seen.has(current)) throw new RedirectConflict(`This redirect would create a loop (${source} → … → ${current}).`, 400);
  return current;
}

export interface RedirectInput {
  sourceUrl: string;
  targetUrl: string;
  statusCode?: number;
  isActive?: boolean;
  notes?: string | null;
  origin?: 'manual' | 'article-slug' | 'slug-change' | 'migration';
}

/**
 * PHASE D: a manual/migration rule must lead somewhere real. An internal
 * final destination has to be a live public page (no redirects to 404s).
 */
async function assertLiveTarget(final: string) {
  if (!isInternal(final)) return;
  const site = await loadSiteIndex(siteOrigin());
  if (!site.resolve(final)) throw new RedirectConflict(`Target ${final}/ is not a live page (it would return 404).`, 400);
}

/** A manual rule must not hide a page that is currently live at its source. */
async function assertSourceIsRetired(source: string) {
  const site = await loadSiteIndex(siteOrigin());
  if (site.resolve(source)) throw new RedirectConflict(`Source ${source}/ is a live page. Move or retire that page before redirecting it.`, 400);
}

/**
 * Creates or updates a rule. `mode: 'create'` refuses an existing source
 * (409); `mode: 'upsert'` (automatic redirects) takes over the existing rule.
 * `id` identifies the rule being edited in `mode: 'update'`.
 */
export async function saveRedirect(db: Db, input: RedirectInput, mode: 'create' | 'upsert' | 'update', id?: string) {
  const source = normalizeSource(input.sourceUrl);
  const target = normalizeTarget(input.targetUrl);
  if (source === target) throw new RedirectConflict('Source and target cannot be the same URL.', 400);
  const active = input.isActive !== false;
  const final = active ? await finalDestination(db, source, target) : target;
  if (final === source) throw new RedirectConflict('This redirect would point back to its own source.', 400);
  const existing = await db.redirectRule.findUnique({ where: { sourceUrl: source } });
  if (existing && mode !== 'upsert' && existing.id !== id) {
    throw new RedirectConflict(`A redirect for ${source} already exists (→ ${existing.targetUrl}).`);
  }
  // Automatic article moves target the article's new URL, which goes live in the same transaction.
  if (active && mode !== 'upsert') {
    await assertSourceIsRetired(source);
    await assertLiveTarget(final);
  }
  const now = new Date();
  const data = {
    sourceUrl: source,
    targetUrl: final,
    statusCode: input.statusCode === 302 ? 302 : 301,
    isActive: active,
    notes: input.notes ?? existing?.notes ?? null,
    origin: input.origin || existing?.origin || 'manual',
    updatedAt: now,
  };
  const ruleId = mode === 'update' ? id! : existing?.id;
  const rule = ruleId
    ? await db.redirectRule.update({ where: { id: ruleId }, data })
    : await db.redirectRule.create({ data: { id: `redir-${crypto.randomUUID()}`, createdAt: now, ...data } });

  if (active) {
    // Flatten chains through this source: X→source becomes X→final.
    const incoming = (await db.redirectRule.findMany({ where: { isActive: true, id: { not: rule.id } } })).filter(
      (r) => normalizeTarget(r.targetUrl) === source
    );
    for (const r of incoming) {
      if (normalizeSource(r.sourceUrl) === final) {
        // final→source→final would loop: the destination is live again, so its old rule retires.
        await db.redirectRule.update({ where: { id: r.id }, data: { isActive: false, updatedAt: now, notes: appendNote(r.notes, `Deactivated ${now.toISOString()}: destination is live again.`) } });
      } else {
        await db.redirectRule.update({ where: { id: r.id }, data: { targetUrl: final, updatedAt: now } });
      }
    }
  }
  return rule;
}

const appendNote = (notes: string | null, note: string) => (notes ? `${notes}\n${note}` : note).slice(-1000);

/**
 * A page now lives at `path`: an active rule for that source would redirect
 * visitors away from it, so it is deactivated (kept for history).
 */
export async function releasePath(db: Db, path: string, reason: string) {
  const rule = await db.redirectRule.findFirst({ where: { sourceUrl: normalizeSource(path), isActive: true } });
  if (!rule) return null;
  return db.redirectRule.update({ where: { id: rule.id }, data: { isActive: false, updatedAt: new Date(), notes: appendNote(rule.notes, reason) } });
}

/** Called when a published article's public URL changes: old URL → 301 → new URL. */
export async function redirectMovedArticle(db: Db, articleId: string, oldPath: string, newPath: string) {
  await releasePath(db, newPath, `Deactivated ${new Date().toISOString()}: article ${articleId} now lives here.`);
  return saveRedirect(db, { sourceUrl: oldPath, targetUrl: newPath, statusCode: 301, origin: 'article-slug', notes: `Automatic: article ${articleId} moved from ${oldPath}/ to ${newPath}/.` }, 'upsert');
}

// ── Admin API (/api/redirects) ──

export function redirectRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((err) => (err instanceof RedirectConflict ? res.status(err.status).json({ error: err.message }) : next(err)));
  };
  // PHASE R.1: structured previous/new rule values.
  const audit = (req: Request, action: string, entityId: string, details: string, before?: object | null, after?: object | null) =>
    recordAudit(prisma, { userId: req.authContext!.userId, userName: req.authContext!.userName, action, entityType: 'Redirect', entityId, details, before: before as Record<string, unknown> | null | undefined, after: after as Record<string, unknown> | null | undefined, fields: ['sourceUrl', 'targetUrl', 'statusCode', 'isActive', 'origin', 'notes'] });
  const validate = (body: Record<string, unknown>, partial: boolean) =>
    firstError(
      body.sourceUrl !== undefined || !partial ? validateRedirectSource(body.sourceUrl, 'sourceUrl') : { valid: true },
      body.targetUrl !== undefined || !partial ? validateSafeUrl(body.targetUrl, 'targetUrl') : { valid: true },
      validateText(body.notes, 'notes', 1000, false),
      body.statusCode !== undefined && body.statusCode !== 301 && body.statusCode !== 302 ? { valid: false, error: 'statusCode must be 301 or 302.' } : { valid: true },
      body.isActive !== undefined && typeof body.isActive !== 'boolean' ? { valid: false, error: 'isActive must be true or false.' } : { valid: true }
    );

  /**
   * PHASE N (v2.2 §19, §25.2 "Back up redirect configuration"): every rule,
   * active and inactive, as CSV — downloaded before a migration apply so the
   * exact pre-migration redirect set is on record.
   */
  router.get('/export', requireRole(getLookup, ['Admin']), wrap(async (req, res) => {
    const rules = await prisma.redirectRule.findMany({ orderBy: { sourceUrl: 'asc' } });
    const cell = (v: unknown) => { const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [['Source URL', 'Target URL', 'Status', 'Active', 'Origin', 'Notes', 'Created', 'Updated', 'Id'].join(','), ...rules.map((r) => [r.sourceUrl, r.targetUrl, r.statusCode, r.isActive ? 'yes' : 'no', r.origin, r.notes, r.createdAt, r.updatedAt, r.id].map(cell).join(','))];
    await audit(req, 'Exported Redirects', 'export', `Admin ${req.authContext!.userName} exported ${rules.length} redirect rule(s).`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sportingspy-redirects-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(lines.join('\r\n'));
  }));

  router.post('/', requireRole(getLookup, ['Admin']), wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const error = validate(body, false);
    if (error) return res.status(400).json({ error });
    const rule = await prisma.$transaction((tx) =>
      saveRedirect(tx, { sourceUrl: String(body.sourceUrl), targetUrl: String(body.targetUrl), statusCode: body.statusCode as number, isActive: body.isActive as boolean, notes: (body.notes as string) || null, origin: 'manual' }, 'create')
    );
    await audit(req, 'Created Redirect Rule', rule.id, `Admin ${req.authContext!.userName} created ${rule.statusCode} redirect: ${rule.sourceUrl} -> ${rule.targetUrl}.`, null, rule);
    return res.status(201).json(rule);
  }));

  /**
   * Bulk (migration) import: { rules: [{ sourceUrl, targetUrl, statusCode?, notes? }], dryRun }.
   * Every row is validated first; nothing is written unless all rows are valid.
   */
  router.post('/bulk', requireRole(getLookup, ['Admin']), wrap(async (req, res) => {
    const body = req.body as { rules?: unknown; dryRun?: unknown };
    if (!Array.isArray(body.rules) || !body.rules.length) return res.status(400).json({ error: 'Send a non-empty "rules" list.' });
    if (body.rules.length > 2000) return res.status(400).json({ error: 'At most 2000 redirects per import.' });
    const rows = body.rules as Record<string, unknown>[];
    const results = rows.map((row, i) => ({ row: i + 1, sourceUrl: String(row?.sourceUrl ?? ''), targetUrl: String(row?.targetUrl ?? ''), error: validate(row || {}, false) as string | null }));
    const seen = new Map<string, number>();
    for (const r of results) {
      if (r.error) continue;
      const key = normalizeSource(r.sourceUrl);
      if (seen.has(key)) r.error = `Duplicate of row ${seen.get(key)}.`;
      else seen.set(key, r.row);
    }
    const apply = async (tx: Db) => {
      for (const r of results) {
        if (r.error) continue;
        try {
          const row = rows[r.row - 1];
          await saveRedirect(tx, { sourceUrl: r.sourceUrl, targetUrl: r.targetUrl, statusCode: row.statusCode as number, notes: (row.notes as string) || null, origin: 'migration' }, 'create');
        } catch (err) {
          if (err instanceof RedirectConflict) r.error = err.message;
          else throw err;
        }
      }
      if (results.some((r) => r.error)) throw new BulkRejected();
    };
    class BulkRejected extends Error {}
    try {
      // A dry run executes the same checks inside a transaction that is always rolled back.
      await prisma.$transaction(async (tx) => {
        await apply(tx);
        if (body.dryRun !== false) throw new BulkRejected();
      }, { timeout: 60_000 });
    } catch (err) {
      if (!(err instanceof BulkRejected)) throw err;
    }
    const errors = results.filter((r) => r.error);
    const applied = body.dryRun === false && !errors.length;
    if (applied) await audit(req, 'Imported Redirects', 'bulk', `Admin ${req.authContext!.userName} imported ${results.length} migration redirects.`, null, { sourceUrl: results.map((r) => r.sourceUrl).slice(0, 200), targetUrl: results.map((r) => r.targetUrl).slice(0, 200) });
    return res.status(errors.length ? 400 : applied ? 201 : 200).json({ dryRun: body.dryRun !== false, applied, total: results.length, valid: results.length - errors.length, results });
  }));

  router.put('/:id', requireRole(getLookup, ['Admin']), wrap(async (req, res) => {
    const existing = await prisma.redirectRule.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Redirect rule not found.' });
    const body = req.body as Record<string, unknown>;
    const error = validate(body, true);
    if (error) return res.status(400).json({ error });
    const unchanged =
      (body.sourceUrl === undefined || normalizeSource(String(body.sourceUrl)) === existing.sourceUrl) &&
      (body.targetUrl === undefined || normalizeTarget(String(body.targetUrl)) === normalizeTarget(existing.targetUrl)) &&
      (body.statusCode === undefined || body.statusCode === existing.statusCode) &&
      (body.isActive === undefined || body.isActive === existing.isActive) &&
      (body.notes === undefined || ((body.notes as string) || null) === existing.notes);
    if (unchanged) return res.json(existing); // no-op saves leave the rule untouched
    const rule = await prisma.$transaction((tx) =>
      saveRedirect(
        tx,
        {
          sourceUrl: (body.sourceUrl as string) ?? existing.sourceUrl,
          targetUrl: (body.targetUrl as string) ?? existing.targetUrl,
          statusCode: (body.statusCode as number) ?? existing.statusCode,
          isActive: (body.isActive as boolean) ?? existing.isActive,
          notes: body.notes !== undefined ? ((body.notes as string) || null) : existing.notes,
        },
        'update',
        existing.id
      )
    );
    await audit(req, 'Updated Redirect Rule', rule.id, `Admin ${req.authContext!.userName} updated redirect rule ${rule.id}: ${rule.sourceUrl} -> ${rule.targetUrl} (${rule.isActive ? 'active' : 'inactive'}).`, existing, rule);
    return res.json(rule);
  }));

  router.delete('/:id', requireRole(getLookup, ['Admin']), wrap(async (req, res) => {
    const existing = await prisma.redirectRule.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Redirect rule not found.' });
    await prisma.redirectRule.delete({ where: { id: existing.id } });
    await audit(req, 'Deleted Redirect Rule', existing.id, `Admin ${req.authContext!.userName} deleted redirect rule ${existing.id}.`, existing, null);
    return res.json({ success: true, id: existing.id });
  }));

  return router;
}
