/**
 * SportingSpy Session Cookie Mechanics
 * ====================================
 * PHASE 1 — AUTHENTICATION & STAFF IDENTITY.
 *
 * Session architecture: server-side sessions, opaque cookie.
 * ------------------------------------------------------------
 * The cookie the browser holds contains ONLY a random 256-bit opaque token
 * (the session id) — never a userId, role, or any other claim. That token is
 * looked up against a `sessions` collection persisted in data/db.json (see
 * server.ts DatabaseSchema), which maps it to a userId and an expiry. This
 * means:
 *   - The browser cannot forge a session — it would have to guess a random
 *     256-bit value, which is computationally infeasible.
 *   - The browser cannot escalate a session's role — role isn't in the
 *     cookie at all; it's resolved server-side from the session's userId on
 *     every request.
 *   - No signing/encryption secret is needed for the cookie itself, because
 *     it carries no data to tamper with — only an identifier to look up.
 *     (This is the same trust model as PHP's default session handling or
 *     express-session with a database store.)
 *   - Sessions survive a server restart, because they live in data/db.json
 *     alongside everything else — consistent with this project's existing
 *     "everything lives in the JSON store" architecture, and directly
 *     analogous to a `sessions` table a future PostgreSQL migration would add.
 *
 * No `cookie-parser` dependency was added — Express does not parse cookies
 * out of the box, but the Cookie header's format is simple enough to parse
 * in a few lines without pulling in a package for it.
 */

import crypto from 'crypto';
import { Request } from 'express';

export const SESSION_COOKIE_NAME = 'sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function sessionExpiryFromNow(): string {
  return new Date(Date.now() + SESSION_TTL_MS).toISOString();
}

export function isSessionExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) {
      try { out[key] = decodeURIComponent(value); } catch { /* Ignore malformed cookies. */ }
    }
  }
  return out;
}

export function getSessionIdFromRequest(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
}

/** Builds a Set-Cookie header value for a freshly created session. */
export function buildSessionCookie(sessionId: string): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isProduction) {
    // Only sent over HTTPS. Local development typically runs over plain
    // http://localhost, where a Secure cookie would simply never be sent —
    // so this is gated on NODE_ENV rather than always-on.
    attributes.push('Secure');
  }
  return attributes.join('; ');
}

/** Builds a Set-Cookie header value that immediately expires the session cookie (logout). */
export function buildExpiredSessionCookie(): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const attributes = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isProduction) attributes.push('Secure');
  return attributes.join('; ');
}
