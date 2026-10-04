/**
 * Optional TOTP second factor for staff accounts (PHASE R, Spec §24.1
 * "2FA/passkeys where appropriate"). RFC 6238: HMAC-SHA1, 30-second steps,
 * 6 digits, ±1 step tolerance, implemented with node:crypto (no dependency).
 *
 * The shared secret is stored encrypted with AES-256-GCM using a key derived
 * from TOTP_ENCRYPTION_KEY (required in production before anyone can enrol).
 * A secret stored with totpEnabledAt = NULL is a pending enrolment; it only
 * becomes active after the user proves a valid code. A code can be used only
 * once (replay protection per account, per process).
 *
 *   GET  /api/auth/totp/status
 *   POST /api/auth/totp/setup             → { secret, otpauthUri } (pending)
 *   POST /api/auth/totp/enable  { code }
 *   POST /api/auth/totp/disable { password, code }
 *   POST /api/auth/totp/admin/:userId/reset   (Admin; lost device)
 */

import crypto from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import { prisma } from './db';
import { requireAuth, requireRole, type AuthLookup } from './auth';
import { verifyPassword } from './password';
import { createRateLimiter } from './rateLimit';
import { recordAudit } from './audit';

const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** RFC 4226 HOTP value for a counter. */
export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const code = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const totpAt = (secret: Buffer, timeMs = Date.now()) => hotp(secret, Math.floor(timeMs / 1000 / STEP_SECONDS));

/** The matching time-step counter (±1 step), or null. Constant-time comparison. */
export function matchTotp(secret: Buffer, code: string, timeMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = Math.floor(timeMs / 1000 / STEP_SECONDS);
  for (const counter of [now - 1, now, now + 1]) {
    if (crypto.timingSafeEqual(Buffer.from(hotp(secret, counter)), Buffer.from(code))) return counter;
  }
  return null;
}

// ── Secret encryption ──

function encryptionKey(): Buffer {
  const raw = process.env.TOTP_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    if (process.env.NODE_ENV === 'production') throw new TotpUnavailable('Two-factor authentication needs TOTP_ENCRYPTION_KEY (at least 32 characters) on the server.');
    return crypto.createHash('sha256').update('sportingspy/totp/development-only-key').digest();
  }
  return crypto.createHash('sha256').update(`sportingspy/totp/v1:${raw}`).digest();
}

export class TotpUnavailable extends Error {}

export function encryptSecret(secretB32: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(secretB32, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${data.toString('base64url')}`;
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported TOTP secret format.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

// Replay protection: the last accepted counter per user (per process).
const lastCounter = ((globalThis as unknown as { __sportingspyTotpCounters?: Map<string, number> }).__sportingspyTotpCounters ??= new Map());

/** Verifies a login code for a user with an ACTIVE second factor. */
export async function verifyTotpForUser(userId: string, storedSecret: string, code: string): Promise<boolean> {
  let secret: Buffer;
  try { secret = base32Decode(decryptSecret(storedSecret)); } catch { return false; }
  const counter = matchTotp(secret, code);
  if (counter === null) return false;
  if ((lastCounter.get(userId) ?? -1) >= counter) return false;
  lastCounter.set(userId, counter);
  return true;
}

export function totpRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((err) => (err instanceof TotpUnavailable ? res.status(503).json({ error: err.message }) : next(err)));
  };
  const attempts = createRateLimiter(15 * 60_000, 10);
  const session = [requireAuth(getLookup), (req: Request, res: Response, next: NextFunction) => {
    if (req.authContext?.source !== 'session') return res.status(401).json({ error: 'Sign in to manage two-factor authentication.' });
    const check = attempts.check(req.authContext.userId);
    if (check.limited) { res.setHeader('Retry-After', String(check.retryAfterSeconds)); return res.status(429).json({ error: 'Too many attempts. Please try again later.' }); }
    next();
  }];
  const actor = (req: Request) => ({ userId: req.authContext!.userId, userName: req.authContext!.userName });

  router.get('/status', ...session, wrap(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.authContext!.userId }, select: { totpEnabledAt: true } });
    return res.json({ enabled: !!user?.totpEnabledAt, enabledAt: user?.totpEnabledAt ?? null });
  }));

  router.post('/setup', ...session, wrap(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.authContext!.userId }, select: { email: true, totpEnabledAt: true } });
    if (user.totpEnabledAt) return res.status(409).json({ error: 'Two-factor authentication is already on. Turn it off first to set up a new device.' });
    const secret = base32Encode(crypto.randomBytes(20));
    await prisma.user.update({ where: { id: req.authContext!.userId }, data: { totpSecret: encryptSecret(secret), totpEnabledAt: null } });
    const label = encodeURIComponent(`SportingSpy:${user.email}`);
    return res.json({ secret, otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=SportingSpy&algorithm=SHA1&digits=6&period=30` });
  }));

  router.post('/enable', ...session, wrap(async (req, res) => {
    attempts.record(req.authContext!.userId);
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.authContext!.userId }, select: { totpSecret: true, totpEnabledAt: true } });
    if (user.totpEnabledAt) return res.status(409).json({ error: 'Two-factor authentication is already on.' });
    if (!user.totpSecret) return res.status(400).json({ error: 'Start the setup first.' });
    if (!(await verifyTotpForUser(req.authContext!.userId, user.totpSecret, code))) return res.status(400).json({ error: 'That code is not valid. Check the time on your device and try again.' });
    await prisma.user.update({ where: { id: req.authContext!.userId }, data: { totpEnabledAt: new Date() } });
    await recordAudit(prisma, { ...actor(req), action: 'Two-Factor Enabled', entityType: 'User', entityId: req.authContext!.userId, details: 'Turned on two-factor authentication (TOTP).' });
    return res.json({ enabled: true });
  }));

  router.post('/disable', ...session, wrap(async (req, res) => {
    attempts.record(req.authContext!.userId);
    const { password, code } = (req.body || {}) as { password?: unknown; code?: unknown };
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.authContext!.userId }, select: { passwordHash: true, totpSecret: true, totpEnabledAt: true } });
    if (!user.totpEnabledAt || !user.totpSecret) return res.status(400).json({ error: 'Two-factor authentication is not on.' });
    if (typeof password !== 'string' || !verifyPassword(password, user.passwordHash)) return res.status(400).json({ error: 'Password is incorrect.' });
    if (typeof code !== 'string' || !(await verifyTotpForUser(req.authContext!.userId, user.totpSecret, code.trim()))) return res.status(400).json({ error: 'That code is not valid.' });
    await prisma.user.update({ where: { id: req.authContext!.userId }, data: { totpSecret: null, totpEnabledAt: null } });
    await recordAudit(prisma, { ...actor(req), action: 'Two-Factor Disabled', entityType: 'User', entityId: req.authContext!.userId, details: 'Turned off two-factor authentication.' });
    return res.json({ enabled: false });
  }));

  router.post('/admin/:userId/reset', requireRole(getLookup, ['Admin']), wrap(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.userId }, select: { id: true, name: true } });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { totpSecret: null, totpEnabledAt: null } });
      await tx.session.deleteMany({ where: { userId: target.id } });
      await recordAudit(tx, { ...actor(req), action: 'Two-Factor Reset by Admin', entityType: 'User', entityId: target.id, details: `${req.authContext!.userName} removed two-factor authentication for ${target.name} (lost device) and revoked their sessions.` });
    });
    return res.json({ success: true });
  }));

  return router;
}
