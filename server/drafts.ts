/**
 * Editor working copies API (PHASE AUTOSAVE). Mounted at /api/drafts behind
 * the global security, CORS and CSRF middleware. It is exempt from public
 * cache invalidation (server/publicCache.ts): nothing here is public.
 *
 *   GET    /api/drafts                       recoverable drafts visible to me
 *   GET    /api/drafts/for/:kind/:entityId   the working copy of one item + its current version
 *   GET    /api/drafts/:id                   one draft with its payload
 *   PUT    /api/drafts/:id                   autosave (idempotent upsert, revision-checked)
 *   DELETE /api/drafts/:id?revision=&applied= discard, or remove after a successful manual save
 *   POST   /api/drafts/:id/recovered         record that a draft was recovered (audit)
 *
 * A draft is the editor's form state, never a publishing state: the live
 * Article/SportEvent/EventEdition/Page row changes only through its existing
 * endpoints, so autosave never bumps reviewVersion, submits, approves,
 * publishes, schedules or notifies IndexNow.
 *
 * Access mirrors each editor: articles — Admin, Editor, Author (Authors only
 * their own, and only while the article is editable for them); events,
 * editions, pages — Admin, Editor. Drafts of NEW content (entityId null) are
 * private to their owner. An existing item has one shared working copy,
 * visible to everyone allowed to edit that item. Every id, kind and
 * permission is decided here, never trusted from the client.
 *
 * Concurrency: `revision` must match the stored revision (409 with the newer
 * draft otherwise). A retry of an already-applied autosave (same payload) is
 * answered with the stored draft, so retries never duplicate or conflict.
 * `baseVersion` records the item's version when editing began; the item's
 * save endpoints accept an `X-Expected-Version` header and answer 409 when
 * the live item changed since (entityVersion below).
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from './db';
import { requireRole, type AuthContext, type AuthLookup } from './auth';
import { recordAudit } from './audit';
import { createRateLimiter } from './rateLimit';
import { articleReadWhere } from './editorialWorkflow';
import { validateRichDoc } from '../src/lib/richText';
import type { EditorDraft, Prisma } from './generated/prisma/client';
import { DRAFT_KINDS, DRAFT_LIMITS, STALE_VERSION_MESSAGE, stableJson, type DraftKind } from '../src/lib/drafts';

export class DraftError extends Error { constructor(readonly status: number, message: string, readonly extra?: Record<string, unknown>) { super(message); } }
const fail = (status: number, message: string, extra?: Record<string, unknown>): never => { throw new DraftError(status, message, extra); };

const ID = /^[A-Za-z0-9_-]{8,100}$/;
const ENTITY_TYPE: Record<DraftKind, 'Article' | 'Event' | 'Edition' | 'Page'> = { article: 'Article', event: 'Event', edition: 'Edition', page: 'Page' };
const KIND_ROLES: Record<DraftKind, string[]> = { article: ['Admin', 'Editor', 'Author'], event: ['Admin', 'Editor'], edition: ['Admin', 'Editor'], page: ['Admin', 'Editor'] };
const CONTROL = /[\u0000-\u001F\u007F]/;

const hash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);

/**
 * The current version token of a live item, or null when it does not exist.
 * Articles use reviewVersion (bumped by every article write and workflow
 * action), pages updatedAt; events and editions have no version column, so
 * a hash of the stored row is used.
 */
export async function entityVersion(kind: DraftKind, id: string): Promise<string | null> {
  if (kind === 'article') { const a = await prisma.article.findUnique({ where: { id }, select: { reviewVersion: true } }); return a ? `r${a.reviewVersion}` : null; }
  if (kind === 'page') { const p = await prisma.page.findUnique({ where: { id }, select: { updatedAt: true } }); return p ? p.updatedAt.toISOString() : null; }
  if (kind === 'event') { const e = await prisma.sportEvent.findUnique({ where: { id } }); return e ? `h${hash(e)}` : null; }
  const ed = await prisma.eventEdition.findUnique({ where: { id } }); return ed ? `h${hash(ed)}` : null;
}

/**
 * Optional optimistic-concurrency precondition for the existing item save
 * endpoints: when the editor sends X-Expected-Version and the live item has
 * changed since, the save is refused (409) instead of overwriting newer work.
 * Without the header the endpoints behave exactly as before.
 */
export async function staleVersionConflict(req: Request, kind: DraftKind, id: string): Promise<Record<string, unknown> | null> {
  const expected = req.get('x-expected-version');
  if (!expected) return null;
  const current = await entityVersion(kind, id);
  return current !== null && current !== expected ? { error: STALE_VERSION_MESSAGE, code: 'stale_version', currentVersion: current } : null;
}

