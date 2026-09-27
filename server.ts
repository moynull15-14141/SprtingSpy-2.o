/**
 * SportingSpy Full-Stack Application Server
 * Provides:
 * 1. HTTP 301/302 Server-Level Redirect Engine with loop and chain prevention.
 * 2. Real-time Scheduled Article Publication Engine.
 * 3. Dynamic XML Sitemap & Robots.txt generation with proper HTTP headers.
 * 4. Server-Side RBAC Enforcement on all mutation endpoints (Admin, Editor, Author, Reader).
 * 5. Persistent PostgreSQL Database via Prisma, with CRUD APIs. (PHASE 2 — see PROJECT_BRAIN.md)
 * 6. Vite Dev Middleware integration in development and static asset serving in production.
 *
 * PHASE 2 — POSTGRESQL MIGRATION:
 * This file used to read/write the ENTIRE data/db.json on every request
 * (Request -> read whole file -> mutate in memory -> write whole file back).
 * It now issues targeted PostgreSQL queries via the Prisma client in
 * server/db.ts. data/db.json is retained on disk only as the historical
 * migration source/backup (see server/scripts/migrate-json-to-postgres.ts)
 * — nothing in this file reads or writes it anymore.
 */

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { accountRouter } from './server/account';
import { rejectNestedCmsWrites } from './server/cmsFields';
import { deploymentConfig, DeploymentConfigError, enforceProductionTransport } from './server/deployment';
import { prisma } from './server/db';
import { Role } from './src/types';
import { assertSafeAuthBoot, getAuthContext, requireAuth, requireRole, AuthLookup } from './server/auth';
import { validateSlug, validateText, validateSafeUrl, validateRedirectSource, validateEmail, firstError } from './server/validation';
import { hashPassword, verifyPassword, validatePasswordStrength } from './server/password';
import {
  generateSessionId,
  sessionExpiryFromNow,
  buildSessionCookie,
  buildExpiredSessionCookie,
  getSessionIdFromRequest,
  isSessionExpired,
} from './server/session';
import {
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginRateLimit,
  checkCommentRateLimit,
  recordComment,
  checkStaffCreationRateLimit,
  recordStaffCreation,
} from './server/rateLimit';
import { ensureCsrfCookie, requireCsrfToken } from './server/csrf';
import { securityHeaders } from './server/securityHeaders';
import { corsPolicy } from './server/cors';

/**
 * Every seeded demo account that predates Phase 1 was migrated (via
 * server/scripts/migrate-json-to-postgres.ts, which reuses
 * server/jsonSchema.ts's migrateSchema()) to this password, purely so the
 * existing demo dataset remains logged-in-able out of the box. LOCAL
 * DEVELOPMENT DEFAULT for pre-existing seed content only — any staff user
 * created after Phase 1 (via POST /api/users) is given a real password at
 * creation time and never receives this default.
 */
const LEGACY_SEED_DEFAULT_PASSWORD = 'ChangeMe123!';
void LEGACY_SEED_DEFAULT_PASSWORD; // documented for operators; see .env.example

/** A fixed, precomputed hash used only to give the "unknown email" login path a real scrypt computation to perform — see /api/auth/login. */
const DUMMY_HASH_FOR_TIMING_CAMOUFLAGE = hashPassword('sportingspy-dummy-timing-camouflage');


/** Never send passwordHash to the client. Always project through this before responding. */
function sanitizeUser<T extends { passwordHash: string }>(user: T): Omit<T, 'passwordHash'> {
  const { passwordHash, ...safe } = user;
  return safe;
}

/** True if `candidateUserId` is the sole active Admin — blocks role/status/delete changes that would leave zero administrators. */
async function isLastActiveAdmin(candidateUserId: string): Promise<boolean> {
  const candidate = await prisma.user.findUnique({ where: { id: candidateUserId } });
  if (!candidate || candidate.role !== 'Admin' || candidate.status !== 'active') {
    return false;
  }
  const otherActiveAdmins = await prisma.user.count({
    where: { id: { not: candidateUserId }, role: 'Admin', status: 'active' },
  });
  return otherActiveAdmins === 0;
}

/** Wraps an async Express handler so a rejected promise reaches the error-handling middleware instead of crashing the process or hanging the request. */
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// Scheduled Article Publisher Engine
async function publishScheduledArticles(): Promise<number> {
  const now = new Date();
  const due = await prisma.article.findMany({
    where: { status: 'scheduled', scheduledFor: { lte: now } },
  });

  for (const art of due) {
    await prisma.article.update({
      where: { id: art.id },
      data: { status: 'published', publishedAt: art.scheduledFor || now, updatedAt: now },
    });
    await prisma.auditLog.create({
      data: {
        id: `log-scheduler-${Date.now()}-${art.id}`,
        userId: 'system-scheduler',
        userName: 'Automated Lifecycle Daemon',
        action: 'Auto-Published Scheduled Article',
        entityType: 'Article',
        entityId: art.id,
        timestamp: new Date(),
        details: `Article "${art.title}" reached release window (${art.scheduledFor?.toISOString()}) and was transitioned to published.`,
      },
    });
  }

  if (due.length > 0) {
    console.log(`[Scheduler] Auto-published ${due.length} scheduled article(s).`);
  }
  return due.length;
}

