import crypto from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from './db';
import { requireAuth, type AuthLookup } from './auth';
import { getSessionIdFromRequest, buildExpiredSessionCookie } from './session';
import { hashPassword, verifyPassword, validatePasswordStrength } from './password';
import { createRateLimiter } from './rateLimit';
import { recordAudit } from './audit';
import { validateText } from './validation';
import { validateProfileImageUrl } from './profileImage';
import type { Prisma } from './generated/prisma/client';

// Explicit projections: adding a sensitive column later cannot expose it here.
const userSelect = { id: true, name: true, email: true, role: true, avatar: true, joinedAt: true, updatedAt: true, status: true, totpEnabledAt: true, emailVerifiedAt: true } as const;
const authorSelect = { id: true, slug: true, name: true, roleTitle: true, bio: true, avatar: true, twitter: true, email: true } as const;
export const accountSelect = { ...userSelect, authorProfile: { select: authorSelect } } as const;

// Session.id IS the bearer credential. This one-way, domain-separated reference
// is stable across restarts but can never be used as an authentication cookie.
export const sessionReference = (id: string) => crypto.createHash('sha256').update(`sportingspy/session-reference/v1:${id}`).digest('hex');
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

function bodyError(body: unknown, allowed: string[], required = false): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Expected a JSON object.';
  const keys = Object.keys(body);
  if (keys.some(key => !allowed.includes(key))) return 'Unsupported account field.';
  if (required && !keys.length) return 'At least one profile field is required.';
  return null;
}

function audit(tx: Prisma.TransactionClient, req: Request, action: string, details: string) {
  return tx.auditLog.create({ data: {
    id: `log-${crypto.randomUUID()}`, userId: req.authContext!.userId,
    userName: req.authContext!.userName, action, entityType: 'User',
    entityId: req.authContext!.userId, timestamp: new Date(), details,
  } });
}

// Serialize security mutations with login. Recheck the session after acquiring
// the lock so a request authenticated just before revocation cannot still write.
async function lockAccount(tx: Prisma.TransactionClient, req: Request) {
  const userId = req.authContext!.userId;
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  return tx.session.findFirst({ where: {
    id: getSessionIdFromRequest(req) || '', userId, expiresAt: { gt: new Date() }, user: { status: 'active' },
  } });
}

