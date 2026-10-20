/**
 * PHASE U — Reader (public-user) management (Admin only).
 *
 *   GET  /api/readers?status=&verified=&q=&page=   paginated reader list + counts
 *   GET  /api/readers/:id                          one reader + recent comment history
 *   POST /api/readers/:id/status                   { status, reason? }  suspend / ban / reactivate
 *
 * Deliberately separate from the staff Users desk (/api/users): these routes
 * only ever read or act on role = 'Reader' accounts, never staff. Every route
 * is Admin-only and enforced on the server. Responses are built from an
 * explicit projection — password hashes, session/verification/reset tokens and
 * the stored status reason's internals never leak beyond the safe fields.
 *
 * Suspending or banning a reader revokes their active sessions immediately, so
 * the restriction takes effect at once (a non-active status also blocks login
 * and prevents commenting via the existing `status === 'active'` checks). A ban
 * is a stronger restriction than a suspension; there is no public endpoint that
 * lets a reader change their own status, so a banned reader cannot self-lift it.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { prisma } from './db';
import type { Prisma } from './generated/prisma/client';
import { requireRole, type AuthLookup } from './auth';
import { recordAudit } from './audit';
import { validateText } from './validation';

const PAGE_SIZE = 50;
const STATUS_FILTERS = ['active', 'inactive', 'suspended', 'banned', 'unverified'] as const;
const SETTABLE_STATUS = ['active', 'suspended', 'banned'] as const;
type SettableStatus = (typeof SETTABLE_STATUS)[number];
const USER_AUDIT_FIELDS = ['status', 'statusReason', 'statusUpdatedBy', 'statusUpdatedAt'] as const;

// Explicit safe projection — never selects passwordHash, totpSecret or tokens.
const readerSelect = {
  id: true, name: true, email: true, role: true, avatar: true, status: true,
  joinedAt: true, updatedAt: true, emailVerifiedAt: true,
  statusReason: true, statusUpdatedAt: true, statusUpdatedBy: true,
} as const;

export function readersRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
  const admin = requireRole(getLookup, ['Admin']);

  router.get('/api/readers', admin, wrap(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (status && !(STATUS_FILTERS as readonly string[]).includes(status)) return res.status(400).json({ error: 'Unknown status filter.' });
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const page = Math.max(1, Math.min(10_000, Number.parseInt(String(req.query.page ?? '1'), 10) || 1));

    const where: Prisma.UserWhereInput = { role: 'Reader' };
    if (status === 'unverified') where.emailVerifiedAt = null;
    else if (status) where.status = status as SettableStatus | 'inactive';
    if (req.query.verified === '1') where.emailVerifiedAt = { not: null };
    if (q) where.OR = [{ email: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }];

    const [items, total, counts] = await Promise.all([
      prisma.user.findMany({ where, select: readerSelect, orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      prisma.user.count({ where }),
      prisma.user.groupBy({ by: ['status'], where: { role: 'Reader' }, _count: true }),
    ]);
    const statusCounts = Object.fromEntries(counts.map((c) => [c.status, c._count]));
    const unverified = await prisma.user.count({ where: { role: 'Reader', emailVerifiedAt: null } });

    return res.json({ items, total, counts: { ...statusCounts, unverified }, page, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
  }));

  router.get('/api/readers/:id', admin, wrap(async (req, res) => {
    const reader = await prisma.user.findFirst({ where: { id: req.params.id, role: 'Reader' }, select: readerSelect });
    if (!reader) return res.status(404).json({ error: 'Reader not found.' });
    // Comment history (bounded). Includes soft-deleted so a moderator sees the
    // full record; article title attached without a per-row query.
    const comments = await prisma.comment.findMany({ where: { userId: reader.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    const articleIds = [...new Set(comments.map((c) => c.articleId))];
    const articles = articleIds.length ? await prisma.article.findMany({ where: { id: { in: articleIds } }, select: { id: true, title: true } }) : [];
    const titleById = new Map(articles.map((a) => [a.id, a.title]));
    return res.json({ reader, comments: comments.map((c) => ({ ...c, articleTitle: titleById.get(c.articleId) ?? null })) });
  }));

  router.post('/api/readers/:id/status', admin, wrap(async (req, res) => {
    const { userId: actorId, userName } = req.authContext!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => !['status', 'reason'].includes(k))) {
      return res.status(400).json({ error: 'Send { status, reason? }.' });
    }
    if (!(SETTABLE_STATUS as readonly unknown[]).includes(body.status)) {
      return res.status(400).json({ error: `status must be one of: ${SETTABLE_STATUS.join(', ')}.` });
    }
    const nextStatus = body.status as SettableStatus;
    // A reason is required when restricting (suspend/ban); cleared on reactivate.
    const reasonCheck = validateText(body.reason, 'reason', 500, nextStatus !== 'active');
    if (!reasonCheck.valid) return res.status(400).json({ error: reasonCheck.error });
    const reason = nextStatus === 'active' ? null : (typeof body.reason === 'string' ? body.reason.trim() : '');

    const target = await prisma.user.findFirst({ where: { id: req.params.id, role: 'Reader' } });
    if (!target) return res.status(404).json({ error: 'Reader not found.' });

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: target.id },
        data: { status: nextStatus, statusReason: reason, statusUpdatedAt: new Date(), statusUpdatedBy: actorId, updatedAt: new Date() },
        select: readerSelect,
      });
      // Restricting an account invalidates its sessions at once.
      if (nextStatus !== 'active') await tx.session.deleteMany({ where: { userId: target.id } });
      return user;
    });

    const verb = nextStatus === 'active' ? 'reactivated' : nextStatus === 'banned' ? 'banned' : 'suspended';
    await recordAudit(prisma, { userId: actorId, userName, action: 'Changed Reader Status', entityType: 'User', entityId: target.id, details: `${userName} ${verb} reader "${target.name}".`, before: target as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, fields: USER_AUDIT_FIELDS });
    return res.json(updated);
  }));

  // PHASE U: manual e-mail verification by an Admin. While no e-mail provider is
  // configured (RESEND_API_KEY / MAIL_FROM), readers cannot receive a link, so an
  // Admin can confirm (or clear) a reader's verification here. { verified:false }
  // clears it; the default verifies. Verifying keeps any existing timestamp.
  router.post('/api/readers/:id/verify', admin, wrap(async (req, res) => {
    const { userId: actorId, userName } = req.authContext!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => !['verified'].includes(k))) {
      return res.status(400).json({ error: 'Send { verified? }.' });
    }
    if (body.verified !== undefined && typeof body.verified !== 'boolean') return res.status(400).json({ error: 'verified must be true or false.' });
    const verified = body.verified === undefined ? true : body.verified;

    const target = await prisma.user.findFirst({ where: { id: req.params.id, role: 'Reader' }, select: readerSelect });
    if (!target) return res.status(404).json({ error: 'Reader not found.' });

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { emailVerifiedAt: verified ? (target.emailVerifiedAt ?? new Date()) : null, updatedAt: new Date() },
      select: readerSelect,
    });
    await recordAudit(prisma, { userId: actorId, userName, action: verified ? 'Verified Reader (manual)' : 'Cleared Reader Verification', entityType: 'User', entityId: target.id, details: `${userName} ${verified ? 'manually verified' : 'cleared email verification for'} reader "${target.name}".`, before: { emailVerifiedAt: target.emailVerifiedAt }, after: { emailVerifiedAt: updated.emailVerifiedAt }, fields: ['emailVerifiedAt'] });
    return res.json(updated);
  }));

  return router;
}
