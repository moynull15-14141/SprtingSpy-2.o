/**
 * Password reset (PHASE R, Spec §24.1 "password-reset protection").
 *
 * Two ways to get a reset link — both produce the same single-use token:
 *   1. Self-service: POST /api/auth/password-reset/request { email }
 *      Always answers with the same message (no account oracle). If the
 *      address belongs to an active staff account AND an e-mail provider is
 *      configured, the link is e-mailed. Without a provider nothing is sent
 *      (OWNER/OPS: configure RESEND_API_KEY + MAIL_FROM, see DEPLOYMENT.md).
 *   2. Admin-issued: POST /api/auth/admin/users/:id/reset-link
 *      Returns the link ONCE to the Admin, who delivers it out of band.
 *
 * Tokens: 32 random bytes; only the SHA-256 hash is stored; valid 30 minutes
 * (Admin links 24 hours); single use; issuing a new token voids older ones.
 * Completing a reset sets the new password and revokes every session of the
 * account. All steps are rate-limited and audit-logged.
 */

import crypto from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import { prisma } from './db';
import { requireRole, type AuthLookup } from './auth';
import { hashPassword, validatePasswordStrength } from './password';
import { createRateLimiter } from './rateLimit';
import { recordAudit } from './audit';
import { siteOrigin } from '../src/lib/paths';

const SELF_TTL_MS = 30 * 60_000;
const ADMIN_TTL_MS = 24 * 60 * 60_000;
const GENERIC_REQUEST_MESSAGE = 'If that address belongs to an active staff account, a reset link has been sent. The link expires in 30 minutes.';

export const hashResetToken = (token: string) => crypto.createHash('sha256').update(`sportingspy/password-reset/v1:${token}`).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const resetUrl = (token: string) => `${siteOrigin()}/reset-password/?token=${encodeURIComponent(token)}`;

/** True when an e-mail provider is configured for reset links. */
export function resetEmailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

async function sendResetEmail(to: string, name: string, link: string): Promise<boolean> {
  if (!resetEmailConfigured()) return false;
  try {
    const response = await fetch(process.env.RESEND_API_URL || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [to],
        subject: 'Reset your SportingSpy password',
        text: `Hello ${name},\n\nA password reset was requested for your SportingSpy staff account. Open this link within 30 minutes to choose a new password:\n\n${link}\n\nIf you did not ask for this, ignore this message; your password stays the same.\n`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Creates a token for the user (voiding older unused ones) and returns the raw token. */
export async function issueResetToken(userId: string, createdBy: string, ttlMs: number): Promise<string> {
  const token = newToken();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
    await tx.passwordResetToken.create({ data: { id: `pwr-${crypto.randomUUID()}`, userId, tokenHash: hashResetToken(token), createdAt: now, expiresAt: new Date(now.getTime() + ttlMs), createdBy } });
  });
  return token;
}

async function findUsableToken(token: unknown) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashResetToken(token) }, include: { user: { select: { id: true, name: true, status: true, role: true } } } });
  if (!row || row.usedAt || row.expiresAt <= new Date() || row.user.status !== 'active') return null;
  return row;
}

export function passwordResetRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
  const requests = createRateLimiter(15 * 60_000, 5);
  const confirms = createRateLimiter(15 * 60_000, 10);
  const ipOf = (req: Request) => req.ip || req.socket.remoteAddress || 'unknown';
  const limited = (limiter: ReturnType<typeof createRateLimiter>, key: string, res: Response) => {
    const result = limiter.check(key);
    if (result.limited) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      res.status(429).json({ error: 'Too many password reset attempts. Please try again later.' });
      return true;
    }
    limiter.record(key);
    return false;
  };

  router.post('/password-reset/request', wrap(async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid e-mail address.' });
    if (limited(requests, `ip:${ipOf(req)}`, res) || limited(requests, `email:${email}`, res)) return;
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, status: true, role: true } });
    if (user && user.status === 'active' && user.role !== 'Reader') {
      if (resetEmailConfigured()) {
        const token = await issueResetToken(user.id, 'self', SELF_TTL_MS);
        const sent = await sendResetEmail(user.email, user.name, resetUrl(token));
        await recordAudit(prisma, { userId: user.id, userName: user.name, action: 'Password Reset Requested', entityType: 'User', entityId: user.id, details: sent ? 'A reset link was e-mailed.' : 'The reset e-mail could not be delivered by the provider.' });
      } else {
        await recordAudit(prisma, { userId: user.id, userName: user.name, action: 'Password Reset Requested', entityType: 'User', entityId: user.id, details: 'No e-mail provider is configured, so no link was sent. An Admin can issue a reset link.' });
      }
    }
    // Identical answer whether or not the account exists.
    return res.json({ message: GENERIC_REQUEST_MESSAGE });
  }));

  router.get('/password-reset/verify', wrap(async (req, res) => {
    if (limited(confirms, `ip:${ipOf(req)}`, res)) return;
    const row = await findUsableToken(req.query.token);
    return res.json({ valid: !!row, expiresAt: row?.expiresAt ?? null });
  }));

  router.post('/password-reset/confirm', wrap(async (req, res) => {
    if (limited(confirms, `ip:${ipOf(req)}`, res)) return;
    const { token, newPassword, confirmPassword } = (req.body || {}) as Record<string, unknown>;
    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) return res.status(400).json({ error: strength.error });
    if (newPassword !== confirmPassword) return res.status(400).json({ error: 'The passwords do not match.' });
    const row = await findUsableToken(token);
    if (!row) return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${row.userId} FOR UPDATE`;
      // Single use, even under concurrent submissions.
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (!claimed.count) return null;
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash: hashPassword(newPassword as string), updatedAt: new Date() } });
      const revoked = await tx.session.deleteMany({ where: { userId: row.userId } });
      await tx.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: new Date() } });
      await recordAudit(tx, { userId: row.userId, userName: row.user.name, action: 'Password Reset Completed', entityType: 'User', entityId: row.userId, details: `Password reset with a ${row.createdBy === 'self' ? 'self-service' : 'Admin-issued'} link; ${revoked.count} session(s) revoked.` });
      return revoked.count;
    });
    if (result === null) return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
    return res.json({ success: true, revokedSessions: result });
  }));

  // Admin-issued link (delivered by the Admin; shown once).
  router.post('/admin/users/:id/reset-link', requireRole(getLookup, ['Admin']), wrap(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, status: true } });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (user.status !== 'active') return res.status(400).json({ error: 'Activate the account before issuing a reset link.' });
    const token = await issueResetToken(user.id, req.authContext!.userId, ADMIN_TTL_MS);
    await recordAudit(prisma, { userId: req.authContext!.userId, userName: req.authContext!.userName, action: 'Password Reset Link Issued', entityType: 'User', entityId: user.id, details: `${req.authContext!.userName} issued a 24-hour reset link for ${user.name}.` });
    return res.status(201).json({ url: resetUrl(token), expiresInHours: 24, emailConfigured: resetEmailConfigured() });
  }));

  return router;
}
