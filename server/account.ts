import crypto from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from './db';
import { requireAuth, type AuthLookup } from './auth';
import { getSessionIdFromRequest, buildExpiredSessionCookie } from './session';
import { hashPassword, verifyPassword, validatePasswordStrength } from './password';
import { createRateLimiter } from './rateLimit';
import { recordAudit } from './audit';
import { validateText, validateSafeUrl } from './validation';
import type { Prisma } from './generated/prisma/client';

// Explicit projections: adding a sensitive column later cannot expose it here.
const userSelect = { id: true, name: true, email: true, role: true, avatar: true, joinedAt: true, updatedAt: true, status: true, totpEnabledAt: true } as const;
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
      const result = field === 'name' ? validateText(body[field], field, 150) : validateSafeUrl(body[field], field);
      if (!result.valid) return res.status(400).json({ error: result.error });
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
        const result = field === 'avatar' ? validateSafeUrl(value, field) : validateText(value, field, field === 'bio' ? 3000 : 150, field !== 'bio');
        if (typeof value !== 'string' || !result.valid) return res.status(400).json({ error: result.error || 'Profile fields must be strings.' });
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
  return router;
}
