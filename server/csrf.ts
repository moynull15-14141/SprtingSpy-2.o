/**
 * SportingSpy CSRF Protection — Double-Submit Cookie
 * =====================================================
 * PHASE 3 — SECURITY & ANTI-BOT.
 *
 * Strategy: double-submit cookie. This fits the existing architecture
 * (server-issued opaque session cookie, single-origin SPA+API) without
 * needing any server-side per-session CSRF storage:
 *
 *   1. `ensureCsrfCookie` runs on every request. If the browser doesn't
 *      already carry a `csrf_token` cookie, one is generated and set.
 *      Unlike the session cookie, this one is NOT HttpOnly — the frontend
 *      JS needs to read it so it can echo it back.
 *   2. The frontend (see src/context/AppContext.tsx's apiCall) reads that
 *      cookie value and sends it back as an `x-csrf-token` request header
 *      on every state-changing request.
 *   3. `requireCsrfToken` rejects any POST/PUT/PATCH/DELETE where the
 *      header doesn't exactly match the cookie.
 *
 * Why this is a real defense: a cross-site attacker's page can make the
 * browser SEND the session cookie automatically (that's the whole CSRF
 * problem), but it cannot READ the csrf_token cookie's value (browsers
 * enforce same-origin on cookie access via JS) and so cannot construct a
 * matching `x-csrf-token` header. A same-origin page (this app) can read
 * its own cookie freely, so legitimate requests are unaffected.
 *
 * This does not require a new dependency — the cookie parsing reuses
 * server/session.ts's existing parseCookies().
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { parseCookies } from './session';

export const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

function buildCsrfCookie(token: string): string {
  const isProduction = process.env.NODE_ENV === 'production';
  // Deliberately NOT HttpOnly: the frontend must be able to read this value
  // in JS to echo it back in a header. Its security comes from same-origin
  // cookie-read restrictions, not from being hidden from same-origin JS.
  const attributes = [`${CSRF_COOKIE_NAME}=${token}`, 'Path=/', 'SameSite=Lax'];
  if (isProduction) attributes.push('Secure');
  return attributes.join('; ');
}

/** Sets a csrf_token cookie on any request that doesn't already carry one. Safe to run on every request, including GETs — it never blocks anything. */
export function ensureCsrfCookie(req: Request, res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  if (!cookies[CSRF_COOKIE_NAME]) {
    const token = crypto.randomBytes(32).toString('hex');
    res.append('Set-Cookie', buildCsrfCookie(token));
  }
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Rejects POST/PUT/PATCH/DELETE requests whose x-csrf-token header doesn't match their csrf_token cookie. GET/HEAD/OPTIONS are never blocked. */
export function requireCsrfToken(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME];

  if (!cookieToken || !headerToken || Array.isArray(headerToken) || headerToken !== cookieToken) {
    return res.status(403).json({ error: 'CSRF validation failed. Please reload the page and try again.' });
  }

  next();
}
