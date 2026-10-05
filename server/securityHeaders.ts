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

import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { trackingConfigSnapshot } from './trackingConfig';
import type { PrivacyConfig } from '../src/lib/consent';
import { profileImageOrigins } from './profileImage';

// PHASE B: Next.js server rendering emits inline bootstrap scripts, so the
// production policy allows scripts only from 'self' plus a fresh per-request
// nonce. Next reads the nonce from the request's CSP header and stamps it on
// its own <script> tags; the header is always overwritten here, so a client
// can never supply its own nonce.
// PHASE F: third-party hosts are added only for providers an Admin has
// actually configured (GA4 / AdSense settings). With nothing configured the
// policy is exactly the original one. Consent is enforced by the page code;
// the CSP only bounds which hosts could ever be contacted.
const GA4 = {
  script: ['https://www.googletagmanager.com'],
  connect: ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com'],
  img: ['https://*.google-analytics.com', 'https://*.googletagmanager.com'],
  frame: [] as string[],
};
// AdSense serves creatives from many hosts (Google's published CSP guidance).
const ADSENSE = {
  script: ['https://pagead2.googlesyndication.com', 'https://*.googlesyndication.com', 'https://*.gstatic.com', 'https://*.google.com', 'https://*.doubleclick.net', 'https://*.googleadservices.com', 'https://*.adtrafficquality.google'],
  connect: ['https://*.googlesyndication.com', 'https://*.doubleclick.net', 'https://*.google.com', 'https://*.adtrafficquality.google'],
  img: ['https:'],
  frame: ['https://*.googlesyndication.com', 'https://*.doubleclick.net', 'https://*.google.com', 'https://*.adtrafficquality.google'],
};

// PHASE G: article embeds (components/editorial/RichText.tsx) render only
// these two players; every other frame stays blocked.
const EMBED_FRAMES = ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'];

/** The origin of MEDIA_PUBLIC_BASE_URL when media is served from another host (e.g. a CDN). */
function mediaOrigin(): string {
  const base = process.env.MEDIA_PUBLIC_BASE_URL;
  if (!base || !/^https?:\/\//i.test(base)) return '';
  try { return ` ${new URL(base).origin}`; } catch { return ''; }
}

export const productionCsp = (nonce: string, providers: PrivacyConfig = trackingConfigSnapshot()) => {
  const on = [...(providers.ga4MeasurementId ? [GA4] : []), ...(providers.adsenseClient ? [ADSENSE] : [])];
  const extra = (kind: keyof typeof GA4) => [...new Set(on.flatMap((p) => p[kind]))].map((h) => ` ${h}`).join('');
  const frames = [...new Set([...EMBED_FRAMES, ...on.flatMap((p) => p.frame)])].map((h) => ` ${h}`).join('');
  const media = mediaOrigin();
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${extra('script')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: ${profileImageOrigins().join(' ')}${extra('img')}`,
    `media-src 'self'${media}`,
    `connect-src 'self'${extra('connect')}`,
    `frame-src 'self'${frames}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
};

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // X-Frame-Options is legacy but still widely honored; frame-ancestors in
  // the CSP below is the modern equivalent for browsers that support it.
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');

  if (process.env.NODE_ENV === 'production') {
    const csp = productionCsp(crypto.randomBytes(16).toString('base64'));
    req.headers['content-security-policy'] = csp;
    res.setHeader('Content-Security-Policy', csp);
    // req.secure honors only the explicitly configured proxy addresses.
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }

  next();
}