/** Whether `ctx` may edit the existing item (404 hides items the user cannot see). */
async function assertCanEdit(ctx: AuthContext, kind: DraftKind, entityId: string) {
  if (!KIND_ROLES[kind].includes(ctx.role)) fail(403, 'You cannot edit this kind of content.');
  if (kind === 'article') {
    const a = await prisma.article.findFirst({ where: { id: entityId, ...articleReadWhere(ctx) }, select: { status: true, reviewStatus: true } });
    if (!a) fail(404, 'Article not found.');
    // The same rule that makes the Author's editor read-only (authorWriteGuard).
    if (ctx.role === 'Author' && (a!.reviewStatus === 'in_review' || ['published', 'scheduled', 'archived'].includes(a!.status))) fail(403, 'This article is read-only for you right now, so it is not autosaved.');
    return;
  }
  if ((await entityVersion(kind, entityId)) === null) fail(404, 'Item not found.');
}

/** Whether `ctx` may see/modify this draft. */
async function assertDraftAccess(ctx: AuthContext, d: Pick<EditorDraft, 'kind' | 'entityId' | 'ownerId'>) {
  const kind = d.kind as DraftKind;
  if (!d.entityId) { if (d.ownerId !== ctx.userId) fail(404, 'Draft not found.'); if (!KIND_ROLES[kind].includes(ctx.role)) fail(404, 'Draft not found.'); return; }
  await assertCanEdit(ctx, kind, d.entityId).catch((err) => { if (err instanceof DraftError && err.status === 404) fail(404, 'Draft not found.'); throw err; });
}

/** Media Library ids referenced by a payload: explicit ids plus library URLs (event/edition images). */
async function referencedMedia(payload: unknown): Promise<string[]> {
  const ids = new Set<string>();
  const urls = new Set<string>();
  const walk = (v: unknown, key = '') => {
    if (Array.isArray(v)) { if (key === 'mediaIds') v.forEach((x) => typeof x === 'string' && ids.add(x)); else v.forEach((x) => walk(x)); return; }
    if (v && typeof v === 'object') { Object.entries(v as Record<string, unknown>).forEach(([k, x]) => walk(x, k)); return; }
    if (typeof v !== 'string' || !v) return;
    if (/^(mediaId|featuredMediaId|ogMediaId|heroMediaId)$/.test(key)) ids.add(v);
    else if (/^(https:\/\/|\/media\/)/.test(v) && v.length < 2048) urls.add(v);
  };
  walk(payload);
  const [byId, byUrl] = await Promise.all([
    ids.size ? prisma.mediaItem.findMany({ where: { id: { in: [...ids].slice(0, 500) } }, select: { id: true } }) : [],
    urls.size ? prisma.mediaItem.findMany({ where: { url: { in: [...urls].slice(0, 500) } }, select: { id: true } }) : [],
  ]);
  return [...new Set([...byId, ...byUrl].map((m) => m.id))];
}

function parseBody(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Send the draft as an object.');
  const raw = body as Record<string, unknown>;
  const unknown = Object.keys(raw).find((k) => !['kind', 'entityId', 'revision', 'title', 'payload', 'baseVersion'].includes(k));
  if (unknown) fail(400, `${unknown} is not a draft field.`);
  if (!(DRAFT_KINDS as readonly string[]).includes(raw.kind as string)) fail(400, `kind must be one of: ${DRAFT_KINDS.join(', ')}.`);
  if (raw.entityId !== null && (typeof raw.entityId !== 'string' || !ID.test(raw.entityId))) fail(400, 'entityId must be an item id or null.');
  if (!Number.isInteger(raw.revision) || (raw.revision as number) < 0) fail(400, 'revision must be a whole number.');
  if (typeof raw.title !== 'string' || raw.title.length > DRAFT_LIMITS.title || CONTROL.test(raw.title)) fail(400, 'title must be text of at most 300 characters.');
  if (!raw.payload || typeof raw.payload !== 'object' || Array.isArray(raw.payload)) fail(400, 'payload must be an object.');
  if (JSON.stringify(raw.payload).length > DRAFT_LIMITS.payloadBytes) fail(413, 'This draft is too large to autosave.');
  const doc = (raw.payload as Record<string, unknown>).body;
  if (doc && typeof doc === 'object') { const r = validateRichDoc(doc); if (!r.ok) fail(400, `Body: ${(r as { error: string }).error}`); }
  if (raw.baseVersion !== undefined && raw.baseVersion !== null && (typeof raw.baseVersion !== 'string' || raw.baseVersion.length > 100)) fail(400, 'baseVersion must be a version token.');
  return { kind: raw.kind as DraftKind, entityId: raw.entityId as string | null, revision: raw.revision as number, title: (raw.title as string).trim() || 'Untitled', payload: raw.payload as Record<string, unknown>, baseVersion: (raw.baseVersion as string | null | undefined) ?? null };
}

