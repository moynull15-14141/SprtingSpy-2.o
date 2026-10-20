/**
 * PHASE U — Public reader registration & e-mail verification.
 *
 *   POST /api/auth/register              { name, email, password }  → create a Reader, e-mail a verification link
 *   GET  /api/auth/verify-email?token=   → report whether a token is usable (for the verify page)
 *   POST /api/auth/verify-email          { token }                  → confirm the address
 *   POST /api/auth/verify-email/resend   (signed-in unverified Reader) → send a fresh link
 *
 * Design decisions (see the Phase U plan):
 *   - Registration ALWAYS assigns role = 'Reader' on the server. A client-
 *     supplied role is impossible: the request body is a strict allow-list of
 *     { name, email, password } and any other key is rejected.
 *   - Account enumeration is avoided: the response is the same generic message
 *     whether or not the address already exists. An existing unverified reader
 *     is re-sent a link; any other existing account is sent a neutral notice.
 *   - Tokens: 32 random bytes; only the SHA-256 hash is stored; valid 24 hours;
 *     single use; issuing a new one voids older unused tokens. The raw token
 *     lives only in the e-mailed link and is never logged.
 *   - Gated by ENABLE_READER_ACCOUNTS: every route answers 404 while off, so
 *     the feature stays fully dark until enabled (mirrors the comments gate).
 *   - Reuses the existing session/CSRF/password infrastructure unchanged.
 */

import crypto from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import { prisma } from './db';
import { requireAuth, type AuthLookup } from './auth';
import { hashPassword, validatePasswordStrength } from './password';
import { validateText, validateEmail, firstError } from './validation';
import { createRateLimiter } from './rateLimit';
import { recordAudit } from './audit';
import { featureFlags } from './features';
import { sendMail, mailConfigured } from './mailer';
import { generateSessionId, buildSessionCookie, sessionExpiryFromNow } from './session';
import { siteOrigin } from '../src/lib/paths';

const VERIFY_TTL_MS = 24 * 60 * 60_000; // 24 hours
const GENERIC_MESSAGE = 'If that address can be registered, a verification link has been sent. It expires in 24 hours.';

/** Domain-separated hash — the stored value can never be replayed as anything else. */
export const hashVerifyToken = (token: string) => crypto.createHash('sha256').update(`sportingspy/email-verify/v1:${token}`).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const verifyUrl = (token: string) => `${siteOrigin()}/verify-email/?token=${encodeURIComponent(token)}`;

/** Creates a verification token (voiding older unused ones) and returns the raw token. */
export async function issueVerificationToken(userId: string, createdBy: string): Promise<string> {
  const token = newToken();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
    await tx.emailVerificationToken.create({ data: { id: `evt-${crypto.randomUUID()}`, userId, tokenHash: hashVerifyToken(token), createdAt: now, expiresAt: new Date(now.getTime() + VERIFY_TTL_MS), createdBy } });
  });
  return token;
}

async function sendVerificationEmail(to: string, name: string, link: string): Promise<boolean> {
  return sendMail({
    to,
    subject: 'Confirm your SportingSpy account',
    text: `Hello ${name},\n\nConfirm your e-mail address to finish creating your SportingSpy reader account. Open this link within 24 hours:\n\n${link}\n\nIf you did not create an account, you can ignore this message.\n`,
  });
}

async function findUsableToken(token: unknown) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const row = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashVerifyToken(token) }, include: { user: { select: { id: true, name: true, status: true, role: true, emailVerifiedAt: true } } } });
  if (!row || row.usedAt || row.expiresAt <= new Date()) return null;
  return row;
}

