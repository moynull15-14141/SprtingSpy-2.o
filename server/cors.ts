/**
 * SportingSpy CORS Policy
 * =========================
 * PHASE 3 — SECURITY & ANTI-BOT.
 *
 * This app is genuinely single-origin: the same Express process serves both
 * the API and the frontend (via Vite middleware in dev, static files in
 * production) on one host:port. There is no legitimate cross-origin caller
 * today. The correct hardening here is therefore to NOT reflect an
 * open/wildcard CORS policy, and to only allow the specific origin(s) this
 * deployment is actually meant to serve.
 *
 * `ALLOWED_ORIGIN` (optional): a single origin (e.g.
 * "https://sportingspy.com") to explicitly allow in production if the app
 * is ever split across a different frontend host. Unset by default — with
 * it unset, no `Access-Control-Allow-Origin` header is ever sent, which
 * means browsers block cross-origin script access entirely (the strictest,
 * safest default for an app with no legitimate cross-origin caller).
 *
 * Never combines a wildcard `*` origin with `Access-Control-Allow-
 * Credentials: true` — that combination is invalid per the Fetch spec (and
 * a real vulnerability if a server ever mistakenly reflects arbitrary
 * origins while allowing credentials). This module never sets Allow-
 * Credentials unless it has echoed back one specific, allow-listed origin.
 */

import { Request, Response, NextFunction } from 'express';

function getAllowedOrigins(): string[] {
  const configured = process.env.ALLOWED_ORIGIN;
  return configured ? [configured] : [];
}

export function corsPolicy(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  const allowedOrigins = getAllowedOrigins();

  // A denied browser origin must not reach a mutation handler even if it
  // supplies a matching double-submit cookie/header. Requests without Origin
  // still need the normal authentication and CSRF checks.
  const sameOrigin = process.env.NODE_ENV !== 'production' && origin === `${req.protocol}://${req.get('host')}`;
  if (origin && !allowedOrigins.includes(origin) && !sameOrigin) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }

  if (origin && (allowedOrigins.includes(origin) || sameOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.vary('Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-csrf-token');
  }
  // No `else` branch that sets a wildcard or reflects an unlisted origin —
  // requests from any other origin simply receive no CORS headers at all,
  // which browsers treat as "cross-origin read access denied."

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
}
