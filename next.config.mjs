/**
 * Next.js configuration (PHASE B). Next renders pages inside the existing
 * Express server (server.ts), which keeps ownership of security headers,
 * CSRF, CORS, redirects, the trailing-slash policy, /api, sitemap and robots.
 * @type {import('next').NextConfig}
 */
import 'dotenv/config';

const nextConfig = {
  // Spec v1.1 §10 / Phase A: canonical public URLs end with "/".
  trailingSlash: true,
  poweredByHeader: false,
  // The project uses TypeScript 7 (native compiler, no JS API), which Next's
  // built-in type-check step cannot drive. Types are checked by `npm run lint`
  // (tsc --noEmit), which the build script runs first.
  typescript: { ignoreBuildErrors: true },
  // Database drivers stay as regular Node modules instead of being bundled.
  serverExternalPackages: ['pg', '@prisma/adapter-pg', '@prisma/client'],
  images: { unoptimized: true },
  // PHASE G: media URLs are built in server AND client components (the CMS
  // Media Library), so the public media base is inlined at build time.
  // It is a public URL (it appears in every page). Rebuild after changing it.
  env: { MEDIA_PUBLIC_BASE_URL: process.env.MEDIA_PUBLIC_BASE_URL || '' },
};

export default nextConfig;