const samePayload = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
const view = (d: EditorDraft & { owner?: { name: string } }, withPayload: boolean) => ({
  id: d.id, kind: d.kind, entityId: d.entityId, title: d.title, revision: d.revision, baseVersion: d.baseVersion,
  ownerId: d.ownerId, ownerName: d.owner?.name ?? null, createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
  ...(withPayload ? { payload: d.payload } : {}),
});

export function draftsRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  const staff = requireRole(getLookup, ['Admin', 'Editor', 'Author']);
  // Autosave is debounced (≈ one write per 2–15 s per editor); this only stops runaway clients.
  const writes = createRateLimiter(60_000, 120);
  const limited = (req: Request, res: Response, next: NextFunction) => {
    const key = req.authContext!.userId;
    const limit = writes.check(key);
    if (limit.limited) { res.setHeader('Retry-After', String(limit.retryAfterSeconds)); res.status(429).json({ error: 'Autosaving too often. Retrying shortly.' }); return; }
    writes.record(key); next();
  };
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((err) => {
      if (err instanceof DraftError) return res.status(err.status).json({ error: err.message, ...(err.extra ?? {}) });
      next(err);
    });
  };
  const audit = (db: Prisma.TransactionClient | typeof prisma, ctx: AuthContext, action: string, d: Pick<EditorDraft, 'id' | 'kind' | 'entityId' | 'title'>, details: string) =>
    recordAudit(db, { userId: ctx.userId, userName: ctx.userName, action, entityType: ENTITY_TYPE[d.kind as DraftKind], entityId: d.entityId ?? d.id, details });

  router.get('/', staff, wrap(async (req, res) => {
    const ctx = req.authContext!;
    const kinds = DRAFT_KINDS.filter((k) => KIND_ROLES[k].includes(ctx.role));
    const rows = await prisma.editorDraft.findMany({
      where: { kind: { in: [...kinds] }, OR: [{ entityId: null, ownerId: ctx.userId }, { entityId: { not: null } }] },
      include: { owner: { select: { name: true } } }, orderBy: { updatedAt: 'desc' }, take: 200,
    });
    const visible = [];
    for (const d of rows) {
      if (d.entityId) {
        const allowed = await assertCanEdit(ctx, d.kind as DraftKind, d.entityId).then(() => true, () => false);
        if (!allowed) continue;
        const current = await entityVersion(d.kind as DraftKind, d.entityId);
        visible.push({ ...view(d, false), stale: !!d.baseVersion && current !== d.baseVersion });
      } else visible.push({ ...view(d, false), stale: false });
    }
    return res.json({ drafts: visible });
  }));

  router.get('/for/:kind/:entityId', staff, wrap(async (req, res) => {
    const kind = req.params.kind as DraftKind;
    if (!(DRAFT_KINDS as readonly string[]).includes(kind) || !ID.test(req.params.entityId)) fail(400, 'Unknown item.');
    await assertCanEdit(req.authContext!, kind, req.params.entityId);
    const [draft, currentVersion] = await Promise.all([
      prisma.editorDraft.findUnique({ where: { kind_entityId: { kind, entityId: req.params.entityId } }, include: { owner: { select: { name: true } } } }),
      entityVersion(kind, req.params.entityId),
    ]);
    return res.json({ draft: draft ? view(draft, true) : null, currentVersion });
  }));

  router.get('/:id', staff, wrap(async (req, res) => {
    const d = await prisma.editorDraft.findUnique({ where: { id: req.params.id }, include: { owner: { select: { name: true } } } });
    if (!d) fail(404, 'Draft not found.');
    await assertDraftAccess(req.authContext!, d!);
    return res.json({ draft: view(d!, true), currentVersion: d!.entityId ? await entityVersion(d!.kind as DraftKind, d!.entityId) : null });
  }));

  router.put('/:id', staff, limited, wrap(async (req, res) => {
    const ctx = req.authContext!;
    if (!ID.test(req.params.id)) fail(400, 'Invalid draft id.');
    const input = parseBody(req.body);
    const existing = await prisma.editorDraft.findUnique({ where: { id: req.params.id } });
    if (existing) {
      if (existing.kind !== input.kind || existing.entityId !== input.entityId) fail(400, 'A draft cannot be moved to another item.');
      await assertDraftAccess(ctx, existing);
      if (existing.revision !== input.revision) {
        // A retry of a save that already succeeded: answer it, change nothing.
        if (samePayload(existing.payload, input.payload) && existing.title === input.title) return res.json({ draft: view(existing, false), unchanged: true });
        fail(409, 'This draft was changed in another window or by another editor.', { code: 'stale_draft', draft: view(existing, true) });
      }
      if (samePayload(existing.payload, input.payload) && existing.title === input.title) return res.json({ draft: view(existing, false), unchanged: true });
      const mediaIds = await referencedMedia(input.payload);
      const updated = await prisma.editorDraft.updateMany({ where: { id: existing.id, revision: input.revision }, data: { title: input.title, payload: input.payload as Prisma.InputJsonValue, mediaIds, revision: { increment: 1 } } });
      const saved = await prisma.editorDraft.findUnique({ where: { id: existing.id } });
      if (!updated.count || !saved) fail(409, 'This draft was changed in another window or by another editor.', { code: 'stale_draft', ...(saved ? { draft: view(saved, true) } : {}) });
      return res.json({ draft: view(saved!, false) });
    }
    // New draft.
    if (input.revision !== 0) fail(409, 'This draft no longer exists. It may have been discarded or applied.', { code: 'draft_gone' });
    if (!KIND_ROLES[input.kind].includes(ctx.role)) fail(403, 'You cannot edit this kind of content.');
    if (input.entityId) {
      await assertCanEdit(ctx, input.kind, input.entityId);
      const other = await prisma.editorDraft.findUnique({ where: { kind_entityId: { kind: input.kind, entityId: input.entityId } }, include: { owner: { select: { name: true } } } });
      if (other) fail(409, 'This item already has an unsaved working copy.', { code: 'stale_draft', draft: view(other, true) });
    }
    const baseVersion = input.entityId ? input.baseVersion ?? await entityVersion(input.kind, input.entityId) : null;
    const mediaIds = await referencedMedia(input.payload);
    try {
      const created = await prisma.$transaction(async (tx) => {
        const d = await tx.editorDraft.create({ data: { id: req.params.id, kind: input.kind, entityId: input.entityId, ownerId: ctx.userId, title: input.title, payload: input.payload as Prisma.InputJsonValue, baseVersion, revision: 1, mediaIds } });
        await audit(tx, ctx, 'Draft Created', d, `${ctx.userName} started an unsaved working copy of ${input.entityId ? `this ${input.kind}` : `a new ${input.kind}`} ("${d.title}").`);
        return d;
      });
      return res.status(201).json({ draft: view(created, false) });
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
      // Two first saves raced (same id retried, or two editors on one item).
      const now = await prisma.editorDraft.findFirst({ where: { OR: [{ id: req.params.id }, ...(input.entityId ? [{ kind: input.kind, entityId: input.entityId }] : [])] } });
      if (now && now.id === req.params.id && samePayload(now.payload, input.payload)) return res.json({ draft: view(now, false), unchanged: true });
      return fail(409, 'This item already has an unsaved working copy.', { code: 'stale_draft', ...(now ? { draft: view(now, true) } : {}) });
    }
  }));

  router.delete('/:id', staff, limited, wrap(async (req, res) => {
    const ctx = req.authContext!;
    const d = await prisma.editorDraft.findUnique({ where: { id: req.params.id } });
    if (!d) return res.json({ success: true, alreadyGone: true });
    await assertDraftAccess(ctx, d);
    const revision = req.query.revision === undefined ? undefined : Number(req.query.revision);
    if (revision !== undefined && (!Number.isInteger(revision) || revision !== d.revision)) fail(409, 'This draft changed after you loaded it, so it was kept.', { code: 'stale_draft', draft: view(d, true) });
    const applied = req.query.applied === '1';
    await prisma.$transaction(async (tx) => {
      const removed = await tx.editorDraft.deleteMany({ where: { id: d.id, revision: d.revision } });
      if (!removed.count) fail(409, 'This draft changed while it was being removed, so it was kept.', { code: 'stale_draft' });
      // Removing a working copy after its content was saved is not a discard.
      if (!applied) await audit(tx, ctx, 'Draft Discarded', d, `${ctx.userName} discarded an unsaved working copy ("${d.title}").`);
    });
    return res.json({ success: true });
  }));

  router.post('/:id/recovered', staff, limited, wrap(async (req, res) => {
    const ctx = req.authContext!;
    const d = await prisma.editorDraft.findUnique({ where: { id: req.params.id } });
    if (!d) fail(404, 'Draft not found.');
    await assertDraftAccess(ctx, d!);
    await audit(prisma, ctx, 'Draft Recovered', d!, `${ctx.userName} continued an unsaved working copy ("${d!.title}") saved ${d!.updatedAt.toISOString()}.`);
    return res.json({ success: true });
  }));

  return router;
}