async function startServer() {
  const deployment = deploymentConfig();
  assertSafeAuthBoot();
  // Read-only connection/schema check. Startup never runs migrations or imports.
  await prisma.user.count();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deployment.trustProxy);

  // PHASE 3 hardening — order matters here:
  //   CORS decision -> security headers -> body parsing (size-limited) ->
  //   CSRF cookie issuance -> CSRF enforcement -> everything else.
  app.use(securityHeaders);
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(enforceProductionTransport);
  app.use(corsPolicy);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  // Express's default json() body limit is 100kb, which is smaller than the
  // 200,000-character article content this app already validates elsewhere
  // (see validateText(body.content, 'content', 200000) in the articles
  // routes below) — legitimate long-form articles would have been rejected
  // by the body parser before ever reaching that validation. 2mb comfortably
  // covers real article/media-metadata payloads while still bounding
  // request size well below anything that could meaningfully strain the
  // server.
  app.use(express.json({ limit: '2mb' }));
  app.use(ensureCsrfCookie);
  app.use(requireCsrfToken);
  app.use(rejectNestedCmsWrites);

  // 1. HTTP 301/302 Redirect Engine Middleware
  // Intercepts real HTTP requests and issues true 301 or 302 redirects with Location header
  app.use(
    asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
      // Only evaluate GET requests that are not internal assets or API routes
      if (
        req.method !== 'GET' ||
        req.path.startsWith('/api') ||
        req.path.startsWith('/@') ||
        req.path.startsWith('/src') ||
        req.path.startsWith('/node_modules') ||
        req.path.includes('.')
      ) {
        return next();
      }

      const cleanPath = req.path.endsWith('/') && req.path.length > 1 ? req.path.slice(0, -1) : req.path;

      const rule = await prisma.redirectRule.findFirst({ where: { isActive: true, sourceUrl: cleanPath } });
      if (!rule) {
        return next();
      }

      // Loop prevention & self-redirect check
      if (rule.targetUrl === cleanPath) {
        console.warn(`[Redirect Engine] Loop detected: ${cleanPath} points to itself. Skipping.`);
        return next();
      }

      // Chain detection: verify target does not recursively point back within 5 steps
      let currentDest = rule.targetUrl;
      let chainCount = 0;
      while (chainCount < 5) {
        const nextRule = await prisma.redirectRule.findFirst({ where: { isActive: true, sourceUrl: currentDest } });
        if (!nextRule) break;
        if (nextRule.targetUrl === cleanPath) {
          console.warn(`[Redirect Engine] Circular loop detected between ${cleanPath} and ${currentDest}. Breaking.`);
          break;
        }
        currentDest = nextRule.targetUrl;
        chainCount++;
      }

      // Preserve query parameters if any
      const queryIndex = req.url.indexOf('?');
      const queryString = queryIndex !== -1 ? req.url.slice(queryIndex) : '';
      const finalDestination = currentDest + queryString;

      console.log(`[Redirect Engine] Serving HTTP ${rule.statusCode} from ${req.url} -> ${finalDestination}`);
      return res.redirect(rule.statusCode, finalDestination);
    })
  );

  // 2. Dynamic XML Sitemap Generator
  app.get(
    '/sitemap.xml',
    asyncHandler(async (_req: Request, res: Response) => {
      await publishScheduledArticles();
      const baseUrl = deployment.origin || 'https://sportingspy.com';

      const [sports, events, editions, articles, authors] = await Promise.all([
        prisma.sport.findMany({ where: { isVisible: true } }),
        prisma.sportEvent.findMany(),
        prisma.eventEdition.findMany(),
        prisma.article.findMany({ where: { status: 'published' } }),
        prisma.author.findMany(),
      ]);

      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

      const staticPages = [
        { loc: '/', priority: '1.0', changefreq: 'daily' },
        { loc: '/sports', priority: '0.9', changefreq: 'weekly' },
        { loc: '/events', priority: '0.9', changefreq: 'weekly' },
        { loc: '/latest', priority: '0.9', changefreq: 'hourly' },
        { loc: '/search', priority: '0.6', changefreq: 'monthly' },
        { loc: '/about', priority: '0.5', changefreq: 'monthly' },
        { loc: '/contact', priority: '0.5', changefreq: 'monthly' },
        { loc: '/privacy', priority: '0.3', changefreq: 'yearly' },
        { loc: '/terms', priority: '0.3', changefreq: 'yearly' },
        { loc: '/dmca', priority: '0.3', changefreq: 'yearly' },
      ];

      for (const p of staticPages) {
        xml += `  <url>\n    <loc>${baseUrl}${p.loc}</loc>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>\n`;
      }

      for (const sport of sports) {
        xml += `  <url>\n    <loc>${baseUrl}/${sport.slug}</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.85</priority>\n  </url>\n`;
      }

      for (const ev of events) {
        xml += `  <url>\n    <loc>${baseUrl}/${ev.sportSlug}/${ev.slug}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
      }

      for (const ed of editions) {
        xml += `  <url>\n    <loc>${baseUrl}/${ed.sportSlug}/${ed.eventSlug}/${ed.year}</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
      }

      for (const art of articles) {
        const articleUrl =
          art.eventSlug && art.editionYear
            ? `${baseUrl}/${art.sportSlug}/${art.eventSlug}/${art.editionYear}/${art.slug}`
            : `${baseUrl}/${art.sportSlug}/${art.slug}`;
        const lastMod = (art.updatedAt || art.publishedAt).toISOString().split('T')[0];
        xml += `  <url>\n    <loc>${articleUrl}</loc>\n    <lastmod>${lastMod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.75</priority>\n  </url>\n`;
      }

      for (const auth of authors) {
        xml += `  <url>\n    <loc>${baseUrl}/author/${auth.slug}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>\n`;
      }

      xml += `</urlset>`;

      res.header('Content-Type', 'application/xml; charset=utf-8');
      res.header('Cache-Control', 'public, max-age=3600');
      return res.send(xml);
    })
  );

  // 3. Dynamic Robots.txt
  app.get('/robots.txt', (_req: Request, res: Response) => {
    const robotsContent = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /account
Disallow: /api/

Sitemap: ${deployment.origin || 'https://sportingspy.com'}/sitemap.xml
`;
    res.header('Content-Type', 'text/plain; charset=utf-8');
    return res.send(robotsContent);
  });

  // 4. Server-Side Authorization Boundary
  // PHASE 2: identity resolution is now two targeted Prisma queries (see
  // server/auth.ts's AuthLookup interface) instead of loading the whole
  // users/sessions JSON arrays into memory on every request.
  const authLookup: AuthLookup = {
    async resolveSession(sessionId) {
      const session = await prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } });
      if (!session) return null;
      if (isSessionExpired(session.expiresAt.toISOString())) return null;
      if (!session.user || session.user.status !== 'active') return null;
      return { userId: session.user.id, userName: session.user.name, role: session.user.role };
    },
    async resolveBypassUser(userId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return null;
      return { userId: user.id, userName: user.name, role: user.role };
    },
  };
  const getAuthLookup = () => authLookup;

  // 5. Authentication Endpoints
  app.post(
    '/api/auth/login',
    asyncHandler(async (req: Request, res: Response) => {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const { email, password } = req.body as { email?: string; password?: string };

      if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
        return res.status(400).json({ error: 'email and password are required.' });
      }

      const rateLimit = checkLoginRateLimit(ip, email);
      if (rateLimit.limited) {
        res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
        return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
      }

      const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });

      // Timing camouflage: run a real scrypt computation on the unknown-email
      // path too (against a throwaway hash), so a response-time difference
      // can't be used to infer whether an email address has an account. The
      // error message is identical either way regardless.
      let passwordOk: boolean;
      if (user) {
        passwordOk = verifyPassword(password, user.passwordHash);
      } else {
        verifyPassword(password, DUMMY_HASH_FOR_TIMING_CAMOUFLAGE);
        passwordOk = false;
      }
      const isActive = user ? user.status === 'active' : false;

      if (!user || !passwordOk || !isActive) {
        recordFailedLogin(ip, email);
        await prisma.auditLog.create({
          data: {
            id: `log-${Date.now()}`,
            userId: user?.id || 'unknown',
            userName: email.trim(),
            action: 'Login Failed',
            entityType: 'User',
            entityId: user?.id || 'unknown',
            timestamp: new Date(),
            details: `Failed login attempt for "${email.trim()}" from ${ip}.`,
          },
        });
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      clearLoginRateLimit(ip, email);

      const session = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
        const fresh = await tx.user.findUnique({ where: { id: user.id } });
        if (!fresh || fresh.status !== 'active' || fresh.passwordHash !== user.passwordHash) return null;
        return tx.session.create({
        data: {
          id: generateSessionId(),
          userId: user.id,
          createdAt: new Date(),
          expiresAt: new Date(sessionExpiryFromNow()),
        },
        });
      });
      if (!session) return res.status(401).json({ error: 'Invalid email or password.' });
      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId: user.id,
          userName: user.name,
          action: 'Login Succeeded',
          entityType: 'User',
          entityId: user.id,
          timestamp: new Date(),
          details: `${user.name} logged in from ${ip}.`,
        },
      });

      res.append('Set-Cookie', buildSessionCookie(session.id));
      return res.json({ user: sanitizeUser(user) });
    })
  );

  app.post(
    '/api/auth/logout',
    asyncHandler(async (req: Request, res: Response) => {
      const sessionId = getSessionIdFromRequest(req);

      if (sessionId) {
        const session = await prisma.session.findUnique({ where: { id: sessionId } });
        if (session) {
          const user = await prisma.user.findUnique({ where: { id: session.userId } });
          await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${session.userId} FOR UPDATE`;
          await tx.session.deleteMany({ where: { id: sessionId } });
          await tx.auditLog.create({
            data: {
              id: `log-${crypto.randomUUID()}`,
              userId: session.userId,
              userName: user?.name || session.userId,
              action: 'Logout',
              entityType: 'User',
              entityId: session.userId,
              timestamp: new Date(),
              details: `${user?.name || session.userId} logged out.`,
            },
          });
          });
        }
      }

      res.append('Set-Cookie', buildExpiredSessionCookie());
      return res.json({ success: true });
    })
  );

  app.use('/api/auth', accountRouter(getAuthLookup));

  // 6. REST API Endpoints

  // Full dataset for client hydration
  app.get(
    '/api/data',
    asyncHandler(async (req: Request, res: Response) => {
      await publishScheduledArticles();
      const { role, userId } = await getAuthContext(req, authLookup);
      const previewAllowed = ['Admin', 'Editor', 'Author'].includes(role);

      const [sports, events, editions, articles, authors, users, comments, mediaItems, adSlots, auditLogs, redirectRules] =
        await Promise.all([
          prisma.sport.findMany({ orderBy: { order: 'asc' } }),
          prisma.sportEvent.findMany(),
          prisma.eventEdition.findMany(),
          prisma.article.findMany({
            where: previewAllowed ? undefined : { status: 'published' },
            orderBy: { publishedAt: 'desc' },
          }),
          prisma.author.findMany(),
          role === 'Admin' ? prisma.user.findMany() : Promise.resolve([]),
          prisma.comment.findMany({ where: ['Admin', 'Editor'].includes(role) ? undefined : { OR: [{ status: 'approved' }, { userId }] }, orderBy: { createdAt: 'desc' } }),
          prisma.mediaItem.findMany({ orderBy: { uploadedAt: 'desc' } }),
          prisma.adSlotConfig.findMany(),
          ['Admin', 'Editor'].includes(role) ? prisma.auditLog.findMany({ orderBy: { timestamp: 'desc' } }) : Promise.resolve([]),
          prisma.redirectRule.findMany({ orderBy: { createdAt: 'desc' } }),
        ]);

      // PHASE 1/2: never send passwordHash to the client, and never send a
      // sessions collection at all — it has no legitimate frontend use.
      return res.json({
        sports,
        events,
        editions,
        articles,
        authors,
        users: users.map(sanitizeUser),
        comments,
        mediaItems,
        adSlots,
        auditLogs,
        redirectRules,
      });
    })
  );

  // Articles API
  app.get(
    '/api/articles',
    asyncHandler(async (req: Request, res: Response) => {
      await publishScheduledArticles();
      const { role } = await getAuthContext(req, authLookup);
      const previewAllowed = ['Admin', 'Editor', 'Author'].includes(role);

      // PHASE 3: defensively reject malformed query params instead of
      // trusting `as string` casts. Express turns repeated/bracketed query
      // keys (e.g. ?sport[]=a&sport[]=b) into arrays/objects, which would
      // otherwise flow into the Prisma `where` clause as an unexpected type.
      for (const key of ['sport', 'event', 'type'] as const) {
        const value = req.query[key];
        if (value !== undefined && (typeof value !== 'string' || value.length > 200)) {
          return res.status(400).json({ error: `${key} query parameter must be a single string.` });
        }
      }
      let parsedYear: number | undefined;
      if (req.query.year !== undefined) {
        if (typeof req.query.year !== 'string' || !/^\d{1,4}$/.test(req.query.year)) {
          return res.status(400).json({ error: 'year query parameter must be a plain 1-4 digit number.' });
        }
        parsedYear = parseInt(req.query.year, 10);
      }

      const where: Record<string, unknown> = previewAllowed ? {} : { status: 'published' };
      if (req.query.sport) where.sportSlug = req.query.sport as string;
      if (req.query.event) where.eventSlug = req.query.event as string;
      if (parsedYear !== undefined) where.editionYear = parsedYear;
      if (req.query.type) where.articleType = req.query.type as string;

      // PHASE 3: a hard cap on how many rows a single request can pull back.
      // There is no pagination UI yet (out of scope to build one in a
      // security-hardening phase), but an unbounded findMany() is still an
      // abuse surface — this keeps a single request bounded without
      // changing the existing unpaginated response shape the frontend
      // already expects.
      const list = await prisma.article.findMany({ where, orderBy: { publishedAt: 'desc' }, take: 500 });
      return res.json(list);
    })
  );

  app.post(
    '/api/articles',
    requireRole(getAuthLookup, ['Admin', 'Editor', 'Author']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName, role } = req.authContext!;
      const body: Record<string, any> = req.body;

      if (!body.title || !body.sportSlug || !body.content) {
        return res.status(400).json({ error: 'Missing required article fields: title, sportSlug, content.' });
      }

      const slug = body.slug || body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

      const validationError = firstError(
        validateText(body.title, 'title', 300),
        validateText(body.content, 'content', 200000),
        validateSlug(body.sportSlug, 'sportSlug'),
        validateSlug(slug, 'slug'),
        validateText(body.subtitle, 'subtitle', 300, false),
        validateText(body.excerpt, 'excerpt', 1000, false),
        validateSafeUrl(body.featuredImage, 'featuredImage', { required: false }),
        validateText(body.seo?.metaTitle, 'seo.metaTitle', 300, false),
        validateText(body.seo?.metaDescription, 'seo.metaDescription', 500, false)
      );
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const eventSlug = body.eventSlug ?? null;
      const editionYear = body.editionYear ?? null;

      // Check slug uniqueness within scope (matches the app's existing JS
      // undefined===undefined semantics for general articles: an explicit
      // `null` filter here means "IS NULL", which is exactly equivalent).
      const collision = await prisma.article.findFirst({
        where: { sportSlug: body.sportSlug, eventSlug, editionYear, slug },
      });
      if (collision) {
        return res.status(409).json({ error: `Article with slug '${slug}' already exists in this sport/edition scope.` });
      }

      // PHASE 1: Article.authorId references an Author profile's id, not a
      // User's id — these are different namespaces (e.g. 'auth-elena' vs
      // 'user-editor-1'). Default to the Author profile linked to the
      // acting user's account (via Author.userId).
      let authorId: string | undefined = body.authorId;
      if (!authorId) {
        const linkedAuthor = await prisma.author.findFirst({ where: { userId } });
        authorId = linkedAuthor?.id;
      }
      if (!authorId) {
        return res.status(400).json({
          error: 'No Author profile is linked to your account, and no authorId was provided. Ask an Admin to link (or create) an Author profile for you first.',
        });
      }
      const authorExists = await prisma.author.findUnique({ where: { id: authorId } });
      if (!authorExists) {
        return res.status(400).json({ error: `authorId '${authorId}' does not reference an existing Author profile.` });
      }

      const now = new Date();
      const newArticle = await prisma.article.create({
        data: {
          id: `art-${Date.now()}`,
          slug,
          title: body.title,
          subtitle: body.subtitle || '',
          sportSlug: body.sportSlug,
          eventSlug,
          editionYear,
          articleType: body.articleType || 'Event Guide',
          excerpt: body.excerpt || '',
          content: body.content,
          featuredImage: body.featuredImage || 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1200&q=80',
          authorId,
          publishedAt: body.publishedAt ? new Date(body.publishedAt) : now,
          updatedAt: now,
          scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
          status: body.status || 'draft',
          readingTimeMinutes: body.readingTimeMinutes || Math.max(1, Math.ceil((body.content || '').split(' ').length / 200)),
          featured: body.featured || false,
          tables: body.tables ?? undefined,
          references: body.references ?? undefined,
          seo: body.seo || { metaTitle: body.title, metaDescription: body.excerpt },
        },
      });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Created Article',
          entityType: 'Article',
          entityId: newArticle.id,
          timestamp: new Date(),
          details: `Created article "${newArticle.title}" (status: ${newArticle.status}) by ${userName} (${role}).`,
        },
      });

      return res.status(201).json(newArticle);
    })
  );

  app.put(
    '/api/articles/:id',
    requireRole(getAuthLookup, ['Admin', 'Editor', 'Author']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName, role } = req.authContext!;
      const existing = await prisma.article.findUnique({ where: { id: req.params.id } });

      if (!existing) {
        return res.status(404).json({ error: 'Article not found.' });
      }

      // Authors can only modify their own articles.
      // PHASE 0.1 removed a hardcoded 'auth-alistair' bypass that let any
      // Author edit that one specific seeded author's articles — a leftover
      // debug shortcut worked around a real gap: there was no actual
      // Author<->User relationship to check ownership against. PHASE 1
      // fixed this properly via Author.userId; PHASE 2 preserves the exact
      // same check against PostgreSQL.
      if (role === 'Author') {
        const ownerAuthorProfile = await prisma.author.findUnique({ where: { id: existing.authorId } });
        if (!ownerAuthorProfile || ownerAuthorProfile.userId !== userId) {
          return res.status(403).json({ error: 'Authors are only permitted to edit their own articles.' });
        }
      }

      const updates: Record<string, any> = req.body;

      const validationError = firstError(
        validateText(updates.title, 'title', 300, false),
        validateText(updates.content, 'content', 200000, false),
        updates.sportSlug !== undefined ? validateSlug(updates.sportSlug, 'sportSlug') : { valid: true },
        updates.slug !== undefined ? validateSlug(updates.slug, 'slug') : { valid: true },
        validateText(updates.subtitle, 'subtitle', 300, false),
        validateText(updates.excerpt, 'excerpt', 1000, false),
        validateSafeUrl(updates.featuredImage, 'featuredImage', { required: false })
      );
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const data: Record<string, any> = { ...updates, updatedAt: new Date() };
      if ('publishedAt' in updates) data.publishedAt = updates.publishedAt ? new Date(updates.publishedAt) : existing.publishedAt;
      if ('scheduledFor' in updates) data.scheduledFor = updates.scheduledFor ? new Date(updates.scheduledFor) : null;
      if ('eventSlug' in updates) data.eventSlug = updates.eventSlug ?? null;
      if ('editionYear' in updates) data.editionYear = updates.editionYear ?? null;

      const updated = await prisma.article.update({ where: { id: existing.id }, data });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Updated Article',
          entityType: 'Article',
          entityId: updated.id,
          timestamp: new Date(),
          details: `Updated article "${updated.title}" (status: ${updated.status}) by ${userName}.`,
        },
      });

      return res.json(updated);
    })
  );

  app.delete(
    '/api/articles/:id',
    requireRole(getAuthLookup, ['Admin', 'Editor']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const target = await prisma.article.findUnique({ where: { id: req.params.id } });

      if (!target) {
        return res.status(404).json({ error: 'Article not found.' });
      }

      await prisma.article.delete({ where: { id: target.id } });
      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Deleted Article',
          entityType: 'Article',
          entityId: req.params.id,
          timestamp: new Date(),
          details: `Deleted article "${target.title}" by ${userName}.`,
        },
      });

      return res.json({ success: true, id: req.params.id });
    })
  );

  // Sports API (Admin Only)
  app.post(
    '/api/sports',
    requireRole(getAuthLookup, ['Admin']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const body: Record<string, any> = req.body;

      if (!body.name || !body.slug) {
        return res.status(400).json({ error: 'Sport name and slug are required.' });
      }

      const validationError = firstError(
        validateText(body.name, 'name', 200),
        validateSlug(body.slug, 'slug'),
        validateText(body.tagline, 'tagline', 300, false),
        validateText(body.description, 'description', 5000, false),
        validateSafeUrl(body.heroImage, 'heroImage', { required: false })
      );
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const existing = await prisma.sport.findUnique({ where: { slug: body.slug } });
      if (existing) {
        return res.status(409).json({ error: `Sport slug '${body.slug}' already exists.` });
      }

      const sportCount = await prisma.sport.count();
      const newSport = await prisma.sport.create({
        data: {
          id: `sport-${body.slug}-${Date.now()}`,
          slug: body.slug,
          name: body.name,
          tagline: body.tagline || '',
          description: body.description || '',
          order: body.order || sportCount + 1,
          isVisible: body.isVisible !== false,
          featuredEventIds: body.featuredEventIds || [],
          heroImage: body.heroImage,
          seo: body.seo || { metaTitle: `${body.name} Coverage | SportingSpy`, metaDescription: body.description },
        },
      });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Created Sport',
          entityType: 'Sport',
          entityId: newSport.id,
          timestamp: new Date(),
          details: `Admin ${userName} created sport ${newSport.name}.`,
        },
      });

      return res.status(201).json(newSport);
    })
  );

  app.put(
    '/api/sports/:id',
    requireRole(getAuthLookup, ['Admin']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const existing = await prisma.sport.findUnique({ where: { id: req.params.id } });

      if (!existing) {
        return res.status(404).json({ error: 'Sport not found.' });
      }

      const sportUpdates: Record<string, any> = req.body;
      const sportUpdateError = firstError(
        validateText(sportUpdates.name, 'name', 200, false),
        sportUpdates.slug !== undefined ? validateSlug(sportUpdates.slug, 'slug') : { valid: true },
        validateText(sportUpdates.tagline, 'tagline', 300, false),
        validateText(sportUpdates.description, 'description', 5000, false),
        validateSafeUrl(sportUpdates.heroImage, 'heroImage', { required: false })
      );
      if (sportUpdateError) {
        return res.status(400).json({ error: sportUpdateError });
      }

      const updated = await prisma.sport.update({ where: { id: existing.id }, data: sportUpdates });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Updated Sport',
          entityType: 'Sport',
          entityId: req.params.id,
          timestamp: new Date(),
          details: `Admin ${userName} updated sport ${updated.name}.`,
        },
      });

      return res.json(updated);
    })
  );

  app.delete(
    '/api/sports/:id',
    requireRole(getAuthLookup, ['Admin']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const sport = await prisma.sport.findUnique({ where: { id: req.params.id } });

      if (!sport) {
        return res.status(404).json({ error: 'Sport not found.' });
      }

      // Check orphan prevention: cannot delete sport if events or articles belong to it
      const [associatedEvents, associatedArticles] = await Promise.all([
        prisma.sportEvent.count({ where: { sportSlug: sport.slug } }),
        prisma.article.count({ where: { sportSlug: sport.slug } }),
      ]);

      if (associatedEvents > 0 || associatedArticles > 0) {
        return res.status(400).json({
          error: `Cannot delete sport '${sport.name}': has ${associatedEvents} active events and ${associatedArticles} articles. Remove or reassign them first to prevent orphaned records.`,
        });
      }

      await prisma.sport.delete({ where: { id: sport.id } });
      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Deleted Sport',
          entityType: 'Sport',
          entityId: req.params.id,
          timestamp: new Date(),
          details: `Admin ${userName} deleted sport ${sport.name}.`,
        },
      });

      return res.json({ success: true, id: req.params.id });
    })
  );

  // Events API (Admin & Editor)
  app.post(
    '/api/events',
    requireRole(getAuthLookup, ['Admin', 'Editor']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const body: Record<string, any> = req.body;

      if (!body.name || !body.slug || !body.sportSlug) {
        return res.status(400).json({ error: 'Event name, slug, and sportSlug are required.' });
      }

      const validationError = firstError(
        validateText(body.name, 'name', 200),
        validateSlug(body.slug, 'slug'),
        validateSlug(body.sportSlug, 'sportSlug'),
        validateText(body.description, 'description', 5000, false),
        validateText(body.defaultVenue, 'defaultVenue', 200, false),
        validateText(body.defaultLocation, 'defaultLocation', 200, false),
        validateSafeUrl(body.featuredImage, 'featuredImage', { required: false })
      );
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const collision = await prisma.sportEvent.findUnique({
        where: { sportSlug_slug: { sportSlug: body.sportSlug, slug: body.slug } },
      });
      if (collision) {
        return res.status(409).json({ error: `Event '${body.slug}' already exists under sport '${body.sportSlug}'.` });
      }

      const newEvent = await prisma.sportEvent.create({
        data: {
          id: `event-${body.slug}-${Date.now()}`,
          sportSlug: body.sportSlug,
          slug: body.slug,
          name: body.name,
          shortName: body.shortName || body.name,
          description: body.description || '',
          history: body.history,
          frequency: body.frequency || 'Annual',
          defaultVenue: body.defaultVenue || 'Championship Venue',
          defaultLocation: body.defaultLocation || 'Championship Host City',
          currentEditionYear: body.currentEditionYear || new Date().getFullYear(),
          allEditionYears: body.allEditionYears || [new Date().getFullYear()],
          featured: body.featured || false,
          isVisible: body.isVisible !== false,
          featuredImage: body.featuredImage || 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1200&q=80',
          seo: body.seo || { metaTitle: `${body.name} Guide | SportingSpy`, metaDescription: body.description },
        },
      });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Created Permanent Event',
          entityType: 'Event',
          entityId: newEvent.id,
          timestamp: new Date(),
          details: `Created permanent event ${newEvent.name} under ${newEvent.sportSlug}.`,
        },
      });

      return res.status(201).json(newEvent);
    })
  );

  app.put(
    '/api/events/:id',
    requireRole(getAuthLookup, ['Admin', 'Editor']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const existing = await prisma.sportEvent.findUnique({ where: { id: req.params.id } });

      if (!existing) {
        return res.status(404).json({ error: 'Event not found.' });
      }

      const updated = await prisma.sportEvent.update({ where: { id: existing.id }, data: req.body });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Updated Permanent Event',
          entityType: 'Event',
          entityId: req.params.id,
          timestamp: new Date(),
          details: `Updated event ${updated.name}.`,
        },
      });

      return res.json(updated);
    })
  );

  app.delete(
    '/api/events/:id',
    requireRole(getAuthLookup, ['Admin']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const ev = await prisma.sportEvent.findUnique({ where: { id: req.params.id } });

      if (!ev) {
        return res.status(404).json({ error: 'Event not found.' });
      }

      const [editionsCount, articlesCount] = await Promise.all([
        prisma.eventEdition.count({ where: { sportSlug: ev.sportSlug, eventSlug: ev.slug } }),
        prisma.article.count({ where: { sportSlug: ev.sportSlug, eventSlug: ev.slug } }),
      ]);

      if (editionsCount > 0 || articlesCount > 0) {
        return res.status(400).json({
          error: `Cannot delete event '${ev.name}': has ${editionsCount} staged editions and ${articlesCount} articles. Remove them first to prevent data corruption.`,
        });
      }

      await prisma.sportEvent.delete({ where: { id: ev.id } });
      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Deleted Permanent Event',
          entityType: 'Event',
          entityId: req.params.id,
          timestamp: new Date(),
          details: `Admin ${userName} deleted permanent event ${ev.name}.`,
        },
      });

      return res.json({ success: true, id: req.params.id });
    })
  );

  // Editions API (Admin & Editor)
  app.post(
    '/api/editions',
    requireRole(getAuthLookup, ['Admin', 'Editor']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const body: Record<string, any> = req.body;

      if (!body.eventSlug || !body.sportSlug || !body.year) {
        return res.status(400).json({ error: 'eventSlug, sportSlug, and year are required for an edition.' });
      }

      const validationError = firstError(
        validateSlug(body.eventSlug, 'eventSlug'),
        validateSlug(body.sportSlug, 'sportSlug'),
        typeof body.year === 'number' && Number.isInteger(body.year) && body.year >= 1900 && body.year <= 2200
          ? { valid: true }
          : { valid: false, error: 'year must be an integer between 1900 and 2200.' },
        validateText(body.venue, 'venue', 200, false),
        validateText(body.location, 'location', 200, false),
        validateText(body.description, 'description', 5000, false),
        validateSafeUrl(body.officialSourceUrl, 'officialSourceUrl', { required: false }),
        validateSafeUrl(body.featuredImage, 'featuredImage', { required: false })
      );
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const collision = await prisma.eventEdition.findUnique({
        where: { sportSlug_eventSlug_year: { sportSlug: body.sportSlug, eventSlug: body.eventSlug, year: body.year } },
      });
      if (collision) {
        return res.status(409).json({ error: `Edition ${body.year} already exists for event ${body.eventSlug}.` });
      }

      const newEdition = await prisma.eventEdition.create({
        data: {
          id: `${body.eventSlug}-${body.year}`,
          eventSlug: body.eventSlug,
          sportSlug: body.sportSlug,
          year: body.year,
          title: body.title || `${body.year} ${body.eventSlug.replace(/-/g, ' ')}`,
          startDate: body.startDate || `${body.year}-05-01`,
          endDate: body.endDate || `${body.year}-05-15`,
          venue: body.venue || 'Championship Venue',
          location: body.location || 'Official Location',
          status: body.status || 'upcoming',
          quickFacts: body.quickFacts || [],
          prizeMoneyTotal: body.prizeMoneyTotal,
          defendingChampions: body.defendingChampions ?? undefined,
          qualificationInfo: body.qualificationInfo,
          participantsCount: body.participantsCount,
          officialSourceUrl: body.officialSourceUrl,
          description: body.description || '',
          featuredImage: body.featuredImage || 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1200&q=80',
          seo: body.seo || { metaTitle: `${body.year} Edition Guide | SportingSpy`, metaDescription: body.description },
        },
      });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Created Event Edition',
          entityType: 'Edition',
          entityId: newEdition.id,
          timestamp: new Date(),
          details: `Created edition ${newEdition.title} for ${newEdition.eventSlug}.`,
        },
      });

      return res.status(201).json(newEdition);
    })
  );

  app.put(
    '/api/editions/:id',
    requireRole(getAuthLookup, ['Admin', 'Editor']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const existing = await prisma.eventEdition.findUnique({ where: { id: req.params.id } });

      if (!existing) {
        return res.status(404).json({ error: 'Edition not found.' });
      }

      const updated = await prisma.eventEdition.update({ where: { id: existing.id }, data: req.body });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Updated Event Edition',
          entityType: 'Edition',
          entityId: req.params.id,
          timestamp: new Date(),
          details: `Updated edition ${updated.title}.`,
        },
      });

      return res.json(updated);
    })
  );

  app.delete(
    '/api/editions/:id',
    requireRole(getAuthLookup, ['Admin']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const ed = await prisma.eventEdition.findUnique({ where: { id: req.params.id } });

      if (!ed) {
        return res.status(404).json({ error: 'Edition not found.' });
      }

      // PHASE 1: EventEdition delete was missing the orphan-article guard
      // that Sport/Event deletes already have. PHASE 2 preserves it exactly
      // against PostgreSQL: an edition with dependent Articles must not be
      // destructively deleted — that would silently orphan those articles'
      // canonical URL segment. Require reassigning/archiving them first.
      const dependentArticles = await prisma.article.count({
        where: { sportSlug: ed.sportSlug, eventSlug: ed.eventSlug, editionYear: ed.year },
      });
      if (dependentArticles > 0) {
        return res.status(400).json({
          error: `Cannot delete edition '${ed.title}': ${dependentArticles} article(s) reference it. Reassign or archive them first to prevent orphaned records.`,
        });
      }

      await prisma.eventEdition.delete({ where: { id: ed.id } });
      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Deleted Event Edition',
          entityType: 'Edition',
          entityId: req.params.id,
          timestamp: new Date(),
          details: `Admin ${userName} deleted edition ${ed.title}.`,
        },
      });

      return res.json({ success: true, id: req.params.id });
    })
  );

  // Comments API (requires a real authenticated session; see server/auth.ts.
  // STAFF AUTHENTICATION vs PUBLIC USER AUTHENTICATION: this project only
  // has staff accounts right now (Admin/Editor/Author/Reader users are all
  // provisioned by an Admin via the Users desk, not self-registered). A
  // Reader-role staff account can comment, but there is still no public
  // self-registration/login flow for ordinary site visitors — that is
  // explicitly out of scope for this phase. The session/password/role
  // architecture here is deliberately generic enough that adding public
  // registration later means adding a `POST /api/auth/register` endpoint
  // and a public-facing login form, not redesigning this auth boundary.)
  app.post(
    '/api/comments',
    requireAuth(getAuthLookup),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName, role } = req.authContext!;
      const fullUser = await prisma.user.findUnique({ where: { id: userId } });
      const body: Record<string, any> = req.body;

      if (!body.articleId || !body.content) {
        return res.status(400).json({ error: 'articleId and content are required.' });
      }

      const validationError = firstError(validateText(body.content, 'content', 2000));
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      // PHASE 3 anti-spam: rate limit (5 comments / 5 minutes per user) and
      // reject an exact duplicate of that user's own immediately-preceding
      // comment on the same article — a cheap, effective guard against
      // accidental double-submits and simple repeat-spam scripts, without
      // needing an external anti-bot service.
      const commentRateLimit = checkCommentRateLimit(userId);
      if (commentRateLimit.limited) {
        res.setHeader('Retry-After', String(commentRateLimit.retryAfterSeconds));
        return res.status(429).json({ error: 'You are posting comments too quickly. Please wait a moment and try again.' });
      }

      const article = await prisma.article.findUnique({ where: { id: body.articleId } });
      if (!article) {
        return res.status(404).json({ error: 'Article not found.' });
      }

      const trimmedContent = body.content.trim();
      const recentDuplicate = await prisma.comment.findFirst({
        where: { articleId: body.articleId, userId, content: trimmedContent },
        orderBy: { createdAt: 'desc' },
      });
      if (recentDuplicate) {
        return res.status(409).json({ error: 'You have already posted this exact comment on this article.' });
      }

      recordComment(userId);

      const newComment = await prisma.comment.create({
        data: {
          id: `comm-${Date.now()}`,
          articleId: body.articleId,
          userId,
          userName,
          userRole: role,
          userAvatar: fullUser?.avatar,
          content: trimmedContent,
          createdAt: new Date(),
          // Auto-approve if posted by staff; otherwise hold for moderation
          status: ['Admin', 'Editor'].includes(role) ? 'approved' : 'pending',
        },
      });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Submitted Comment',
          entityType: 'Comment',
          entityId: newComment.id,
          timestamp: new Date(),
          details: `Comment submitted for article ${newComment.articleId} (status: ${newComment.status}).`,
        },
      });

      return res.status(201).json(newComment);
    })
  );

  app.put(
    '/api/comments/:id',
    requireRole(getAuthLookup, ['Admin', 'Editor']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const existing = await prisma.comment.findUnique({ where: { id: req.params.id } });

      if (!existing) {
        return res.status(404).json({ error: 'Comment not found.' });
      }

      const updated = await prisma.comment.update({ where: { id: existing.id }, data: req.body });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Moderated Comment',
          entityType: 'Comment',
          entityId: req.params.id,
          timestamp: new Date(),
          details: `Comment ${req.params.id} updated to status '${updated.status}' by ${userName}.`,
        },
      });

      return res.json(updated);
    })
  );

  app.delete(
    '/api/comments/:id',
    requireRole(getAuthLookup, ['Admin', 'Editor']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;

      const existing = await prisma.comment.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        return res.status(404).json({ error: 'Comment not found.' });
      }

      await prisma.comment.delete({ where: { id: req.params.id } });
      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Deleted Comment',
          entityType: 'Comment',
          entityId: req.params.id,
          timestamp: new Date(),
          details: `Comment ${req.params.id} deleted by ${userName}.`,
        },
      });

      return res.json({ success: true, id: req.params.id });
    })
  );

  // Redirects API (Admin Only)
  app.post(
    '/api/redirects',
    requireRole(getAuthLookup, ['Admin']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const body: Record<string, any> = req.body;

      if (!body.sourceUrl || !body.targetUrl) {
        return res.status(400).json({ error: 'sourceUrl and targetUrl are required.' });
      }

      if (body.sourceUrl === body.targetUrl) {
        return res.status(400).json({ error: 'Source URL and Target URL cannot be identical.' });
      }

      const redirectValidationError = firstError(
        validateRedirectSource(body.sourceUrl, 'sourceUrl'),
        validateSafeUrl(body.targetUrl, 'targetUrl')
      );
      if (redirectValidationError) {
        return res.status(400).json({ error: redirectValidationError });
      }

      const newRule = await prisma.redirectRule.create({
        data: {
          id: `redir-${Date.now()}`,
          sourceUrl: body.sourceUrl.trim(),
          targetUrl: body.targetUrl.trim(),
          statusCode: body.statusCode === 302 ? 302 : 301,
          createdAt: new Date(),
          isActive: body.isActive !== false,
        },
      });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Created Redirect Rule',
          entityType: 'Redirect',
          entityId: newRule.id,
          timestamp: new Date(),
          details: `Admin ${userName} created ${newRule.statusCode} redirect: ${newRule.sourceUrl} -> ${newRule.targetUrl}.`,
        },
      });

      return res.status(201).json(newRule);
    })
  );

  app.put(
    '/api/redirects/:id',
    requireRole(getAuthLookup, ['Admin']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const existing = await prisma.redirectRule.findUnique({ where: { id: req.params.id } });

      if (!existing) {
        return res.status(404).json({ error: 'Redirect rule not found.' });
      }

      const redirectUpdates: Record<string, any> = req.body;
      const redirectUpdateError = firstError(
        redirectUpdates.sourceUrl !== undefined ? validateRedirectSource(redirectUpdates.sourceUrl, 'sourceUrl') : { valid: true },
        redirectUpdates.targetUrl !== undefined ? validateSafeUrl(redirectUpdates.targetUrl, 'targetUrl') : { valid: true }
      );
      if (redirectUpdateError) {
        return res.status(400).json({ error: redirectUpdateError });
      }

      const updated = await prisma.redirectRule.update({ where: { id: existing.id }, data: redirectUpdates });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Updated Redirect Rule',
          entityType: 'Redirect',
          entityId: req.params.id,
          timestamp: new Date(),
          details: `Admin ${userName} updated redirect rule ${req.params.id}.`,
        },
      });

      return res.json(updated);
    })
  );

  app.delete(
    '/api/redirects/:id',
    requireRole(getAuthLookup, ['Admin']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;

      const existing = await prisma.redirectRule.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        return res.status(404).json({ error: 'Redirect rule not found.' });
      }

      await prisma.redirectRule.delete({ where: { id: req.params.id } });
      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Deleted Redirect Rule',
          entityType: 'Redirect',
          entityId: req.params.id,
          timestamp: new Date(),
          details: `Admin ${userName} deleted redirect rule ${req.params.id}.`,
        },
      });

      return res.json({ success: true, id: req.params.id });
    })
  );

  // Authors & Users API
  app.post(
    '/api/authors',
    requireRole(getAuthLookup, ['Admin', 'Editor']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const body: Record<string, any> = req.body;

      if (!body.name || !body.slug) {
        return res.status(400).json({ error: 'Author name and slug are required.' });
      }

      const authorValidationError = firstError(
        validateText(body.name, 'name', 150),
        validateSlug(body.slug, 'slug'),
        validateText(body.roleTitle, 'roleTitle', 150, false),
        validateText(body.bio, 'bio', 3000, false),
        validateSafeUrl(body.avatar, 'avatar', { required: false }),
        validateText(body.twitter, 'twitter', 100, false),
        validateText(body.email, 'email', 200, false)
      );
      if (authorValidationError) {
        return res.status(400).json({ error: authorValidationError });
      }

      const existing = await prisma.author.findUnique({ where: { slug: body.slug } });
      if (existing) {
        return res.status(409).json({ error: `Author slug '${body.slug}' already exists.` });
      }

      const newAuthor = await prisma.author.create({
        data: {
          id: `auth-${Date.now()}`,
          slug: body.slug,
          name: body.name,
          roleTitle: body.roleTitle || 'Sports Journalist',
          bio: body.bio || '',
          avatar: body.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&h=200&q=80',
          twitter: body.twitter,
          email: body.email,
          articleCount: 0,
        },
      });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Created Author Profile',
          entityType: 'Author',
          entityId: newAuthor.id,
          timestamp: new Date(),
          details: `Created author ${newAuthor.name} (${newAuthor.slug}).`,
        },
      });

      return res.status(201).json(newAuthor);
    })
  );

  app.put(
    '/api/authors/:id',
    requireRole(getAuthLookup, ['Admin', 'Editor']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const existing = await prisma.author.findUnique({ where: { id: req.params.id } });

      if (!existing) {
        return res.status(404).json({ error: 'Author not found.' });
      }

      const updated = await prisma.author.update({ where: { id: existing.id }, data: req.body });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Updated Author Profile',
          entityType: 'Author',
          entityId: req.params.id,
          timestamp: new Date(),
          details: `Updated author profile ${updated.name}.`,
        },
      });

      return res.json(updated);
    })
  );

  app.put(
    '/api/users/:id/role',
    requireRole(getAuthLookup, ['Admin']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const target = await prisma.user.findUnique({ where: { id: req.params.id } });

      if (!target) {
        return res.status(404).json({ error: 'User not found.' });
      }

      const { role } = req.body;
      if (!['Admin', 'Editor', 'Author', 'Reader'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role specified.' });
      }

      if (target.role === 'Admin' && role !== 'Admin' && (await isLastActiveAdmin(target.id))) {
        return res.status(400).json({ error: `Cannot change ${target.name}'s role: they are the last active Admin. Promote another user to Admin first.` });
      }

      const oldRole = target.role;
      const updated = await prisma.user.update({ where: { id: target.id }, data: { role } });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Changed User Role',
          entityType: 'User',
          entityId: target.id,
          timestamp: new Date(),
          details: `Admin ${userName} changed user ${target.name}'s role from ${oldRole} to ${role}.`,
        },
      });

      return res.json(sanitizeUser(updated));
    })
  );

  // Staff User Management (Admin Only) — PHASE 1: replaces the Phase-0
  // client-side-only "Add Staff User" mock with real, persisted CRUD.
  app.post(
    '/api/users',
    requireRole(getAuthLookup, ['Admin']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const body: { name?: string; email?: string; role?: Role; password?: string } = req.body;

      // PHASE 3: a generous sanity ceiling (20/hour) on staff-account
      // creation per acting Admin — not a hard security boundary (Admins
      // already have full privileges), just an abuse-shape guard against a
      // runaway script or a compromised Admin session mass-creating accounts.
      const staffCreationRateLimit = checkStaffCreationRateLimit(userId);
      if (staffCreationRateLimit.limited) {
        res.setHeader('Retry-After', String(staffCreationRateLimit.retryAfterSeconds));
        return res.status(429).json({ error: 'Too many staff accounts created recently. Please try again later.' });
      }

      if (!body.name || !body.email || !body.role || !body.password) {
        return res.status(400).json({ error: 'name, email, role, and password are required.' });
      }

      const staffValidationError = firstError(
        validateText(body.name, 'name', 150),
        validateEmail(body.email, 'email'),
        validatePasswordStrength(body.password)
      );
      if (staffValidationError) {
        return res.status(400).json({ error: staffValidationError });
      }
      if (!['Admin', 'Editor', 'Author', 'Reader'].includes(body.role)) {
        return res.status(400).json({ error: 'Invalid role specified.' });
      }

      const existing = await prisma.user.findUnique({ where: { email: body.email.trim().toLowerCase() } });
      if (existing) {
        return res.status(409).json({ error: `A user with email '${body.email}' already exists.` });
      }

      const now = new Date();
      const newUser = await prisma.user.create({
        data: {
          id: `user-${Date.now()}`,
          name: body.name.trim(),
          email: body.email.trim().toLowerCase(),
          role: body.role,
          avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&h=120&q=80',
          joinedAt: now,
          updatedAt: now,
          status: 'active',
          passwordHash: hashPassword(body.password),
        },
      });

      recordStaffCreation(userId);

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Created Staff User',
          entityType: 'User',
          entityId: newUser.id,
          timestamp: new Date(),
          details: `Admin ${userName} created staff account "${newUser.name}" (${newUser.role}). Password not recorded in audit log.`,
        },
      });

      return res.status(201).json(sanitizeUser(newUser));
    })
  );

  app.put(
    '/api/users/:id',
    requireRole(getAuthLookup, ['Admin']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const target = await prisma.user.findUnique({ where: { id: req.params.id } });

      if (!target) {
        return res.status(404).json({ error: 'User not found.' });
      }

      const body: { name?: string; email?: string } = req.body;
      const updateValidationError = firstError(
        validateText(body.name, 'name', 150, false),
        body.email !== undefined ? validateEmail(body.email, 'email') : { valid: true }
      );
      if (updateValidationError) {
        return res.status(400).json({ error: updateValidationError });
      }

      if (body.email) {
        const collision = await prisma.user.findFirst({
          where: { id: { not: target.id }, email: body.email.trim().toLowerCase() },
        });
        if (collision) {
          return res.status(409).json({ error: `A user with email '${body.email}' already exists.` });
        }
      }

      const updated = await prisma.user.update({
        where: { id: target.id },
        data: {
          name: body.name ? body.name.trim() : undefined,
          email: body.email ? body.email.trim().toLowerCase() : undefined,
          updatedAt: new Date(),
        },
      });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Updated Staff User',
          entityType: 'User',
          entityId: target.id,
          timestamp: new Date(),
          details: `Admin ${userName} updated staff account "${updated.name}".`,
        },
      });

      return res.json(sanitizeUser(updated));
    })
  );

  app.put(
    '/api/users/:id/status',
    requireRole(getAuthLookup, ['Admin']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const target = await prisma.user.findUnique({ where: { id: req.params.id } });

      if (!target) {
        return res.status(404).json({ error: 'User not found.' });
      }

      const { status } = req.body;
      if (status !== 'active' && status !== 'inactive') {
        return res.status(400).json({ error: "status must be 'active' or 'inactive'." });
      }

      if (status === 'inactive' && target.role === 'Admin' && (await isLastActiveAdmin(target.id))) {
        return res.status(400).json({ error: `Cannot deactivate ${target.name}: they are the last active Admin. Promote another user to Admin first.` });
      }

      const updated = await prisma.user.update({
        where: { id: target.id },
        data: { status, updatedAt: new Date() },
      });

      if (status === 'inactive') {
        // Deactivation immediately invalidates any existing sessions for this user.
        await prisma.session.deleteMany({ where: { userId: target.id } });
      }

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Changed User Status',
          entityType: 'User',
          entityId: target.id,
          timestamp: new Date(),
          details: `Admin ${userName} set "${target.name}"'s status to ${status}.`,
        },
      });

      return res.json(sanitizeUser(updated));
    })
  );

  app.delete(
    '/api/users/:id',
    requireRole(getAuthLookup, ['Admin']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const target = await prisma.user.findUnique({ where: { id: req.params.id } });

      if (!target) {
        return res.status(404).json({ error: 'User not found.' });
      }

      if (target.role === 'Admin' && (await isLastActiveAdmin(target.id))) {
        return res.status(400).json({ error: `Cannot delete ${target.name}: they are the last active Admin. Promote another user to Admin first.` });
      }

      await prisma.session.deleteMany({ where: { userId: target.id } });
      await prisma.user.delete({ where: { id: target.id } });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Deleted Staff User',
          entityType: 'User',
          entityId: req.params.id,
          timestamp: new Date(),
          details: `Admin ${userName} deleted staff account "${target.name}".`,
        },
      });

      return res.json({ success: true, id: req.params.id });
    })
  );

  // Media Library API
  app.post(
    '/api/media',
    requireRole(getAuthLookup, ['Admin', 'Editor', 'Author']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const body: Record<string, any> = req.body;

      if (!body.title || !body.url) {
        return res.status(400).json({ error: 'Title and URL are required for media.' });
      }

      const mediaValidationError = firstError(
        validateText(body.title, 'title', 200),
        validateSafeUrl(body.url, 'url'),
        validateText(body.altText, 'altText', 300, false),
        validateText(body.caption, 'caption', 500, false),
        validateText(body.credit, 'credit', 200, false),
        validateText(body.source, 'source', 200, false),
        validateText(body.license, 'license', 200, false)
      );
      if (mediaValidationError) {
        return res.status(400).json({ error: mediaValidationError });
      }

      const newItem = await prisma.mediaItem.create({
        data: {
          id: `media-${Date.now()}`,
          title: body.title,
          url: body.url,
          altText: body.altText || body.title,
          caption: body.caption || '',
          credit: body.credit || 'SportingSpy Archive',
          source: body.source || 'Original Production',
          license: body.license || 'All Editorial Rights Reserved',
          creationType: body.creationType || 'Original',
          uploadedAt: new Date(),
          dimensions: body.dimensions || '1920x1080',
        },
      });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Uploaded Media Asset',
          entityType: 'Setting',
          entityId: newItem.id,
          timestamp: new Date(),
          details: `Uploaded media: ${newItem.title}.`,
        },
      });

      return res.status(201).json(newItem);
    })
  );

  app.put(
    '/api/media/:id',
    requireRole(getAuthLookup, ['Admin', 'Editor']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const existing = await prisma.mediaItem.findUnique({ where: { id: req.params.id } });

      if (!existing) {
        return res.status(404).json({ error: 'Media item not found.' });
      }

      const updated = await prisma.mediaItem.update({ where: { id: existing.id }, data: req.body });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Updated Media Metadata',
          entityType: 'Setting',
          entityId: req.params.id,
          timestamp: new Date(),
          details: `Updated media item: ${updated.title}.`,
        },
      });

      return res.json(updated);
    })
  );

  app.delete(
    '/api/media/:id',
    requireRole(getAuthLookup, ['Admin']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;

      const existing = await prisma.mediaItem.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        return res.status(404).json({ error: 'Media item not found.' });
      }

      await prisma.mediaItem.delete({ where: { id: req.params.id } });
      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Deleted Media Asset',
          entityType: 'Setting',
          entityId: req.params.id,
          timestamp: new Date(),
          details: `Deleted media item ${req.params.id}.`,
        },
      });

      return res.json({ success: true, id: req.params.id });
    })
  );

  // Ad Slots API (Admin Only)
  app.put(
    '/api/ads/:id',
    requireRole(getAuthLookup, ['Admin']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const existing = await prisma.adSlotConfig.findUnique({ where: { id: req.params.id } });

      if (!existing) {
        return res.status(404).json({ error: 'Ad slot not found.' });
      }

      const adUpdates: Record<string, any> = req.body;
      const adValidationError = firstError(
        validateText(adUpdates.sponsorName, 'sponsorName', 150, false),
        validateText(adUpdates.bannerText, 'bannerText', 300, false),
        validateSafeUrl(adUpdates.linkUrl, 'linkUrl', { required: false })
      );
      if (adValidationError) {
        return res.status(400).json({ error: adValidationError });
      }

      const updated = await prisma.adSlotConfig.update({ where: { id: existing.id }, data: adUpdates });

      await prisma.auditLog.create({
        data: {
          id: `log-${Date.now()}`,
          userId,
          userName,
          action: 'Configured Ad Slot',
          entityType: 'Setting',
          entityId: req.params.id,
          timestamp: new Date(),
          details: `Configured ad slot ${req.params.id} (enabled: ${updated.enabled}).`,
        },
      });

      return res.json(updated);
    })
  );

  // Audit Logs API (Admin & Editor)
  app.get(
    '/api/audit-logs',
    requireRole(getAuthLookup, ['Admin', 'Editor']),
    asyncHandler(async (_req: Request, res: Response) => {
      const logs = await prisma.auditLog.findMany({ orderBy: { timestamp: 'desc' } });
      return res.json(logs);
    })
  );

  // 7. Vite Dev Server / Static Hosting Integration
  // API misses must never fall through to index.html (including non-GETs).
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  if (deployment.production) {
    app.use(express.static('dist', { index: false, dotfiles: 'deny' }));
    app.get('*', (req: Request, res: Response) => {
      if (req.path.includes('.') || /^\/(?:src|node_modules|@vite|@id|@fs)(?:\/|$)/i.test(req.path)) {
        return res.status(404).json({ error: 'Not found.' });
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.resolve('dist/index.html'));
    });
  } else {
    // Development mode: mount Vite middlewares
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // 8. Central Error Handler — PHASE 2: ensures a failed Prisma/PostgreSQL
  // query (or any other unexpected error) never leaks a stack trace,
  // connection string, or other internal detail to the client. The real
  // error is always logged server-side for diagnostics.
  // PHASE 3: production responses stay a fixed generic message; development
  // may include the error's own message (never a stack trace, never
  // DATABASE_URL/secrets) to keep local debugging useful, per the
  // dev-vs-production distinction requested this phase.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Prisma/parser errors can embed input values, including password hashes.
    // Never serialize request errors or bodies into logs or API responses.
    console.error('[SportingSpy] Request failed:', err instanceof Error ? err.name : 'UnknownError');
    if (res.headersSent) return;

    // PHASE 3: body-parser's "entity too large" (and similar well-known
    // client errors) carry their own correct 4xx status — surface that
    // instead of flattening every error to a generic 500, while still
    // never leaking the underlying message/stack in production.
    const errStatus = (err as { status?: number; statusCode?: number } | null)?.status ?? (err as { statusCode?: number } | null)?.statusCode;
    const isKnownClientError = typeof errStatus === 'number' && errStatus >= 400 && errStatus < 500;
    const status = isKnownClientError ? errStatus! : 500;
    const genericMessage = status === 413 ? 'Request body too large.' : status === 400 ? 'Malformed request.' : 'Internal server error.';

    res.status(status).json({ error: genericMessage });
  });

  const listener = app.listen(deployment.port, deployment.host, () => {
    console.log(`[SportingSpy] Server running at http://${deployment.host}:${deployment.port}`);
  });
  listener.on('error', () => { console.error('[SportingSpy] Cannot bind configured listening address.'); process.exit(1); });
  setInterval(() => {
    publishScheduledArticles().catch(() => console.error('[Scheduler] Publication failed. Check database availability.'));
  }, 30000).unref();
}

startServer().catch((err) => {
  console.error('[SportingSpy] Startup refused:', err instanceof DeploymentConfigError ? err.message : 'Database/schema or server initialization failed. Check configuration and applied migrations.');
  process.exit(1);
});
