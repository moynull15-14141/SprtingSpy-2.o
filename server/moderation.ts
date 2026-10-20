/**
 * PHASE U — Comment moderation (Admin, Editor).
 *
 *   GET   /api/moderation/comments?status=&q=&page=   paginated queue + counts
 *   PATCH /api/moderation/comments/:id                { status?, note? }  approve / reject / spam / re-queue
 *   POST  /api/moderation/comments/:id/delete         soft delete (keeps the row)
 *   POST  /api/moderation/comments/:id/restore        undo a soft delete
 *
 * Every action is authorized on the server (requireRole), records who/when in
 * the comment row (moderatedBy/moderatedAt) and writes an AuditLog entry using
 * the existing pattern. Soft deletion never removes data: the row is retained
 * for audit/history and simply hidden from the public approved-only query.
 * Reported comments are intentionally out of scope for this release (documented
 * as a follow-up) so the core approve/reject/spam workflow stays complete.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { prisma } from './db';
import type { Prisma } from './generated/prisma/client';
import { requireRole, type AuthLookup } from './auth';
import { recordAudit } from './audit';
import { validateText } from './validation';

const PAGE_SIZE = 50;
const SETTABLE = ['approved', 'rejected', 'spam', 'pending'] as const;
const FILTERS = ['pending', 'approved', 'rejected', 'spam', 'deleted'] as const;
type Settable = (typeof SETTABLE)[number];
const COMMENT_AUDIT_FIELDS = ['status', 'moderatedBy', 'moderatedAt', 'moderationNote', 'deletedAt'] as const;

export function moderationRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
  const staff = requireRole(getLookup, ['Admin', 'Editor']);

  router.get('/api/moderation/comments', staff, wrap(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (status && !(FILTERS as readonly string[]).includes(status)) return res.status(400).json({ error: 'Unknown status filter.' });
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const page = Math.max(1, Math.min(10_000, Number.parseInt(String(req.query.page ?? '1'), 10) || 1));

    const where: Prisma.CommentWhereInput = status === 'deleted'
      ? { deletedAt: { not: null } }
      : { deletedAt: null, ...(status ? { status: status as Settable } : {}) };
    if (q) where.OR = [{ content: { contains: q, mode: 'insensitive' } }, { userName: { contains: q, mode: 'insensitive' } }];

    const [items, total, pending] = await Promise.all([
      prisma.comment.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      prisma.comment.count({ where }),
      prisma.comment.count({ where: { status: 'pending', deletedAt: null } }),
    ]);

    // Attach the target article's title/status without a per-row query. A
    // comment whose article was deleted shows a safe placeholder.
    const articleIds = [...new Set(items.map((c) => c.articleId))];
    const articles = articleIds.length ? await prisma.article.findMany({ where: { id: { in: articleIds } }, select: { id: true, title: true, status: true, slug: true, sportSlug: true } }) : [];
    const byId = new Map(articles.map((a) => [a.id, a]));
    const withArticle = items.map((c) => ({ ...c, article: byId.get(c.articleId) ?? null }));

    return res.json({ items: withArticle, total, pending, page, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
  }));

  router.patch('/api/moderation/comments/:id', staff, wrap(async (req, res) => {
    const { userName } = req.authContext!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => !['status', 'note'].includes(k)) || !Object.keys(body).length) {
      return res.status(400).json({ error: 'Send { status } and/or { note }.' });
    }
    if (body.status !== undefined && !(SETTABLE as readonly unknown[]).includes(body.status)) {
      return res.status(400).json({ error: `status must be one of: ${SETTABLE.join(', ')}.` });
    }
    let note: string | undefined;
    if (body.note !== undefined) {
      const check = validateText(body.note, 'note', 500, false);
      if (!check.valid) return res.status(400).json({ error: check.error });
      note = typeof body.note === 'string' ? body.note.trim() : '';
    }

    const existing = await prisma.comment.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Comment not found.' });

    const updated = await prisma.comment.update({
      where: { id: existing.id },
      data: {
        ...(body.status !== undefined ? { status: body.status as Settable } : {}),
        ...(note !== undefined ? { moderationNote: note } : {}),
        moderatedBy: userName,
        moderatedAt: new Date(),
      },
    });
    await recordAudit(prisma, { userId: req.authContext!.userId, userName, action: 'Moderated Comment', entityType: 'Comment', entityId: existing.id, details: `Comment ${existing.id} set to '${updated.status}' by ${userName}.`, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, fields: COMMENT_AUDIT_FIELDS });
    return res.json(updated);
  }));

  router.post('/api/moderation/comments/:id/delete', staff, wrap(async (req, res) => {
    const { userName } = req.authContext!;
    const existing = await prisma.comment.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Comment not found.' });
    if (existing.deletedAt) return res.json(existing); // already soft-deleted
    const updated = await prisma.comment.update({ where: { id: existing.id }, data: { deletedAt: new Date(), moderatedBy: userName, moderatedAt: new Date() } });
    await recordAudit(prisma, { userId: req.authContext!.userId, userName, action: 'Soft-Deleted Comment', entityType: 'Comment', entityId: existing.id, details: `Comment ${existing.id} soft-deleted by ${userName} (row retained).`, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, fields: COMMENT_AUDIT_FIELDS });
    return res.json(updated);
  }));

  router.post('/api/moderation/comments/:id/restore', staff, wrap(async (req, res) => {
    const { userName } = req.authContext!;
    const existing = await prisma.comment.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Comment not found.' });
    const updated = await prisma.comment.update({ where: { id: existing.id }, data: { deletedAt: null, moderatedBy: userName, moderatedAt: new Date() } });
    await recordAudit(prisma, { userId: req.authContext!.userId, userName, action: 'Restored Comment', entityType: 'Comment', entityId: existing.id, details: `Comment ${existing.id} restored by ${userName}.`, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, fields: COMMENT_AUDIT_FIELDS });
    return res.json(updated);
  }));

  return router;
}