export function registerRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
  const registrations = createRateLimiter(60 * 60_000, 5); // 5 per hour, per IP and per email
  const verifications = createRateLimiter(15 * 60_000, 20);
  const resends = createRateLimiter(60 * 60_000, 5);
  const ipOf = (req: Request) => req.ip || req.socket.remoteAddress || 'unknown';

  // Keeps the whole feature dark until ENABLE_READER_ACCOUNTS is turned on.
  const readerGate = (_req: Request, res: Response, next: NextFunction) => {
    if (!featureFlags().readerAccounts) return res.status(404).json({ error: 'Reader accounts are not available.' });
    next();
  };

  const limited = (limiter: ReturnType<typeof createRateLimiter>, key: string, res: Response) => {
    const result = limiter.check(key);
    if (result.limited) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      res.status(429).json({ error: 'Too many attempts. Please try again later.' });
      return true;
    }
    limiter.record(key);
    return false;
  };

  router.post('/register', readerGate, wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => !['name', 'email', 'password'].includes(k))) {
      return res.status(400).json({ error: 'Send name, email and password only.' });
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const validationError = firstError(validateText(name, 'name', 80), validateEmail(email, 'email'), validatePasswordStrength(password));
    if (validationError) return res.status(400).json({ error: validationError });

    // Rate limit by IP and by email before any database work (abuse + timing).
    if (limited(registrations, `ip:${ipOf(req)}`, res)) return;
    if (limited(registrations, `email:${email}`, res)) return;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Never reveal that the address is taken. Re-send a link to an unverified
      // reader; send a neutral notice to anyone else. Same response either way.
      if (existing.role === 'Reader' && !existing.emailVerifiedAt && existing.status === 'active') {
        const token = await issueVerificationToken(existing.id, 'self');
        await sendVerificationEmail(existing.email, existing.name, verifyUrl(token));
      } else if (mailConfigured()) {
        await sendMail({ to: existing.email, subject: 'About your SportingSpy account', text: `Hello,\n\nSomeone tried to register a SportingSpy account with this e-mail address, which already has one. If this was you, just sign in — or use "Forgot password" on the sign-in screen if you need to reset it.\n` });
      }
      return res.status(202).json({ message: GENERIC_MESSAGE });
    }

    const now = new Date();
    // When no e-mail provider is configured there is nothing to verify against,
    // so the address is confirmed at creation. Comments stay moderated, and the
    // moment RESEND_API_KEY/MAIL_FROM are set this branch is skipped and real
    // e-mail verification applies to new registrations.
    const autoVerify = !mailConfigured();
    const user = await prisma.user.create({
      data: {
        id: `user-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        name,
        email,
        // SERVER-ASSIGNED. A reader can never self-register as privileged.
        role: 'Reader',
        avatar: '', // readers default to initials; no stock photo
        joinedAt: now,
        updatedAt: now,
        status: 'active',
        emailVerifiedAt: autoVerify ? now : null,
        passwordHash: hashPassword(password),
      },
    });

    if (autoVerify) {
      // Sign the new reader in immediately (session cookie) so they return to
      // where they were — e.g. the article they wanted to comment on.
      const session = await prisma.session.create({ data: { id: generateSessionId(), userId: user.id, createdAt: now, expiresAt: new Date(sessionExpiryFromNow()) } });
      res.append('Set-Cookie', buildSessionCookie(session.id));
      await recordAudit(prisma, { userId: user.id, userName: user.name, action: 'Reader Registered', entityType: 'User', entityId: user.id, details: 'Reader account created, auto-verified (no e-mail provider configured) and signed in.' });
      return res.status(201).json({ autoLogin: true });
    }

    const token = await issueVerificationToken(user.id, 'self');
    const sent = await sendVerificationEmail(user.email, user.name, verifyUrl(token));
    await recordAudit(prisma, { userId: user.id, userName: user.name, action: 'Reader Registered', entityType: 'User', entityId: user.id, details: sent ? 'Reader account created; verification e-mail sent.' : 'Reader account created; the verification e-mail could not be delivered.' });
    return res.status(201).json({ message: GENERIC_MESSAGE, emailConfigured: mailConfigured() });
  }));

  router.get('/verify-email', readerGate, wrap(async (req, res) => {
    if (limited(verifications, `ip:${ipOf(req)}`, res)) return;
    const row = await findUsableToken(req.query.token);
    return res.json({ valid: !!row });
  }));

  router.post('/verify-email', readerGate, wrap(async (req, res) => {
    if (limited(verifications, `ip:${ipOf(req)}`, res)) return;
    const token = (req.body || {} as Record<string, unknown>).token;
    const row = await findUsableToken(token);
    if (!row) return res.status(400).json({ error: 'This verification link is invalid or has expired. Request a new one.' });
    const confirmed = await prisma.$transaction(async (tx) => {
      // Single use, even under concurrent submissions.
      const claimed = await tx.emailVerificationToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (!claimed.count) return false;
      if (!row.user.emailVerifiedAt) {
        await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
        await recordAudit(tx, { userId: row.userId, userName: row.user.name, action: 'Reader Email Verified', entityType: 'User', entityId: row.userId, details: 'Reader confirmed their e-mail address.' });
      }
      return true;
    });
    if (!confirmed) return res.status(400).json({ error: 'This verification link is invalid or has expired. Request a new one.' });
    return res.json({ success: true });
  }));

  router.post('/verify-email/resend', readerGate, requireAuth(getLookup), wrap(async (req, res) => {
    if (limited(resends, req.authContext!.userId, res)) return;
    const user = await prisma.user.findUnique({ where: { id: req.authContext!.userId }, select: { id: true, name: true, email: true, role: true, status: true, emailVerifiedAt: true } });
    if (!user || user.role !== 'Reader') return res.status(403).json({ error: 'Only reader accounts need e-mail verification.' });
    if (user.status !== 'active') return res.status(403).json({ error: 'This account cannot request verification.' });
    if (user.emailVerifiedAt) return res.json({ message: 'Your e-mail address is already verified.' });
    const token = await issueVerificationToken(user.id, 'self');
    await sendVerificationEmail(user.email, user.name, verifyUrl(token));
    return res.json({ message: 'A new verification link has been sent to your e-mail address.', emailConfigured: mailConfigured() });
  }));

  return router;
}