export function accountRouter(lookup: () => AuthLookup) {
  const router = Router();
  router.use(requireAuth(lookup));
  router.use((req, res, next) => {
    if (req.authContext?.source !== 'session') return res.status(401).json({ error: 'Sign in to manage your account.' });
    next();
  });
  const passwords = createRateLimiter(15 * 60_000, 5);
  const updates = createRateLimiter(60_000, 30);
  const revocations = createRateLimiter(60_000, 20);
  const limit = (limiter: ReturnType<typeof createRateLimiter>) => (req: Request, res: Response, next: NextFunction) => {
    const key = req.authContext!.userId;
    const result = limiter.check(key);
    if (result.limited) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many account requests. Please try again later.' });
    }
    limiter.record(key);
    next();
  };

  router.get('/me', wrap(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.authContext!.userId }, select: accountSelect });
    if (!user) return res.status(401).json({ error: 'Not authenticated.' });
    return res.json({ user });
  }));

  router.patch('/me', limit(updates), wrap(async (req, res) => {
    const error = bodyError(req.body, ['name', 'avatar', 'authorProfile'], true);
    if (error) return res.status(400).json({ error });
    const body = req.body;
    const data: { name?: string; avatar?: string } = {};
    for (const field of ['name', 'avatar'] as const) {
      if (!(field in body)) continue;
      const result = field === 'name' ? validateText(body[field], field, 150) : null;
      const imageError = field === 'avatar' ? validateProfileImageUrl(body[field], field) : null;
      if (result && !result.valid || imageError) return res.status(400).json({ error: imageError || result?.error });
      data[field] = body[field].trim();
    }
    let authorData: { name?: string; bio?: string; avatar?: string } | undefined;
    if ('authorProfile' in body) {
      const error = bodyError(body.authorProfile, ['name', 'bio', 'avatar'], true);
      if (error) return res.status(400).json({ error });
      authorData = {};
      for (const field of ['name', 'bio', 'avatar'] as const) {
        if (!(field in body.authorProfile)) continue;
        const value = body.authorProfile[field];
        const result = field === 'avatar' ? null : validateText(value, field, field === 'bio' ? 3000 : 150, field !== 'bio');
        const imageError = field === 'avatar' ? validateProfileImageUrl(value, field) : null;
        if (typeof value !== 'string' || imageError || result && !result.valid) return res.status(400).json({ error: imageError || result?.error || 'Profile fields must be strings.' });
        authorData[field] = value.trim();
      }
    }
    const result = await prisma.$transaction(async tx => {
      if (!await lockAccount(tx, req)) return { status: 401, error: 'Session expired. Please sign in.' };
      const userId = req.authContext!.userId;
      // PHASE R.1: previous values for the structured audit entry.
      const beforeUser = await tx.user.findUnique({ where: { id: userId }, select: { name: true, avatar: true } });
      const beforeAuthor = await tx.author.findUnique({ where: { userId }, select: { name: true, bio: true, avatar: true } });
      if (authorData) {
        const author = await tx.author.findUnique({ where: { userId } });
        if (!author) return { status: 400, error: 'Your account has no linked author profile.' };
        await tx.author.update({ where: { id: author.id }, data: authorData });
      }
      const user = await tx.user.update({ where: { id: userId }, data: { ...data, updatedAt: new Date() }, select: accountSelect });
      const afterAuthor = authorData ? await tx.author.findUnique({ where: { userId }, select: { name: true, bio: true, avatar: true } }) : beforeAuthor;
      await recordAudit(tx, { userId, userName: req.authContext!.userName, action: 'Profile Updated', entityType: 'User', entityId: userId, details: 'Updated self-service profile fields.',
        before: { name: beforeUser?.name, avatar: beforeUser?.avatar, authorName: beforeAuthor?.name, authorBio: beforeAuthor?.bio, authorAvatar: beforeAuthor?.avatar },
        after: { name: user.name, avatar: user.avatar, authorName: afterAuthor?.name, authorBio: afterAuthor?.bio, authorAvatar: afterAuthor?.avatar } });
      return { status: 200, user };
    });
    return res.status(result.status).json(result.error ? { error: result.error } : { user: result.user });
  }));

  router.post('/change-password', limit(passwords), wrap(async (req, res) => {
    const error = bodyError(req.body, ['currentPassword', 'newPassword', 'confirmPassword']);
    if (error) return res.status(400).json({ error });
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 200) return res.status(400).json({ error: 'Current password is required (maximum 200 characters).' });
    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) return res.status(400).json({ error: strength.error });
    if (confirmPassword !== newPassword) return res.status(400).json({ error: 'New passwords do not match.' });
    if (currentPassword === newPassword) return res.status(400).json({ error: 'Choose a different new password.' });
    const result = await prisma.$transaction(async tx => {
      if (!await lockAccount(tx, req)) return { status: 401, error: 'Session expired. Please sign in.' };
      const user = await tx.user.findUniqueOrThrow({ where: { id: req.authContext!.userId } });
      if (!verifyPassword(currentPassword, user.passwordHash)) {
        await audit(tx, req, 'Password Change Failed', 'Current password verification failed.');
        return { status: 400, error: 'Current password is incorrect.' };
      }
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(newPassword), updatedAt: new Date() } });
      const revoked = await tx.session.deleteMany({ where: { userId: user.id, id: { not: getSessionIdFromRequest(req)! } } });
      await audit(tx, req, 'Password Changed', `Password changed; ${revoked.count} other sessions revoked.`);
      return { status: 200, success: true, revokedCount: revoked.count };
    });
    return res.status(result.status).json(result.error ? { error: result.error } : { success: true, revokedCount: result.revokedCount });
  }));

  router.get('/sessions', wrap(async (req, res) => {
    const sessions = await prisma.session.findMany({ where: { userId: req.authContext!.userId, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    return res.json({ sessions: sessions.map(s => ({ reference: sessionReference(s.id), createdAt: s.createdAt, expiresAt: s.expiresAt, current: s.id === getSessionIdFromRequest(req) })) });
  }));

  router.post('/sessions/revoke-others', limit(revocations), wrap(async (req, res) => {
    const error = bodyError(req.body, []);
    if (error) return res.status(400).json({ error });
    const result = await prisma.$transaction(async tx => {
      if (!await lockAccount(tx, req)) return null;
      const revoked = await tx.session.deleteMany({ where: { userId: req.authContext!.userId, id: { not: getSessionIdFromRequest(req)! } } });
      await audit(tx, req, 'Other Sessions Revoked', `Revoked ${revoked.count} other sessions.`);
      return revoked.count;
    });
    return result === null ? res.status(401).json({ error: 'Session expired. Please sign in.' }) : res.json({ success: true, revokedCount: result });
  }));

  router.delete('/sessions/:reference', limit(revocations), wrap(async (req, res) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.reference)) return res.status(404).json({ error: 'Session not found.' });
    const result = await prisma.$transaction(async tx => {
      if (!await lockAccount(tx, req)) return { status: 401, error: 'Session expired. Please sign in.' };
      const own = await tx.session.findMany({ where: { userId: req.authContext!.userId, expiresAt: { gt: new Date() } } });
      const target = own.find(s => sessionReference(s.id) === req.params.reference);
      if (!target) return { status: 404, error: 'Session not found.' };
      await tx.session.delete({ where: { id: target.id } });
      await audit(tx, req, 'Session Revoked', 'Revoked an active session.');
      return { status: 200, current: target.id === getSessionIdFromRequest(req) };
    });
    if (result.current) res.append('Set-Cookie', buildExpiredSessionCookie());
    return res.status(result.status).json(result.error ? { error: result.error } : { success: true, current: result.current });
  }));

  // PHASE U — Account privacy: self-service data export. Returns the signed-in
  // account's own profile plus every comment they authored (their data only).
  router.get('/me/export', limit(updates), wrap(async (req, res) => {
    const userId = req.authContext!.userId;
    const [user, comments] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: accountSelect }),
      prisma.comment.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { id: true, articleId: true, content: true, status: true, createdAt: true } }),
    ]);
    if (!user) return res.status(401).json({ error: 'Not authenticated.' });
    res.setHeader('Content-Disposition', 'attachment; filename="sportingspy-account.json"');
    return res.json({ exportedAt: new Date().toISOString(), account: user, comments });
  }));

  // PHASE U — Account privacy: reader self-deletion. Readers only, so a
  // self-deletion can never orphan an editorial byline or audit attribution
  // (staff accounts are managed by an Admin). Retention policy: the account row
  // and its sessions / verification / reset tokens are removed (FK cascade);
  // the reader's COMMENTS are intentionally kept — they carry only the display
  // name the reader chose (denormalized, no live FK to User), which preserves
  // moderation and audit history without retaining other personal data.
  router.post('/me/delete', limit(passwords), wrap(async (req, res) => {
    const error = bodyError(req.body, ['password']);
    if (error) return res.status(400).json({ error });
    const { password } = req.body as { password?: unknown };
    if (typeof password !== 'string' || !password || password.length > 200) return res.status(400).json({ error: 'Your password is required to delete your account.' });
    const result = await prisma.$transaction(async (tx) => {
      if (!await lockAccount(tx, req)) return { status: 401 as const, error: 'Session expired. Please sign in.' };
      const user = await tx.user.findUniqueOrThrow({ where: { id: req.authContext!.userId } });
      if (user.role !== 'Reader') return { status: 403 as const, error: 'Staff accounts are managed by an administrator and cannot be self-deleted here.' };
      if (!verifyPassword(password, user.passwordHash)) {
        await audit(tx, req, 'Account Deletion Failed', 'Password verification failed for self-deletion.');
        return { status: 400 as const, error: 'Your password is incorrect.' };
      }
      // Privacy: detach the reader's comments from their identity. Retention
      // keeps the moderation record (content + status), but the display name,
      // avatar and role are removed so a deleted account is no longer linked to
      // its comments (matches the account page's promise).
      await tx.comment.updateMany({ where: { userId: user.id }, data: { userName: '[deleted user]', userAvatar: null, userRole: null } });
      // Audit BEFORE deletion: AuditLog.userId is free-text (not a FK), so the
      // record survives the account removal.
      await recordAudit(tx, { userId: user.id, userName: user.name, action: 'Reader Account Deleted', entityType: 'User', entityId: user.id, details: 'Reader self-deleted their account; sessions and tokens removed, comments retained but anonymized.' });
      await tx.user.delete({ where: { id: user.id } });
      return { status: 200 as const };
    });
    if (result.status === 200) res.append('Set-Cookie', buildExpiredSessionCookie());
    return res.status(result.status).json(result.status === 200 ? { success: true } : { error: result.error });
  }));
  return router;
}
