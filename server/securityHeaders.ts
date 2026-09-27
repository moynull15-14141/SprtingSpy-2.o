/**
 * SportingSpy Security Headers
 * ==============================
 * PHASE 3 — SECURITY & ANTI-BOT.
 *
 * Hand-written rather than pulling in `helmet` — this is a small, fixed set
 * of headers for one specific app, not a general-purpose header framework.
 *
 * Applied in both development and production:
 *   - X-Content-Type-Options, Referrer-Policy, X-Frame-Options,
 *     Permissions-Policy — none of these can break a working app; they only
 *     remove behaviors (MIME-sniffing, referrer leakage, framing,
 *     unrequested browser features) the app never relied on.
 *
 * Applied in production only:
 *   - Content-Security-Policy — restrictive, but crafted to match this
 *     app's actual resources (self-hosted scripts/styles, Google Fonts,
 *     Unsplash-hosted images). Skipped in development because Vite's dev
 *     middleware (HMR websocket, inline dev helpers) needs a much looser
 *     policy, and a broken CSP in local dev would be pure friction with no
 *     real security benefit (there's no untrusted content on
 *     localhost during development).
 *   - Strict-Transport-Security — only ever sent over HTTPS; sending it
 *     over plain HTTP is a no-op for browsers, but gating it on
 *     NODE_ENV=production keeps the intent explicit and avoids ever
 *     confusing a local HTTP dev server with a production HTTPS one.
 */

import { Request, Response, NextFunction } from 'express';

const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://images.unsplash.com",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // X-Frame-Options is legacy but still widely honored; frame-ancestors in
  // the CSP below is the modern equivalent for browsers that support it.
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');

  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Content-Security-Policy', PRODUCTION_CSP);
    // req.secure honors only the explicitly configured proxy addresses.
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }

  next();
}
