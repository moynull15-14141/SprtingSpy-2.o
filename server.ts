/**
 * SportingSpy Full-Stack Application Server
 * Provides:
 * 1. HTTP 301/302 Server-Level Redirect Engine with loop and chain prevention.
 * 2. Real-time Scheduled Article Publication Engine.
 * 3. Dynamic XML Sitemap & Robots.txt generation with proper HTTP headers.
 * 4. Server-Side RBAC Enforcement on all mutation endpoints (Admin, Editor, Author, Reader).
 * 5. Persistent PostgreSQL Database via Prisma, with CRUD APIs. (PHASE 2 — see PROJECT_BRAIN.md)
 * 6. Next.js (App Router) server rendering for every page (PHASE B), mounted
 *    behind this server's security, CSRF, CORS and redirect middleware.
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
import next from 'next';
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { accountRouter } from './server/account';
import { rejectNestedCmsWrites } from './server/cmsFields';
import { deploymentConfig, DeploymentConfigError, enforceProductionTransport } from './server/deployment';
import { prisma } from './server/db';
import { articleReadWhere, authorWriteGuard, editorialWorkflowRouter, WorkflowError } from './server/editorialWorkflow';
import { Prisma } from './server/generated/prisma/client';
import { Role, ARTICLE_TYPES, EDITION_STATUSES, AD_PROVIDERS, UNPLACED_AD_SLOTS } from './src/types';
import { isSportIcon } from './src/config/sportIcons';

/** A sport icon must come from the curated set (or be cleared). */
const validateSportIcon = (icon: unknown) => (icon === undefined || icon === null || icon === '' || isSportIcon(icon) ? { valid: true as const } : { valid: false as const, error: 'icon must be one of the curated sport icons.' });
import { LEGACY_PAGE_REDIRECTS, canonicalPagePath, isPagePath, stripTrailingSlash } from './src/config/urls';
import { featureFlags } from './server/features';
import { resolveSessionIdentity } from './server/sessionLookup';
import { mediaRouter } from './server/media/routes';
import { adCreativesRouter } from './server/adCreatives';
import { mediaStorage } from './server/media/storage';
import { profileImageOrigins, validateProfileImageUrl } from './server/profileImage';
import { mediaUsageMap } from './server/media/service';
import { redirectRouter, redirectMovedArticle, releasePath, RedirectConflict } from './server/redirects';
import { settingsRouter } from './server/settings';
import { prepareArticleContent, syncBodyMedia } from './server/articleContent';
import { articlePath, siteOrigin } from './src/lib/paths';
import { sitemapFiles } from './server/seo/sitemap';
import { robotsTxt } from './server/seo/robots';
import { seoRouter } from './server/seo/routes';
import { searchPageRateLimit, searchRouter } from './server/services/search/routes';
import { trackingConfig } from './server/trackingConfig';
import { assertProductionLaunchSafe, LaunchGuardError } from './server/launchGuards';
import { siteExperienceRouter } from './server/siteExperienceRoutes';
import { applyDueSchedules } from './server/siteExperience';
import { ensureSeoRules } from './server/seo/engine';
import { indexNowKey, notifyIndexNow } from './server/seo/indexnow';
import { assertSafeAuthBoot, getAuthContext, requireAuth, requireRole, AuthLookup } from './server/auth';
import { validateSlug, validateText, validateSafeUrl, validateRedirectSource, validateEmail, validateOneOf, validateSeo, firstError, validateRecordList, validateIsoDate, parseScheduledFor, ARTICLE_STATUSES } from './server/validation';
import { faqRouter } from './server/faq';
import { contactRouter } from './server/contact';
import { sportEventConfigurationRouter } from './server/sportEventConfigurationRoutes';
import { parseSportEventValues, resolveSportEventConfiguration } from './server/sportEventConfiguration';
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
// PHASE R
import { recordAudit } from './server/audit';
import { cached, invalidateOnWrite, invalidatePublicCache, beginContentWrite } from './server/publicCache';
import { purgeExpiredAnalytics } from './server/analyticsRetention';
import { articleTypesRouter, allArticleTypes, validateArticleTypeForWrite } from './server/articleTypes';
import { snapshotUrls, redirectChangedUrls, moveEventLevelArticles, assertSportSlugAllowed, assertArticleSlugFree, assertEventSlugFree, UrlConflict } from './server/urlStability';
import { passwordResetRouter } from './server/passwordReset';
import { rumRouter } from './server/rum';
import { insightsRouter } from './server/insights';
import { migrationRouter } from './server/migration';
import { searchConsoleRouter, runScheduledSearchSync } from './server/searchConsole';
import { totpRouter } from './server/totp';

const SPORT_AUDIT_FIELDS = ['name', 'slug', 'tagline', 'description', 'order', 'isVisible', 'featuredEventIds', 'heroImage', 'heroMediaId', 'icon', 'seo', 'faqSchemaEnabled'] as const;
const EVENT_AUDIT_FIELDS = ['name', 'slug', 'sportSlug', 'shortName', 'alternativeNames', 'description', 'history', 'frequency', 'defaultVenue', 'defaultLocation', 'currentEditionYear', 'featured', 'isVisible', 'featuredImage', 'featuredMediaId', 'officialSourceUrl', 'eventType', 'seo', 'sportSpecificValues', 'faqSchemaEnabled'] as const;
const EDITION_AUDIT_FIELDS = ['title', 'startDate', 'endDate', 'venue', 'location', 'status', 'quickFacts', 'prizeMoneyTotal', 'defendingChampions', 'qualificationInfo', 'participantsCount', 'officialSourceUrl', 'description', 'featuredImage', 'featuredMediaId', 'seo', 'faqSchemaEnabled'] as const;
// PHASE R.1: audit field lists. Secrets (passwordHash, totpSecret, tokens) are never listed.
const USER_AUDIT_FIELDS = ['name', 'email', 'role', 'status', 'avatar'] as const;
const AUTHOR_AUDIT_FIELDS = ['slug', 'name', 'roleTitle', 'bio', 'avatar', 'twitter', 'email', 'userId'] as const;
const COMMENT_AUDIT_FIELDS = ['articleId', 'userId', 'userName', 'content', 'status'] as const;
const AD_AUDIT_FIELDS = ['name', 'placementDescription', 'enabled', 'provider', 'providerSlotId', 'sponsorName', 'bannerText', 'linkUrl', 'dimensions', 'creativeId', 'creativeAlt', 'creativeFit'] as const;
const ARTICLE_AUDIT_FIELDS = ['title', 'subtitle', 'slug', 'sportSlug', 'eventSlug', 'editionYear', 'articleType', 'excerpt', 'content', 'featuredImage', 'featuredMediaId', 'authorId', 'status', 'scheduledFor', 'publishedAt', 'featured', 'tables', 'references', 'seo', 'faqSchemaEnabled'] as const;

/** Alternative event names: one per line, trimmed, de-duplicated, at most 20. */
function normalizeAlternativeNames(value: unknown): string {
  if (typeof value !== 'string') return '';
  const seen = new Set<string>();
  return value.split(/\r?\n|,/).map((v) => v.trim().replace(/\s+/g, ' ')).filter((v) => v && v.length <= 120 && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase())).slice(0, 20).join('\n');
}

/** The Media Library item whose URL this is (entity images must be library items). */
async function mediaIdForUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  return (await prisma.mediaItem.findFirst({ where: { url: url.trim() }, orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }], select: { id: true } }))?.id ?? null;
}

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

/** PHASE P: article fields CMS lists never need (the editor fetches one article in full). */
const ARTICLE_HEAVY_FIELDS = { body: true, content: true, tables: true, references: true } as const;

/** A fixed, precomputed hash used only to give the "unknown email" login path a real scrypt computation to perform — see /api/auth/login. */
const DUMMY_HASH_FOR_TIMING_CAMOUFLAGE = hashPassword('sportingspy-dummy-timing-camouflage');


/** Never send passwordHash to the client. Always project through this before responding. */
function sanitizeUser<T extends { passwordHash: string; totpSecret?: string | null }>(user: T): Omit<T, 'passwordHash' | 'totpSecret'> & { totpEnabled?: boolean } {
  // PHASE R: the TOTP secret is as sensitive as the password hash.
  const { passwordHash, totpSecret, ...safe } = user;
  void passwordHash; void totpSecret;
  return 'totpEnabledAt' in safe ? { ...safe, totpEnabled: !!(safe as { totpEnabledAt?: Date | null }).totpEnabledAt } : safe;
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

/**
 * PHASE H: validation for the sport-specific edition details editors can now
 * manage (quick facts, defending champions, qualification, participants) and
 * the edition dates. `existing` supplies the other date on partial updates.
 */
function editionDetailChecks(body: Record<string, any>, existing?: { startDate: string | null; endDate: string | null }) {
  const start = 'startDate' in body ? body.startDate : existing?.startDate;
  const end = 'endDate' in body ? body.endDate : existing?.endDate;
  const count = body.participantsCount;
  return [
    validateIsoDate(body.startDate, 'startDate'),
    validateIsoDate(body.endDate, 'endDate'),
    start && end && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && end < start ? { valid: false, error: 'endDate cannot be before startDate.' } : { valid: true },
    validateRecordList(body.quickFacts, 'quickFacts', { label: 80, value: 300 }, 20),
    validateRecordList(body.defendingChampions, 'defendingChampions', { category: 80, name: 150 }, 20),
    validateText(body.qualificationInfo, 'qualificationInfo', 3000, false),
    validateText(body.prizeMoneyTotal, 'prizeMoneyTotal', 120, false),
    count === undefined || count === null || (Number.isInteger(count) && count >= 0 && count <= 100000) ? { valid: true } : { valid: false, error: 'participantsCount must be a whole number from 0 to 100000.' },
  ];
}

/** Missing facts stay missing; an empty form value explicitly clears a nullable field. */
const optionalFact = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const validEditionYear = (value: unknown): boolean => typeof value === 'number' && Number.isInteger(value) && value >= 1900 && value <= 2200;

/** Event/Edition images are existing Media Library assets, never arbitrary remote URLs. */
async function imageIsManaged(value: unknown): Promise<boolean> {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value !== 'string' || !value.trim()) return false;
  return (await prisma.mediaItem.findFirst({ where: { url: value.trim() }, select: { id: true } })) !== null;
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

  let published = 0;
  for (const art of due) {
    // PHASE H: conditional update, so overlapping ticks (timer, sitemap, CMS
    // load) or a concurrent reschedule/cancel never publish or log twice.
    // PHASE R.1: the public cache is bypassed while the row changes and cleared
    // afterwards, so the article is public the moment its row says so.
    const endWrite = beginContentWrite('scheduled publication');
    let result;
    try {
      result = await prisma.article.updateMany({
        where: { id: art.id, status: 'scheduled', scheduledFor: art.scheduledFor },
        // PHASE D: publishing is not a content change, so updatedAt is left alone.
        data: { status: 'published', publishedAt: art.scheduledFor || now },
      });
    } finally {
      endWrite();
    }
    if (!result.count) continue;
    published++;
    notifyIndexNow(siteOrigin(), [articlePath(art)], 'scheduled article published');
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

  if (published > 0) {
    console.log(`[Scheduler] Auto-published ${published} scheduled article(s).`);
  }
  return published;
}

async function startServer() {
  const deployment = deploymentConfig();
  // Keep image URL validation and the CSP in sync before accepting traffic.
  profileImageOrigins();
  const features = featureFlags();
  // Fail fast on a misconfigured media storage provider (with a readable reason).
  let storage: ReturnType<typeof mediaStorage>;
  try { storage = mediaStorage(); } catch (err) { throw new DeploymentConfigError(err instanceof Error ? err.message : 'Media storage is misconfigured.'); }
  // PHASE D: make sure every SEO rule has a stored, editable settings row.
  await ensureSeoRules();
  const allowedRoles: Role[] = features.readerAccounts ? ['Admin', 'Editor', 'Author', 'Reader'] : ['Admin', 'Editor', 'Author'];
  assertSafeAuthBoot();
  // Read-only connection/schema check. Startup never runs migrations or imports.
  await Promise.all([prisma.user.count(), prisma.faqEntry.count(), prisma.contactMessage.count(), prisma.article.findFirst({ select: { reviewStatus: true, reviewVersion: true } })]);
  // PHASE G: a real production site must not start with documented default passwords.
  await assertProductionLaunchSafe(deployment);
  const app = express();
  let stopping = false;
  app.disable('x-powered-by');
  // PHASE G: every response carries a request ID; error logs and error
  // responses quote it so a visitor's report can be matched to a log line.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = crypto.randomUUID();
    (req as Request & { requestId?: string }).requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  });
  app.set('trust proxy', deployment.trustProxy);

  // PHASE 3 hardening — order matters here:
  //   CORS decision -> security headers -> body parsing (size-limited) ->
  //   CSRF cookie issuance -> CSRF enforcement -> everything else.
  // PHASE F: the CSP needs the configured providers synchronously; load them once before serving.
  await trackingConfig().catch(() => undefined);
  app.use(securityHeaders);
  // PHASE J: nothing served by a staging copy may be indexed.
  if (deployment.appEnv === 'staging') app.use((_req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(enforceProductionTransport);
  app.use(corsPolicy);
  // Liveness: the process is up and serving (no dependency checks).
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  // PHASE G readiness: can this instance actually serve traffic? Checks the
  // database (SELECT 1, 2 s timeout) and that media storage is writable.
  // Reports only ok/fail per dependency — never hosts, URLs or error text.
  app.get('/api/health/ready', async (_req, res) => {
    if (stopping) return res.status(503).json({ status: 'not_ready', checks: { database: 'fail', storage: 'fail' } });
    const withTimeout = async <T,>(p: Promise<T>) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 2000); })]); }
      finally { if (timer) clearTimeout(timer); }
    };
    const [database, storageCheck] = await Promise.all([
      withTimeout(prisma.$queryRaw`SELECT 1`).then(() => 'ok' as const, () => 'fail' as const),
      // PHASE J: each storage provider checks itself (local: writable dir; S3: bucket reachable).
      withTimeout(storage.healthCheck()).then(() => 'ok' as const, () => 'fail' as const),
    ]);
    const ready = database === 'ok' && storageCheck === 'ok';
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks: { database, storage: storageCheck } });
  });
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
  // PHASE R: every successful CMS write invalidates the public data cache.
  app.use(invalidateOnWrite);
  // Draft previews are staff-only, uncached and excluded from indexing.
  // The preference cookie alone grants no access; Next resolves the active session.
  app.use((req, res, next) => {
    if (/(?:^|;\s*)sportingspy_site_preview=1(?:;|$)/.test(req.headers.cookie ?? '')) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }
    next();
  });
  app.use(rejectNestedCmsWrites);

  // 1. Page URL policy + HTTP 301/302 Redirect Engine
  // PHASE A: public page URLs are canonical WITH a trailing slash (Spec
  // v1.1 §10). For GET/HEAD page requests, in order:
  //   a. legacy static URLs (/privacy, /terms) -> 301 to their spec URL
  //   b. editor-managed redirect rules -> their target
  //   c. a page path missing its trailing slash -> 301 to the slash form
  // Every target is canonicalized first, so each request resolves in a
  // single hop. API routes, files (sitemap.xml, robots.txt, assets) and
  // non-GET methods are never touched.
  app.use(
    asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || !isPagePath(req.path)) {
        return next();
      }

      const queryIndex = req.url.indexOf('?');
      const queryString = queryIndex !== -1 ? req.url.slice(queryIndex) : '';
      const cleanPath = stripTrailingSlash(req.path);

      const legacyTarget = LEGACY_PAGE_REDIRECTS[cleanPath];
      if (legacyTarget) {
        return res.redirect(301, legacyTarget + queryString);
      }

      const rule = await prisma.redirectRule.findFirst({ where: { isActive: true, sourceUrl: cleanPath } });
      if (!rule) {
        if (!req.path.endsWith('/')) {
          return res.redirect(301, canonicalPagePath(req.path) + queryString);
        }
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

      // Preserve query parameters; canonicalize internal targets so the
      // trailing-slash rule never adds a second hop.
      const finalDestination = canonicalPagePath(currentDest) + queryString;

      // PHASE P: path only — query strings (tracking or personal data) are never logged.
      console.log(`[Redirect Engine] Serving HTTP ${rule.statusCode} from ${cleanPath} -> ${canonicalPagePath(currentDest)}`);
      return res.redirect(rule.statusCode, finalDestination);
    })
  );

  // 2. XML sitemaps + robots.txt (PHASE D: server/seo/sitemap.ts, robots.ts).
  // Only indexable URLs; sitemap index with per-type child sitemaps.
  const seoOrigin = () => deployment.origin || siteOrigin();
  const sendXml = (res: Response, xml: string) => {
    res.header('Content-Type', 'application/xml; charset=utf-8');
    res.header('Cache-Control', 'public, max-age=900');
    return res.send(xml);
  };
  // PHASE P: the index and every child file are built from one site-index
  // pass, kept in the public data cache (cleared by every content write and
  // after its TTL), instead of a full rebuild per crawler request.
  const cachedSitemapFiles = cached('sitemapFiles', (origin: string) => sitemapFiles(origin));
  app.get('/sitemap.xml', asyncHandler(async (_req: Request, res: Response) => {
    await publishScheduledArticles();
    return sendXml(res, (await cachedSitemapFiles(seoOrigin())).index);
  }));
  app.get('/sitemaps/:file', asyncHandler(async (req: Request, res: Response) => {
    const xml = (await cachedSitemapFiles(seoOrigin())).files.get(req.params.file);
    return xml ? sendXml(res, xml) : res.status(404).json({ error: 'Not found.' });
  }));
  app.get('/robots.txt', (_req: Request, res: Response) => {
    res.header('Content-Type', 'text/plain; charset=utf-8');
    return res.send(robotsTxt(seoOrigin(), deployment.appEnv));
  });
  // IndexNow key file (only when a key is configured).
  app.get(/^\/([A-Za-z0-9-]{8,128})\.txt$/, asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const key = await indexNowKey();
    if (!key || req.params[0] !== key) return next();
    res.header('Content-Type', 'text/plain; charset=utf-8');
    return res.send(key);
  }));

  // 4. Server-Side Authorization Boundary
  // PHASE 2: identity resolution is now two targeted Prisma queries (see
  // server/auth.ts's AuthLookup interface) instead of loading the whole
  // users/sessions JSON arrays into memory on every request.
  const authLookup: AuthLookup = {
    // PHASE C: shared with the Next.js staff preview (server/sessionLookup.ts).
    // Reader sessions do not authenticate while reader accounts are disabled.
    resolveSession: resolveSessionIdentity,
    async resolveBypassUser(userId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || !allowedRoles.includes(user.role)) return null;
      return { userId: user.id, userName: user.name, role: user.role };
    },
  };
  const getAuthLookup = () => authLookup;

  // 5. Authentication Endpoints
  app.post(
    '/api/auth/login',
    asyncHandler(async (req: Request, res: Response) => {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const { email, password, totpCode } = req.body as { email?: string; password?: string; totpCode?: unknown };

      if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
        return res.status(400).json({ error: 'email and password are required.' });
      }
      if (totpCode !== undefined && (typeof totpCode !== 'string' || !/^\d{6}$/.test(totpCode.trim()))) {
        return res.status(400).json({ error: 'The authentication code must be 6 digits.' });
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
      // PHASE A: a disabled role (Reader, while reader accounts are off)
      // fails exactly like a wrong password — no new account-state oracle.
      const isActive = user ? user.status === 'active' && allowedRoles.includes(user.role) : false;

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

      // PHASE R: second factor. Asked for only after the password is correct;
      // a wrong code counts as a failed attempt for rate limiting.
      if (user.totpEnabledAt && user.totpSecret) {
        const { verifyTotpForUser } = await import('./server/totp');
        if (typeof totpCode !== 'string') return res.status(401).json({ error: 'Enter the 6-digit code from your authenticator app.', totpRequired: true });
        if (!(await verifyTotpForUser(user.id, user.totpSecret, totpCode.trim()))) {
          recordFailedLogin(ip, email);
          await recordAudit(prisma, { userId: user.id, userName: user.name, action: 'Login Failed', entityType: 'User', entityId: user.id, details: `Wrong authentication code for "${email.trim()}" from ${ip}.` });
          return res.status(401).json({ error: 'The authentication code is not valid.', totpRequired: true });
        }
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

  // PHASE R: password reset is public (token-based), so it is mounted BEFORE
  // the account router, whose router-level requireAuth covers /api/auth/*.
  app.use('/api/auth', passwordResetRouter(getAuthLookup));
  app.use('/api/auth/totp', totpRouter(getAuthLookup));
  app.use('/api/auth', accountRouter(getAuthLookup));

  // 6. REST API Endpoints

  // PHASE B: the CMS dataset for /admin. This replaces the old public
  // GET /api/data, which sent the whole database to every visitor so the SPA
  // could render; public pages are now server-rendered from route-specific
  // queries (server/services/public). Staff only.
  app.get(
    '/api/cms/data',
    requireRole(getAuthLookup, ['Admin', 'Editor', 'Author']),
    asyncHandler(async (req: Request, res: Response) => {
      await publishScheduledArticles();
      const { role, userId } = req.authContext!;
      const previewAllowed = true;

      // PHASE P: media usage and Article Types load in the same parallel batch.
      const [sports, events, editions, articles, authors, users, comments, mediaItems, adSlots, auditLogs, redirectRules, mediaUsage, articleTypes] =
        await Promise.all([
          prisma.sport.findMany({ orderBy: { order: 'asc' } }),
          prisma.sportEvent.findMany(),
          prisma.eventEdition.findMany(),
          // PHASE P: the list carries no body/plain text/tables/references
          // (they were ~95 % of this payload: 317 MB at 20,000 articles). The
          // editor loads the one article it opens from GET /api/articles/:id.
          prisma.article.findMany({
            where: articleReadWhere(req.authContext!),
            orderBy: { publishedAt: 'desc' },
            omit: ARTICLE_HEAVY_FIELDS,
          }),
          prisma.author.findMany(),
          role === 'Admin' ? prisma.user.findMany() : Promise.resolve([]),
          features.comments
            ? prisma.comment.findMany({ where: ['Admin', 'Editor'].includes(role) ? undefined : { OR: [{ status: 'approved' }, { userId }] }, orderBy: { createdAt: 'desc' } })
            : Promise.resolve([]),
          prisma.mediaItem.findMany({ orderBy: { uploadedAt: 'desc' } }),
          prisma.adSlotConfig.findMany({ include: { creative: true } }),
          // PHASE R: bounded (the full log is paged through /api/audit-logs).
          ['Admin', 'Editor'].includes(role) ? prisma.auditLog.findMany({ orderBy: { timestamp: 'desc' }, take: 500 }) : Promise.resolve([]),
          prisma.redirectRule.findMany({ orderBy: { createdAt: 'desc' } }),
          mediaUsageMap(role === 'Author' ? {articleWhere: articleReadWhere(req.authContext!), publicSiteOnly: true} : {}),
          allArticleTypes(),
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
        features,
        mediaUsage,
        // PHASE R: database-backed Article Types (active and inactive).
        articleTypes,
      });
    })
  );

  // Articles API
  // PHASE H: staff only. Spec §2.2 has no public API at launch; public pages
  // are server-rendered from server/services/public and never call this.
  app.get(
    '/api/articles',
    requireRole(getAuthLookup, ['Admin', 'Editor', 'Author']),
    asyncHandler(async (req: Request, res: Response) => {
      await publishScheduledArticles();
      const { role } = req.authContext!;
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

      const where: Record<string, unknown> = articleReadWhere(req.authContext!);
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
      const list = await prisma.article.findMany({ where, orderBy: { publishedAt: 'desc' }, take: 500, omit: ARTICLE_HEAVY_FIELDS });
      return res.json(list);
    })
  );

  app.post(
    '/api/articles',
    requireRole(getAuthLookup, ['Admin', 'Editor', 'Author']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName, role } = req.authContext!;
      const body: Record<string, any> = req.body;

      const authorizedByline = await authorWriteGuard(req.authContext!, body);

      if (!body.title || !body.sportSlug || (!body.content && !body.body)) {
        return res.status(400).json({ error: 'Missing required article fields: title, sportSlug, body.' });
      }

      const slug = body.slug || (typeof body.title === 'string' ? body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') : '');

      const validationError = firstError(
        validateText(body.title, 'title', 300),
        body.body ? { valid: true } : validateText(body.content, 'content', 200000),
        validateSlug(body.sportSlug, 'sportSlug'),
        validateSlug(slug, 'slug'),
        validateText(body.subtitle, 'subtitle', 300, false),
        validateText(body.excerpt, 'excerpt', 1000, false),
        validateSafeUrl(body.featuredImage, 'featuredImage', { required: false }),
        validateOneOf(body.status, 'status', ARTICLE_STATUSES),
        validateRecordList(body.references, 'references', { title: 200, url: 2048 }, 30),
        validateSeo(body.seo),
        body.faqSchemaEnabled === undefined || typeof body.faqSchemaEnabled === 'boolean' ? { valid: true } : { valid: false, error: 'faqSchemaEnabled must be true or false.' }
      );
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }
      // PHASE R: Article Types come from the database (active types only for new content).
      if (body.articleType === undefined) body.articleType = 'Event Guide';
      const typeError = await validateArticleTypeForWrite(body.articleType);
      if (typeError) return res.status(400).json({ error: typeError });
      // PHASE H: a scheduled article needs a future publication time; any
      // other status never carries one.
      let scheduledFor: Date | null = null;
      if (body.status === 'scheduled') {
        const schedule = parseScheduledFor(body.scheduledFor);
        if (!schedule.ok) return res.status(400).json({ error: (schedule as { error: string }).error });
        scheduledFor = schedule.date;
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
      // PHASE R collision rule: an event-less article may not take an event's URL.
      try { await assertArticleSlugFree(prisma, { sportSlug: body.sportSlug, eventSlug, editionYear, slug }); }
      catch (err) { if (err instanceof UrlConflict) return res.status(err.status).json({ error: err.message }); throw err; }

      // PHASE 1: Article.authorId references an Author profile's id, not a
      // User's id — these are different namespaces (e.g. 'auth-elena' vs
      // 'user-editor-1'). Default to the Author profile linked to the
      // acting user's account (via Author.userId).
      let authorId: string | undefined = role === 'Author' ? authorizedByline : body.authorId;
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

      const prepared = await prepareArticleContent(body);
      if ('error' in prepared) {
        return res.status(400).json({ error: prepared.error });
      }

      const now = new Date();
      const newArticle = await prisma.$transaction(async (tx) => {
        const created = await tx.article.create({
        data: {
          id: `art-${crypto.randomUUID()}`,
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
          scheduledFor,
          status: body.status || 'draft',
          reviewStatus: role === 'Author' ? 'draft' : 'not_required',
          readingTimeMinutes: body.readingTimeMinutes || Math.max(1, Math.ceil((body.content || '').split(' ').length / 200)),
          featured: body.featured || false,
          tables: body.tables ?? undefined,
          references: body.references ?? undefined,
          seo: body.seo || { metaTitle: body.title, metaDescription: body.excerpt },
          faqSchemaEnabled: body.faqSchemaEnabled === true,
          ...prepared.data,
        },
        });
        await syncBodyMedia(tx, created.id, prepared.bodyMediaIds || []);
        // A published article must not be shadowed by an old redirect at its URL.
        if (created.status === 'published') {
          await releasePath(tx, articlePath(created), `Deactivated ${now.toISOString()}: article ${created.id} is published here.`);
        }
        return created;
      });

      await recordAudit(prisma, {
        userId, userName, action: 'Created Article', entityType: 'Article', entityId: newArticle.id,
        details: `Created article "${newArticle.title}" (status: ${newArticle.status}) by ${userName} (${role}).`,
        before: null, after: newArticle as unknown as Record<string, unknown>, fields: ARTICLE_AUDIT_FIELDS,
      });

      if (newArticle.status === 'published') notifyIndexNow(seoOrigin(), [articlePath(newArticle)], 'article published');
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

      await authorWriteGuard(req.authContext!, updates, existing);

      const validationError = firstError(
        validateText(updates.title, 'title', 300, false),
        validateText(updates.content, 'content', 200000, false),
        updates.sportSlug !== undefined ? validateSlug(updates.sportSlug, 'sportSlug') : { valid: true },
        updates.slug !== undefined ? validateSlug(updates.slug, 'slug') : { valid: true },
        validateText(updates.subtitle, 'subtitle', 300, false),
        validateText(updates.excerpt, 'excerpt', 1000, false),
        validateSafeUrl(updates.featuredImage, 'featuredImage', { required: false }),
        'status' in updates ? validateOneOf(updates.status, 'status', ARTICLE_STATUSES, true) : { valid: true },
        validateRecordList(updates.references, 'references', { title: 200, url: 2048 }, 30),
        validateSeo(updates.seo),
        updates.faqSchemaEnabled === undefined || typeof updates.faqSchemaEnabled === 'boolean' ? { valid: true } : { valid: false, error: 'faqSchemaEnabled must be true or false.' }
      );
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }
      // PHASE R: an existing article may keep its (possibly now inactive) type.
      if ('articleType' in updates) {
        const typeError = await validateArticleTypeForWrite(updates.articleType, existing.articleType);
        if (typeError) return res.status(400).json({ error: typeError });
      }
      // PHASE H scheduling: status "scheduled" requires a future time
      // (new or rescheduled); leaving "scheduled" cancels the schedule.
      const nextStatus: string = updates.status ?? existing.status;
      let nextScheduledFor: Date | null | undefined; // undefined = unchanged
      if (nextStatus === 'scheduled') {
        if ('scheduledFor' in updates || existing.status !== 'scheduled') {
          const schedule = parseScheduledFor('scheduledFor' in updates ? updates.scheduledFor : existing.scheduledFor?.toISOString());
          if (!schedule.ok) return res.status(400).json({ error: (schedule as { error: string }).error });
          nextScheduledFor = schedule.date;
        }
      } else if (existing.scheduledFor || updates.scheduledFor) {
        nextScheduledFor = null;
      }

      const prepared = await prepareArticleContent(updates);
      if ('error' in prepared) {
        return res.status(400).json({ error: prepared.error });
      }

      const { body: _body, featuredMediaId: _featuredMediaId, ...plainUpdates } = updates;
      const data: Record<string, any> = { ...plainUpdates, ...prepared.data };
      data.reviewVersion = { increment: 1 };
      // Any Author edit after approval must go through review again. Keep
      // decision context/history visible while the correction is drafted.
      if (role === 'Author' && existing.reviewStatus !== 'changes_requested') data.reviewStatus = 'draft';
      // PHASE D (Spec §30): updatedAt records meaningful content changes only —
      // not SEO-field edits, status changes or saves that change nothing.
      const CONTENT_FIELDS = ['title', 'subtitle', 'excerpt', 'content', 'body', 'tables', 'references', 'featuredMediaId', 'featuredImage', 'articleType', 'sportSlug', 'eventSlug', 'editionYear', 'slug'];
      // jsonb does not keep key order, so compare with sorted keys.
      const stable = (v: unknown): string => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable((v as Record<string, unknown>)[k])).join(',')}}` : JSON.stringify(v ?? null));
      const contentChanged = CONTENT_FIELDS.some((f) => f in data && stable(data[f]) !== stable((existing as Record<string, unknown>)[f]));
      if (contentChanged) data.updatedAt = new Date();
      if ('publishedAt' in updates) data.publishedAt = updates.publishedAt ? new Date(updates.publishedAt) : existing.publishedAt;
      else if (data.status === 'published' && existing.status !== 'published') data.publishedAt = new Date(); // first publication
      if (nextScheduledFor !== undefined) data.scheduledFor = nextScheduledFor;
      else delete data.scheduledFor;
      if ('eventSlug' in updates) data.eventSlug = updates.eventSlug ?? null;
      if ('editionYear' in updates) data.editionYear = updates.editionYear ?? null;

      // PHASE C: the public URL is derived from sport/event/edition/slug.
      const next = {
        sportSlug: data.sportSlug ?? existing.sportSlug,
        eventSlug: 'eventSlug' in data ? data.eventSlug : existing.eventSlug,
        editionYear: 'editionYear' in data ? data.editionYear : existing.editionYear,
        slug: data.slug ?? existing.slug,
      };
      const oldPath = articlePath(existing).replace(/\/$/, '');
      const newPath = articlePath(next).replace(/\/$/, '');
      if (oldPath !== newPath) {
        const collision = await prisma.article.findFirst({
          where: { id: { not: existing.id }, sportSlug: next.sportSlug, slug: next.slug, eventSlug: next.eventSlug ?? null, editionYear: next.editionYear ?? null },
        });
        if (collision) {
          return res.status(409).json({ error: `Another article already uses ${newPath}/.` });
        }
        try { await assertArticleSlugFree(prisma, next); }
        catch (err) { if (err instanceof UrlConflict) return res.status(err.status).json({ error: err.message }); throw err; }
      }

      let updated;
      try {
        updated = await prisma.$transaction(async (tx) => {
          const saved = await tx.article.update({ where: { id: existing.id, reviewVersion: existing.reviewVersion, status: existing.status, authorId: existing.authorId, ...(role === 'Author' ? { author: { userId } } : {}) }, data });
          if (role === 'Author' && existing.reviewStatus === 'approved') await tx.auditLog.create({ data: { id: `log-${crypto.randomUUID()}`, userId, userName, action: 'Invalidated Article Approval', entityType: 'Article', entityId: existing.id, timestamp: new Date(), details: `${userName} edited an approved article; a new review is required.` } });
          if (prepared.bodyMediaIds) await syncBodyMedia(tx, saved.id, prepared.bodyMediaIds);
          // A published article that moves keeps its old URL alive: old → 301 → new.
          if (existing.status === 'published' && oldPath !== newPath) {
            await redirectMovedArticle(tx, saved.id, oldPath, newPath);
          } else if (saved.status === 'published') {
            await releasePath(tx, newPath, `Deactivated ${new Date().toISOString()}: article ${saved.id} is published here.`);
          }
          return saved;
        });
      } catch (err) {
        if (err instanceof RedirectConflict) return res.status(409).json({ error: `URL change blocked: ${err.message}` });
        if ((err as {code?:string}).code === 'P2025') return res.status(409).json({error:'The article changed. Reload before saving again.'});
        throw err;
      }

      // IndexNow: publish / unpublish / URL move / meaningful change of a public article.
      const wasLive = existing.status === 'published';
      const isLive = updated.status === 'published';
      if (wasLive || isLive) {
        const changed = oldPath !== newPath ? [oldPath, newPath] : wasLive !== isLive || contentChanged ? [newPath] : [];
        notifyIndexNow(seoOrigin(), changed, wasLive && !isLive ? 'article unpublished' : !wasLive && isLive ? 'article published' : oldPath !== newPath ? 'article URL changed' : 'article content changed');
      }

      const publishedNow = existing.status !== 'published' && updated.status === 'published';
      await recordAudit(prisma, {
        userId, userName, action: publishedNow ? 'Published Article' : 'Updated Article', entityType: 'Article', entityId: updated.id,
        details: `Updated article "${updated.title}" (status: ${updated.status}${updated.scheduledFor ? `, publishes ${updated.scheduledFor.toISOString()}` : existing.status === 'scheduled' && updated.status !== 'scheduled' ? ', schedule cancelled' : ''}) by ${userName}.`,
        before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, fields: ARTICLE_AUDIT_FIELDS,
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

      // PHASE R: article-scoped FAQ entries are editorial content; never drop them silently.
      const faqCount = await prisma.faqEntry.count({ where: { articleId: target.id } });
      if (faqCount > 0) return res.status(400).json({ error: `This article has ${faqCount} FAQ ${faqCount === 1 ? 'entry' : 'entries'}. Move or delete them in FAQ first.` });
      await prisma.article.delete({ where: { id: target.id } });
      if (target.status === 'published') notifyIndexNow(seoOrigin(), [articlePath(target)], 'article deleted');
      await recordAudit(prisma, {
        userId, userName, action: 'Deleted Article', entityType: 'Article', entityId: req.params.id,
        details: `Deleted article "${target.title}" by ${userName}.`,
        before: target as unknown as Record<string, unknown>, after: null, fields: ARTICLE_AUDIT_FIELDS,
      });

      return res.json({ success: true, id: req.params.id });
    })
  );

  // Sports API (Admin Only)
  // PHASE R: shared validation; images must be Media Library items; featured
  // events must belong to the sport; SEO is merged (never wiped by a partial save).
  async function sportPayloadError(body: Record<string, any>, sportSlug: string | null): Promise<string | null> {
    const error = firstError(
      'name' in body ? validateText(body.name, 'name', 200) : { valid: true },
      body.slug !== undefined ? validateSlug(body.slug, 'slug') : { valid: true },
      validateText(body.tagline, 'tagline', 300, false),
      validateText(body.description, 'description', 5000, false),
      validateSafeUrl(body.heroImage, 'heroImage', { required: false }),
      validateSportIcon(body.icon),
      validateSeo(body.seo),
      body.order === undefined || (Number.isInteger(body.order) && body.order >= 0 && body.order <= 10000) ? { valid: true } : { valid: false, error: 'order must be a whole number from 0 to 10000.' },
      body.isVisible === undefined || typeof body.isVisible === 'boolean' ? { valid: true } : { valid: false, error: 'isVisible must be true or false.' },
      body.faqSchemaEnabled === undefined || typeof body.faqSchemaEnabled === 'boolean' ? { valid: true } : { valid: false, error: 'faqSchemaEnabled must be true or false.' },
      body.featuredEventIds === undefined || (Array.isArray(body.featuredEventIds) && body.featuredEventIds.length <= 12 && body.featuredEventIds.every((id: unknown) => typeof id === 'string' && id.length <= 200) && new Set(body.featuredEventIds).size === body.featuredEventIds.length)
        ? { valid: true } : { valid: false, error: 'featuredEventIds must be a list of at most 12 unique Event ids.' },
    );
    if (error) return error;
    if (body.slug !== undefined) {
      try { assertSportSlugAllowed(body.slug); } catch (err) { if (err instanceof UrlConflict) return err.message; throw err; }
    }
    if ('heroImage' in body && !(await imageIsManaged(body.heroImage))) return 'heroImage must reference a Media Library item.';
    if (Array.isArray(body.featuredEventIds) && body.featuredEventIds.length) {
      const found = sportSlug ? await prisma.sportEvent.count({ where: { id: { in: body.featuredEventIds }, sportSlug } }) : 0;
      if (found !== body.featuredEventIds.length) return 'featuredEventIds must be Events of this sport.';
    }
    return null;
  }

  app.post(
    '/api/sports',
    requireRole(getAuthLookup, ['Admin']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName } = req.authContext!;
      const body: Record<string, any> = req.body;

      if (!body.name || !body.slug) {
        return res.status(400).json({ error: 'Sport name and slug are required.' });
      }
      if (Array.isArray(body.featuredEventIds) && body.featuredEventIds.length) return res.status(400).json({ error: 'Create the sport first, then choose its featured events.' });
      const validationError = await sportPayloadError({ ...body, featuredEventIds: undefined }, null);
      if (validationError) return res.status(400).json({ error: validationError });

      const existing = await prisma.sport.findUnique({ where: { slug: body.slug } });
      if (existing) {
        return res.status(409).json({ error: `Sport slug '${body.slug}' already exists.` });
      }

      const sportCount = await prisma.sport.count();
      const heroImage = typeof body.heroImage === 'string' && body.heroImage.trim() ? body.heroImage.trim() : null;
      const heroMediaId = await mediaIdForUrl(heroImage);
      const newSport = await prisma.$transaction(async (tx) => {
        const created = await tx.sport.create({
          data: {
            id: `sport-${body.slug}-${Date.now()}`,
            slug: body.slug,
            name: body.name,
            tagline: body.tagline || '',
            description: body.description || '',
            order: body.order || sportCount + 1,
            isVisible: body.isVisible !== false,
            featuredEventIds: [],
            heroImage,
            heroMediaId,
            icon: body.icon || null,
            faqSchemaEnabled: body.faqSchemaEnabled === true,
            seo: body.seo || { metaTitle: `${body.name} Coverage | SportingSpy`, metaDescription: body.description },
          },
        });
        await recordAudit(tx, { userId, userName, action: 'Created Sport', entityType: 'Sport', entityId: created.id, details: `Admin ${userName} created sport ${created.name}.`, before: null, after: created as unknown as Record<string, unknown>, fields: SPORT_AUDIT_FIELDS });
        return created;
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

      const sportUpdates: Record<string, any> = { ...req.body };
      if (sportUpdates.icon === '') sportUpdates.icon = null;
      const sportUpdateError = await sportPayloadError(sportUpdates, existing.slug);
      if (sportUpdateError) return res.status(400).json({ error: sportUpdateError });

      const data: Record<string, any> = {};
      for (const key of ['name', 'slug', 'tagline', 'description', 'order', 'isVisible', 'featuredEventIds', 'colorTheme', 'icon', 'faqSchemaEnabled'] as const) if (key in sportUpdates) data[key] = sportUpdates[key];
      if ('heroImage' in sportUpdates) {
        data.heroImage = typeof sportUpdates.heroImage === 'string' && sportUpdates.heroImage.trim() ? sportUpdates.heroImage.trim() : null;
        data.heroMediaId = await mediaIdForUrl(data.heroImage);
      }
      // SEO/social metadata is merged so a form that edits some fields never wipes the others.
      if ('seo' in sportUpdates) data.seo = { ...((existing.seo as Record<string, unknown>) || {}), ...(sportUpdates.seo || {}) };
      const slugChanging = typeof data.slug === 'string' && data.slug !== existing.slug;
      if (slugChanging && (await prisma.sport.findUnique({ where: { slug: data.slug } }))) return res.status(409).json({ error: `Sport slug '${data.slug}' already exists.` });

      let moves: { from: string; to: string }[] = [];
      let updated;
      try {
        updated = await prisma.$transaction(async (tx) => {
          // PHASE R (Spec §13.2): a slug change moves every URL under the sport — record them first.
          const before = slugChanging ? await snapshotUrls(tx, { sportSlug: existing.slug }) : null;
          const saved = await tx.sport.update({ where: { id: existing.id }, data });
          if (before) moves = await redirectChangedUrls(tx, before, `sport slug ${existing.slug} → ${saved.slug}`);
          await recordAudit(tx, {
            userId, userName, action: 'Updated Sport', entityType: 'Sport', entityId: existing.id,
            details: `Admin ${userName} updated sport ${saved.name}.${moves.length ? ` ${moves.length} URL(s) moved with 301 redirects.` : ''}`,
            before: existing as unknown as Record<string, unknown>, after: saved as unknown as Record<string, unknown>, fields: SPORT_AUDIT_FIELDS,
          });
          return saved;
        }, { timeout: 60_000 });
      } catch (err) {
        if (err instanceof RedirectConflict) return res.status(409).json({ error: `Slug change blocked: ${err.message}` });
        throw err;
      }
      if (moves.length) notifyIndexNow(seoOrigin(), moves.flatMap((m) => [m.from, m.to]), 'sport URL changed');

      return res.json({ ...updated, movedUrls: moves.length });
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
      const sportFaqs = await prisma.faqEntry.count({ where: { sportId: sport.id } });
      if (sportFaqs > 0) return res.status(400).json({ error: `Cannot delete sport '${sport.name}': it has ${sportFaqs} FAQ ${sportFaqs === 1 ? 'entry' : 'entries'}. Move or delete them in FAQ first.` });

      await prisma.sport.delete({ where: { id: sport.id } });
      await recordAudit(prisma, { userId, userName, action: 'Deleted Sport', entityType: 'Sport', entityId: req.params.id, details: `Admin ${userName} deleted sport ${sport.name}.`, before: sport as unknown as Record<string, unknown>, after: null, fields: SPORT_AUDIT_FIELDS });

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
        validateText(body.shortName, 'shortName', 200, false),
        validateText(body.description, 'description', 5000, false),
        validateText(body.history, 'history', 10000, false),
        validateText(body.frequency, 'frequency', 200, false),
        validateText(body.defaultVenue, 'defaultVenue', 200, false),
        validateText(body.defaultLocation, 'defaultLocation', 200, false),
        validateSafeUrl(body.featuredImage, 'featuredImage', { required: false }),
        validateSafeUrl(body.officialSourceUrl, 'officialSourceUrl', { required: false, allowRelative: false }),
        validateText(body.eventType, 'eventType', 80, false),
        validateText(body.alternativeNames, 'alternativeNames', 1000, false),
        body.faqSchemaEnabled === undefined || typeof body.faqSchemaEnabled === 'boolean' ? { valid: true } : { valid: false, error: 'faqSchemaEnabled must be true or false.' },
        body.currentEditionYear == null ? { valid: true } : { valid: false, error: 'Create the edition first, then explicitly select currentEditionYear on the event.' },
        validateSeo(body.seo)
      );
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }
      if (!(await imageIsManaged(body.featuredImage))) return res.status(400).json({ error: 'featuredImage must reference a Media Library item.' });
      if (body.allEditionYears?.length) return res.status(400).json({ error: 'Edition years are recorded by creating editions, not by pre-populating allEditionYears.' });

      const result = await prisma.$transaction(async (tx) => {
        // Configuration PUT locks this same Sport row FOR UPDATE. Hold a shared
        // lock while resolving definitions and writing values so they cannot race.
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Sport" WHERE "slug" = ${body.sportSlug} FOR SHARE`;
        if (!locked.length) return { status: 400 as const, error: 'sportSlug must identify an existing sport.' };
        const sport = await tx.sport.findUniqueOrThrow({ where: { slug: body.sportSlug }, select: { eventConfiguration: true } });
        const eventValues = parseSportEventValues(body.sportSpecificValues, resolveSportEventConfiguration(sport.eventConfiguration), { newEvent: true });
        if ('error' in eventValues) return { status: 400 as const, error: eventValues.error };
        const collision = await tx.sportEvent.findUnique({ where: { sportSlug_slug: { sportSlug: body.sportSlug, slug: body.slug } }, select: { id: true } });
        if (collision) return { status: 409 as const, error: `Event '${body.slug}' already exists under sport '${body.sportSlug}'.` };
        // PHASE R collision rule: an event may not take an event-less article's URL.
        try { await assertEventSlugFree(tx, { sportSlug: body.sportSlug, slug: body.slug }); }
        catch (err) { if (err instanceof UrlConflict) return { status: err.status as 409, error: err.message }; throw err; }
        const newEvent = await tx.sportEvent.create({ data: {
          id: `event-${body.slug}-${Date.now()}`,
          sportSlug: body.sportSlug,
          slug: body.slug,
          name: body.name,
          shortName: optionalFact(body.shortName) || body.name.trim(),
          description: optionalFact(body.description) || '',
          history: optionalFact(body.history),
          frequency: optionalFact(body.frequency),
          defaultVenue: optionalFact(body.defaultVenue),
          defaultLocation: optionalFact(body.defaultLocation),
          currentEditionYear: null,
          allEditionYears: [],
          featured: body.featured || false,
          isVisible: body.isVisible !== false,
          featuredImage: optionalFact(body.featuredImage),
          featuredMediaId: await mediaIdForUrl(optionalFact(body.featuredImage)),
          officialSourceUrl: body.officialSourceUrl?.trim() || null,
          eventType: body.eventType?.trim() || null,
          alternativeNames: normalizeAlternativeNames(body.alternativeNames),
          faqSchemaEnabled: body.faqSchemaEnabled === true,
          seo: body.seo || {},
          sportSpecificValues: Object.keys(eventValues.value).length ? eventValues.value : Prisma.DbNull,
        } });
        return { status: 201 as const, newEvent };
      });
      if ('error' in result) return res.status(result.status).json({ error: result.error });
      const { newEvent } = result;

      await recordAudit(prisma, { userId, userName, action: 'Created Permanent Event', entityType: 'Event', entityId: newEvent.id, details: `Created permanent event ${newEvent.name} under ${newEvent.sportSlug}.`, before: null, after: newEvent as unknown as Record<string, unknown>, fields: EVENT_AUDIT_FIELDS });

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

      const updates: Record<string, any> = req.body;
      const validationError = firstError(
        'name' in updates ? validateText(updates.name, 'name', 200) : { valid: true },
        updates.slug !== undefined ? validateSlug(updates.slug, 'slug') : { valid: true },
        updates.sportSlug !== undefined ? validateSlug(updates.sportSlug, 'sportSlug') : { valid: true },
        validateText(updates.shortName, 'shortName', 200, false),
        validateText(updates.alternativeNames, 'alternativeNames', 1000, false),
        validateText(updates.description, 'description', 5000, false),
        validateText(updates.history, 'history', 10000, false),
        validateText(updates.frequency, 'frequency', 200, false),
        validateText(updates.defaultVenue, 'defaultVenue', 200, false),
        validateText(updates.defaultLocation, 'defaultLocation', 200, false),
        validateSafeUrl(updates.featuredImage, 'featuredImage', { required: false }),
        validateSafeUrl(updates.officialSourceUrl, 'officialSourceUrl', { required: false, allowRelative: false }),
        validateText(updates.eventType, 'eventType', 80, false),
        updates.faqSchemaEnabled === undefined || typeof updates.faqSchemaEnabled === 'boolean' ? { valid: true } : { valid: false, error: 'faqSchemaEnabled must be true or false.' },
        !('currentEditionYear' in updates) || updates.currentEditionYear === null || validEditionYear(updates.currentEditionYear)
          ? { valid: true } : { valid: false, error: 'currentEditionYear must be null or an edition year between 1900 and 2200.' },
        validateSeo(updates.seo)
      );
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }
      if ('featuredImage' in updates && !(await imageIsManaged(updates.featuredImage))) return res.status(400).json({ error: 'featuredImage must reference a Media Library item.' });
      const targetSport = await prisma.sport.findUnique({ where: { slug: updates.sportSlug ?? existing.sportSlug }, select: { id: true } });
      if (!targetSport) {
        return res.status(400).json({ error: 'sportSlug must identify an existing sport.' });
      }
      if (updates.sportSlug !== undefined && updates.sportSlug !== existing.sportSlug && !('sportSpecificValues' in updates) && existing.sportSpecificValues && Object.keys(existing.sportSpecificValues as object).length) {
        return res.status(400).json({ error: 'Clear sportSpecificValues before moving this event to another sport.' });
      }
      if (updates.currentEditionYear != null) {
        const edition = await prisma.eventEdition.findFirst({ where: { sportSlug: existing.sportSlug, eventSlug: existing.slug, year: updates.currentEditionYear }, select: { id: true } });
        if (!edition) return res.status(400).json({ error: 'currentEditionYear must identify an existing edition of this event.' });
      }
      const allowed = ['name', 'slug', 'sportSlug', 'shortName', 'description', 'history', 'frequency', 'defaultVenue', 'defaultLocation', 'currentEditionYear', 'featured', 'isVisible', 'featuredImage', 'officialSourceUrl', 'eventType', 'seo', 'sportSpecificValues', 'faqSchemaEnabled'] as const;
      const data: Record<string, unknown> = {};
      for (const key of allowed) if (key in updates) data[key] = updates[key];
      for (const key of ['history', 'frequency', 'defaultVenue', 'defaultLocation', 'featuredImage', 'officialSourceUrl', 'eventType'] as const) {
        if (key in updates) data[key] = optionalFact(updates[key]);
      }
      if ('description' in updates) data.description = optionalFact(updates.description) || '';
      if ('shortName' in updates) data.shortName = optionalFact(updates.shortName) || (updates.name ?? existing.name);
      if ('alternativeNames' in updates) data.alternativeNames = normalizeAlternativeNames(updates.alternativeNames);
      if ('featuredImage' in updates) data.featuredMediaId = await mediaIdForUrl(data.featuredImage as string | null);

      // PHASE R (Spec §13.2–13.3): slug or sport changes move the event page,
      // its edition pages and its articles. Collision rule 1 is checked first.
      const nextSport = (data.sportSlug as string | undefined) ?? existing.sportSlug;
      const nextSlug = (data.slug as string | undefined) ?? existing.slug;
      const urlChanging = nextSport !== existing.sportSlug || nextSlug !== existing.slug;
      if (urlChanging) {
        const clash = await prisma.sportEvent.findUnique({ where: { sportSlug_slug: { sportSlug: nextSport, slug: nextSlug } }, select: { id: true } });
        if (clash && clash.id !== existing.id) return res.status(409).json({ error: `Event '${nextSlug}' already exists under sport '${nextSport}'.` });
        try { await assertEventSlugFree(prisma, { sportSlug: nextSport, slug: nextSlug }); }
        catch (err) { if (err instanceof UrlConflict) return res.status(err.status).json({ error: err.message }); throw err; }
      }

      let moves: { from: string; to: string }[] = [];
      let updated;
      try {
        updated = await prisma.$transaction(async (tx) => {
          const before = urlChanging ? await snapshotUrls(tx, { sportSlug: existing.sportSlug, eventSlug: existing.slug }) : null;
          if ('sportSpecificValues' in updates) {
            const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Sport" WHERE "slug" = ${nextSport} FOR SHARE`;
            if (!locked.length) throw new UrlConflict('sportSlug must identify an existing sport.', 400);
            const [sport, latestEvent] = await Promise.all([
              tx.sport.findUniqueOrThrow({ where: { slug: nextSport }, select: { eventConfiguration: true } }),
              tx.sportEvent.findUniqueOrThrow({ where: { id: existing.id }, select: { sportSpecificValues: true } }),
            ]);
            const previous = nextSport === existing.sportSlug ? latestEvent.sportSpecificValues : null;
            const values = parseSportEventValues(updates.sportSpecificValues, resolveSportEventConfiguration(sport.eventConfiguration), { newEvent: false, previous });
            if ('error' in values) throw new UrlConflict(values.error, 400);
            data.sportSpecificValues = Object.keys(values.value).length ? values.value : Prisma.DbNull;
          }
          // Event-level articles have no FK to the event: carry them along first.
          if (urlChanging) await moveEventLevelArticles(tx, { sportSlug: existing.sportSlug, eventSlug: existing.slug }, { sportSlug: nextSport, eventSlug: nextSlug });
          const saved = await tx.sportEvent.update({ where: { id: existing.id }, data });
          if (before) moves = await redirectChangedUrls(tx, before, `event ${existing.sportSlug}/${existing.slug} → ${saved.sportSlug}/${saved.slug}`);
          await recordAudit(tx, {
            userId, userName, action: 'Updated Permanent Event', entityType: 'Event', entityId: existing.id,
            details: `Updated event ${saved.name}.${moves.length ? ` ${moves.length} URL(s) moved with 301 redirects.` : ''}`,
            before: existing as unknown as Record<string, unknown>, after: saved as unknown as Record<string, unknown>, fields: EVENT_AUDIT_FIELDS,
          });
          return saved;
        }, { timeout: 60_000 });
      } catch (err) {
        if (err instanceof UrlConflict) return res.status(err.status).json({ error: err.message });
        if (err instanceof RedirectConflict) return res.status(409).json({ error: `URL change blocked: ${err.message}` });
        throw err;
      }
      if (moves.length) notifyIndexNow(seoOrigin(), moves.flatMap((m) => [m.from, m.to]), 'event URL changed');

      return res.json({ ...updated, movedUrls: moves.length });
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

      const [editionsCount, articlesCount, faqCount] = await Promise.all([
        prisma.eventEdition.count({ where: { sportSlug: ev.sportSlug, eventSlug: ev.slug } }),
        prisma.article.count({ where: { sportSlug: ev.sportSlug, eventSlug: ev.slug } }),
        prisma.faqEntry.count({ where: { eventId: ev.id } }),
      ]);

      if (editionsCount > 0 || articlesCount > 0) {
        return res.status(400).json({
          error: `Cannot delete event '${ev.name}': has ${editionsCount} staged editions and ${articlesCount} articles. Remove them first to prevent data corruption.`,
        });
      }
      // PHASE E5: Event-scoped FAQ entries are editorial content; never drop them silently.
      if (faqCount > 0) {
        return res.status(400).json({ error: `Cannot delete event '${ev.name}': it has ${faqCount} FAQ ${faqCount === 1 ? 'entry' : 'entries'}. Move or delete them in FAQ first.` });
      }

      await prisma.sportEvent.delete({ where: { id: ev.id } });
      // PHASE R.1: structured previous/new values (safe fields only).
      await recordAudit(prisma, { userId, userName, action: 'Deleted Permanent Event', entityType: 'Event', entityId: req.params.id, details: `Admin ${userName} deleted permanent event ${ev.name}.`, before: ev as unknown as Record<string, unknown>, after: null, fields: EVENT_AUDIT_FIELDS });

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
        validEditionYear(body.year)
          ? { valid: true }
          : { valid: false, error: 'year must be an integer between 1900 and 2200.' },
        validateText(body.venue, 'venue', 200, false),
        validateText(body.location, 'location', 200, false),
        validateText(body.description, 'description', 5000, false),
        validateSafeUrl(body.officialSourceUrl, 'officialSourceUrl', { required: false }),
        validateSafeUrl(body.featuredImage, 'featuredImage', { required: false }),
        validateOneOf(body.status, 'status', EDITION_STATUSES, true),
        validateText(body.title, 'title', 300),
        ...editionDetailChecks(body),
        validateSeo(body.seo),
        body.faqSchemaEnabled === undefined || typeof body.faqSchemaEnabled === 'boolean' ? { valid: true } : { valid: false, error: 'faqSchemaEnabled must be true or false.' }
      );
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }
      if (!(await imageIsManaged(body.featuredImage))) return res.status(400).json({ error: 'featuredImage must reference a Media Library item.' });
      if (!(await prisma.sportEvent.findFirst({ where: { sportSlug: body.sportSlug, slug: body.eventSlug }, select: { id: true } }))) {
        return res.status(400).json({ error: 'sportSlug and eventSlug must identify an existing event.' });
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
          title: body.title.trim(),
          startDate: optionalFact(body.startDate),
          endDate: optionalFact(body.endDate),
          venue: optionalFact(body.venue),
          location: optionalFact(body.location),
          status: body.status,
          quickFacts: body.quickFacts || [],
          prizeMoneyTotal: body.prizeMoneyTotal,
          defendingChampions: body.defendingChampions ?? undefined,
          qualificationInfo: body.qualificationInfo?.trim() || null,
          participantsCount: body.participantsCount ?? null,
          officialSourceUrl: optionalFact(body.officialSourceUrl),
          description: optionalFact(body.description) || '',
          featuredImage: optionalFact(body.featuredImage),
          featuredMediaId: await mediaIdForUrl(optionalFact(body.featuredImage)),
          faqSchemaEnabled: body.faqSchemaEnabled === true,
          seo: body.seo || {},
        },
      });

      await recordAudit(prisma, { userId, userName, action: 'Created Event Edition', entityType: 'Edition', entityId: newEdition.id, details: `Created edition ${newEdition.title} for ${newEdition.eventSlug}.`, before: null, after: newEdition as unknown as Record<string, unknown>, fields: EDITION_AUDIT_FIELDS });

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

      const updates: Record<string, any> = req.body;
      const validationError = firstError(
        'status' in updates ? validateOneOf(updates.status, 'status', EDITION_STATUSES, true) : { valid: true },
        'title' in updates ? validateText(updates.title, 'title', 300) : { valid: true },
        validateText(updates.venue, 'venue', 200, false),
        validateText(updates.location, 'location', 200, false),
        validateText(updates.description, 'description', 5000, false),
        validateSafeUrl(updates.officialSourceUrl, 'officialSourceUrl', { required: false }),
        validateSafeUrl(updates.featuredImage, 'featuredImage', { required: false }),
        ...editionDetailChecks(updates, existing),
        validateSeo(updates.seo),
        updates.faqSchemaEnabled === undefined || typeof updates.faqSchemaEnabled === 'boolean' ? { valid: true } : { valid: false, error: 'faqSchemaEnabled must be true or false.' }
      );
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }
      if ('featuredImage' in updates && !(await imageIsManaged(updates.featuredImage))) return res.status(400).json({ error: 'featuredImage must reference a Media Library item.' });
      const allowed = ['title', 'startDate', 'endDate', 'venue', 'location', 'status', 'quickFacts', 'prizeMoneyTotal', 'defendingChampions', 'qualificationInfo', 'participantsCount', 'officialSourceUrl', 'description', 'featuredImage', 'seo', 'faqSchemaEnabled'] as const;
      const editionData: Record<string, unknown> = {};
      for (const key of allowed) if (key in updates) editionData[key] = updates[key];
      for (const key of ['startDate', 'endDate', 'venue', 'location', 'featuredImage'] as const) {
        if (key in updates) editionData[key] = optionalFact(updates[key]);
      }
      if ('description' in updates) editionData.description = optionalFact(updates.description) || '';
      if ('title' in updates) editionData.title = updates.title.trim();
      if ('qualificationInfo' in updates) editionData.qualificationInfo = updates.qualificationInfo?.trim() || null;
      if ('defendingChampions' in updates) editionData.defendingChampions = updates.defendingChampions?.length ? updates.defendingChampions : Prisma.DbNull;
      if ('participantsCount' in updates) editionData.participantsCount = updates.participantsCount ?? null;
      if ('officialSourceUrl' in updates) editionData.officialSourceUrl = updates.officialSourceUrl?.trim() || null;
      if ('prizeMoneyTotal' in updates) editionData.prizeMoneyTotal = updates.prizeMoneyTotal?.trim() || null;
      if ('featuredImage' in updates) editionData.featuredMediaId = await mediaIdForUrl(editionData.featuredImage as string | null);

      const updated = await prisma.eventEdition.update({ where: { id: existing.id }, data: editionData });

      await recordAudit(prisma, { userId, userName, action: 'Updated Event Edition', entityType: 'Edition', entityId: req.params.id, details: `Updated edition ${updated.title}.`, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, fields: EDITION_AUDIT_FIELDS });

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
      const editionFaqs = await prisma.faqEntry.count({ where: { editionId: ed.id } });
      if (editionFaqs > 0) return res.status(400).json({ error: `Cannot delete edition '${ed.title}': it has ${editionFaqs} FAQ ${editionFaqs === 1 ? 'entry' : 'entries'}. Move or delete them in FAQ first.` });

      await prisma.eventEdition.delete({ where: { id: ed.id } });
      // PHASE R.1: structured previous/new values (safe fields only).
      await recordAudit(prisma, { userId, userName, action: 'Deleted Event Edition', entityType: 'Edition', entityId: req.params.id, details: `Admin ${userName} deleted edition ${ed.title}.`, before: ed as unknown as Record<string, unknown>, after: null, fields: EDITION_AUDIT_FIELDS });

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
  // PHASE A: comments are launch-disabled (ENABLE_COMMENTS). Every comment
  // route answers 404 while off; stored comments are left untouched.
  app.use('/api/comments', (_req: Request, res: Response, next: NextFunction) => {
    if (!features.comments) return res.status(404).json({ error: 'Comments are not available.' });
    next();
  });

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

      // PHASE R.1: structured previous/new values (safe fields only).
      await recordAudit(prisma, { userId, userName, action: 'Submitted Comment', entityType: 'Comment', entityId: newComment.id, details: `Comment submitted for article ${newComment.articleId} (status: ${newComment.status}).`, before: null, after: newComment as unknown as Record<string, unknown>, fields: COMMENT_AUDIT_FIELDS });

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

      // PHASE R.1: structured previous/new values (safe fields only).
      await recordAudit(prisma, { userId, userName, action: 'Moderated Comment', entityType: 'Comment', entityId: req.params.id, details: `Comment ${req.params.id} updated to status '${updated.status}' by ${userName}.`, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, fields: COMMENT_AUDIT_FIELDS });

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
      // PHASE R.1: structured previous/new values (safe fields only).
      await recordAudit(prisma, { userId, userName, action: 'Deleted Comment', entityType: 'Comment', entityId: req.params.id, details: `Comment ${req.params.id} deleted by ${userName}.`, before: existing as unknown as Record<string, unknown>, after: null, fields: COMMENT_AUDIT_FIELDS });

      return res.json({ success: true, id: req.params.id });
    })
  );

  // PHASE C: redirect manager, Media Library and CMS settings (modules).
  // PHASE E: public search, autocomplete and CMS article search.
  app.use(searchRouter(getAuthLookup));
  app.use('/api/redirects', redirectRouter(getAuthLookup));
  // PHASE F.1: Site Experience (homepage, navigation, footer, announcements, blocks).
  app.use('/api/site-experience', siteExperienceRouter(getAuthLookup));
  // PHASE H: editor-managed FAQ and the stored contact-form inbox.
  app.use('/api/faq', faqRouter(getAuthLookup));
  app.use(contactRouter(getAuthLookup));
  app.use('/api/sports', sportEventConfigurationRouter(getAuthLookup));
  app.use(editorialWorkflowRouter(getAuthLookup));

  // PHASE P: one full article (body, tables, references) for the editor.
  // Same read scope as the CMS list: Authors only reach their own articles.
  // Registered after the workflow router so /api/articles/reviewers wins.
  app.get(
    '/api/articles/:id',
    requireRole(getAuthLookup, ['Admin', 'Editor', 'Author']),
    asyncHandler(async (req: Request, res: Response) => {
      const article = await prisma.article.findFirst({ where: { AND: [{ id: req.params.id }, articleReadWhere(req.authContext!)] } });
      if (!article) return res.status(404).json({ error: 'Article not found.' });
      return res.json(article);
    })
  );
  app.use('/api/media', mediaRouter(getAuthLookup));
  app.use('/api/ad-creatives', adCreativesRouter(getAuthLookup));
  app.use('/api/settings', settingsRouter(getAuthLookup));
  app.use('/api/seo', seoRouter(getAuthLookup, seoOrigin));
  // PHASE R
  app.use('/api/article-types', articleTypesRouter(getAuthLookup));
  app.use(rumRouter());
  app.use('/api/insights', insightsRouter(getAuthLookup));
  app.use('/api/migration', migrationRouter(getAuthLookup));
  app.use('/api/search-console', searchConsoleRouter(getAuthLookup, seoOrigin));

  // PHASE D (Spec §30): an editor confirms an article is still accurate.
  // Records reviewedAt only — never updatedAt.
  app.post(
    '/api/articles/:id/review',
    requireRole(getAuthLookup, ['Admin', 'Editor', 'Author']),
    asyncHandler(async (req: Request, res: Response) => {
      const { userId, userName, role } = req.authContext!;
      const article = await prisma.article.findUnique({ where: { id: req.params.id } });
      if (!article) return res.status(404).json({ error: 'Article not found.' });
      if (role === 'Author') {
        const owner = await prisma.author.findUnique({ where: { id: article.authorId } });
        if (owner?.userId !== userId) return res.status(403).json({ error: 'Authors can only review their own articles.' });
      }
      const reviewed = await prisma.article.update({ where: { id: article.id }, data: { reviewedAt: new Date() } });
      await prisma.auditLog.create({ data: { id: `log-${crypto.randomUUID()}`, userId, userName, action: 'Reviewed Article', entityType: 'Article', entityId: article.id, timestamp: new Date(), details: `${userName} confirmed "${article.title}" is still accurate.` } });
      return res.json(reviewed);
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
        validateText(body.twitter, 'twitter', 100, false),
        validateText(body.email, 'email', 200, false)
      );
      const avatarError = validateProfileImageUrl(body.avatar || '', 'avatar');
      if (authorValidationError || avatarError) {
        return res.status(400).json({ error: authorValidationError || avatarError });
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

      // PHASE R.1: structured previous/new values (safe fields only).
      await recordAudit(prisma, { userId, userName, action: 'Created Author Profile', entityType: 'Author', entityId: newAuthor.id, details: `Created author ${newAuthor.name} (${newAuthor.slug}).`, before: null, after: newAuthor as unknown as Record<string, unknown>, fields: AUTHOR_AUDIT_FIELDS });

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

      if (Object.hasOwn(req.body, 'avatar')) {
        const avatarError = validateProfileImageUrl(req.body.avatar, 'avatar');
        if (avatarError) return res.status(400).json({ error: avatarError });
      }

      const updated = await prisma.author.update({ where: { id: existing.id }, data: req.body });

      // PHASE R.1: structured previous/new values (safe fields only).
      await recordAudit(prisma, { userId, userName, action: 'Updated Author Profile', entityType: 'Author', entityId: req.params.id, details: `Updated author profile ${updated.name}.`, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, fields: AUTHOR_AUDIT_FIELDS });

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
      if (!allowedRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role specified.' });
      }

      if (target.role === 'Admin' && role !== 'Admin' && (await isLastActiveAdmin(target.id))) {
        return res.status(400).json({ error: `Cannot change ${target.name}'s role: they are the last active Admin. Promote another user to Admin first.` });
      }

      const oldRole = target.role;
      const updated = await prisma.user.update({ where: { id: target.id }, data: { role } });

      // PHASE R.1: structured previous/new values (safe fields only).
      await recordAudit(prisma, { userId, userName, action: 'Changed User Role', entityType: 'User', entityId: target.id, details: `Admin ${userName} changed user ${target.name}'s role from ${oldRole} to ${role}.`, before: target as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, fields: USER_AUDIT_FIELDS });

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
      if (!allowedRoles.includes(body.role)) {
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

      // PHASE R.1: structured previous/new values (safe fields only).
      await recordAudit(prisma, { userId, userName, action: 'Created Staff User', entityType: 'User', entityId: newUser.id, details: `Admin ${userName} created staff account "${newUser.name}" (${newUser.role}). Password not recorded in audit log.`, before: null, after: newUser as unknown as Record<string, unknown>, fields: USER_AUDIT_FIELDS });

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

      // PHASE R.1: structured previous/new values (safe fields only).
      await recordAudit(prisma, { userId, userName, action: 'Updated Staff User', entityType: 'User', entityId: target.id, details: `Admin ${userName} updated staff account "${updated.name}".`, before: target as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, fields: USER_AUDIT_FIELDS });

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

      // PHASE R.1: structured previous/new values (safe fields only).
      await recordAudit(prisma, { userId, userName, action: 'Changed User Status', entityType: 'User', entityId: target.id, details: `Admin ${userName} set "${target.name}"'s status to ${status}.`, before: target as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, fields: USER_AUDIT_FIELDS });

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

      // PHASE R.1: structured previous/new values (safe fields only).
      await recordAudit(prisma, { userId, userName, action: 'Deleted Staff User', entityType: 'User', entityId: req.params.id, details: `Admin ${userName} deleted staff account "${target.name}".`, before: target as unknown as Record<string, unknown>, after: null, fields: USER_AUDIT_FIELDS });

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
      // PHASE H: no public template renders the sidebar slots; refuse configuration so nothing is set up that can never appear.
      if ((UNPLACED_AD_SLOTS as readonly string[]).includes(existing.id)) {
        return res.status(409).json({ error: 'This ad slot is not placed on any page (the site has no sidebar) and cannot be configured.' });
      }

      // PHASE F: only the editable fields, each type-checked. Slot identity,
      // name, placement and dimensions are fixed by the layout.
      const body: Record<string, unknown> = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const EDITABLE = ['enabled', 'sponsorName', 'bannerText', 'linkUrl', 'provider', 'providerSlotId', 'creativeId', 'creativeAlt', 'creativeFit'];
      const unknownField = Object.keys(body).find((k) => !EDITABLE.includes(k));
      if (unknownField) return res.status(400).json({ error: `${unknownField} cannot be changed.` });
      const optionalText = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v).trim() || null);
      const adValidationError = firstError(
        'enabled' in body && typeof body.enabled !== 'boolean' ? { valid: false, error: 'enabled must be true or false.' } : { valid: true },
        validateText(body.sponsorName, 'sponsorName', 150, false),
        validateText(body.bannerText, 'bannerText', 300, false),
        validateText(body.creativeId, 'creativeId', 100, false),
        validateText(body.creativeAlt, 'creativeAlt', 300, false),
        'creativeFit' in body && !['contain', 'cover'].includes(String(body.creativeFit)) ? { valid: false, error: 'creativeFit must be contain or cover.' } : { valid: true },
        validateSafeUrl(body.linkUrl, 'linkUrl', { required: false }),
        'provider' in body && !(AD_PROVIDERS as readonly unknown[]).includes(body.provider) ? { valid: false, error: `provider must be one of ${AD_PROVIDERS.join(', ')}.` } : { valid: true },
        body.providerSlotId !== undefined && body.providerSlotId !== null && body.providerSlotId !== '' && !/^\d{6,20}$/.test(String(body.providerSlotId)) ? { valid: false, error: 'providerSlotId must be the numeric ad unit ID (6–20 digits).' } : { valid: true }
      );
      if (adValidationError) {
        return res.status(400).json({ error: adValidationError });
      }
      const nextProvider = (body.provider as string | undefined) ?? existing.provider;
      const nextSlotId = 'providerSlotId' in body ? optionalText(body.providerSlotId) : existing.providerSlotId;
      if (nextProvider === 'adsense' && !nextSlotId) {
        return res.status(400).json({ error: 'An AdSense slot needs its ad unit ID (providerSlotId).' });
      }

      const data: Record<string, unknown> = {};
      const nextCreativeId = 'creativeId' in body ? optionalText(body.creativeId) : existing.creativeId;
      const nextCreativeAlt = 'creativeAlt' in body ? optionalText(body.creativeAlt) : existing.creativeAlt;
      if (nextCreativeId) {
        if (!nextCreativeAlt) return res.status(400).json({ error: 'Describe the ad media in its alt text.' });
        if (!await prisma.adCreative.findUnique({ where: { id: nextCreativeId } })) return res.status(400).json({ error: 'Choose existing ad media from the library.' });
      }
      if ('creativeId' in body) data.creativeId = nextCreativeId;
      if ('creativeAlt' in body) data.creativeAlt = nextCreativeAlt;
      if ('creativeFit' in body) data.creativeFit = body.creativeFit;
      if ('enabled' in body) data.enabled = body.enabled;
      for (const key of ['sponsorName', 'bannerText', 'linkUrl'] as const) if (key in body) data[key] = optionalText(body[key]);
      if ('provider' in body) data.provider = body.provider;
      if ('providerSlotId' in body) data.providerSlotId = nextSlotId;
      const updated = await prisma.adSlotConfig.update({ where: { id: existing.id }, data, include: { creative: true } });

      // PHASE R.1: structured previous/new values (safe fields only).
      await recordAudit(prisma, { userId, userName, action: 'Configured Ad Slot', entityType: 'Setting', entityId: req.params.id, details: `Configured ad slot ${req.params.id} (enabled: ${updated.enabled}, provider: ${updated.provider}).`, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, fields: AD_AUDIT_FIELDS });

      return res.json(updated);
    })
  );

  // Audit Logs API (Admin & Editor)
  app.get(
    '/api/audit-logs',
    requireRole(getAuthLookup, ['Admin', 'Editor']),
    asyncHandler(async (req: Request, res: Response) => {
      // PHASE R: paged (?page=, 200 per page) so the log never loads in full.
      const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
      const logs = await prisma.auditLog.findMany({ orderBy: { timestamp: 'desc' }, take: 200, skip: (page - 1) * 200 });
      return res.json(logs);
    })
  );

  // 7. Next.js page rendering (PHASE B)
  // API misses must never fall through to page rendering (including non-GETs).
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));

  // Editorial images referenced by stored content as /src/assets/images/*.
  // Only this one directory is exposed; the rest of /src stays private.
  app.use('/src/assets/images', express.static(path.resolve('src/assets/images'), { index: false, dotfiles: 'deny', fallthrough: true }));

  // PHASE C: processed Media Library files. Keys are unguessable and
  // content-addressed per upload, so they are cached as immutable.
  if (storage.localRoot) {
    const mediaTypes: Record<string, string> = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm' };
    app.use('/media', express.static(storage.localRoot, {
      index: false, dotfiles: 'deny', immutable: true, maxAge: '365d', fallthrough: true, redirect: false,
      // Explicit types: the static server's MIME table has no entry for .avif.
      setHeaders: (res, filePath) => res.setHeader('Content-Type', mediaTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream'),
    }));
  } else if (process.env.MEDIA_PUBLIC_BASE_URL) {
    // PHASE R (deployment): media lives in object storage. Rows written before
    // the switch store /media/<key> URLs (ad creatives, image fallbacks); the
    // objects were copied under the same keys (npm run media:copy-to-r2), so
    // such requests are sent to the public bucket URL. Keys are validated.
    const mediaBase = process.env.MEDIA_PUBLIC_BASE_URL.replace(/\/+$/, '');
    app.get(/^\/media\/(.+)$/, (req: Request, res: Response, next: NextFunction) => {
      const key = req.params[0];
      if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(key) || key.split('/').some((part) => part === '.' || part === '..')) return next();
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.redirect(301, `${mediaBase}/${key}`);
    });
  }


  const nextApp = next({ dev: !deployment.production, dir: process.cwd() });
  const handleNext = nextApp.getRequestHandler();
  await nextApp.prepare();

  // An async App Router notFound() can be reached after the root layout has
  // started streaming, leaving HTTP 200 on a disabled /faq/ page. Decide the
  // optional page's existence before rendering so visitors and crawlers get
  // a real 404, consistent with the sitemap and the final FAQ requirement.
  // PHASE P: /search/?q=… shares the search API's per-IP rate limit.
  app.get(['/search', '/search/'], searchPageRateLimit);

  app.get(['/faq', '/faq/'], asyncHandler(async (req: Request, res: Response) => {
    const { globalFaqPageEnabled } = await import('./server/services/public/faq');
    if (!(await globalFaqPageEnabled())) return nextApp.render404(req, res);
    return handleNext(req, res);
  }));

  app.use((req: Request, res: Response, nextMiddleware: NextFunction) => {
    // Source/tooling paths and unknown files are plain JSON 404s, never pages.
    const isNextInternal = /^\/(?:_next|__next)(?:\/|$)/.test(req.path);
    if (!isNextInternal && (/^\/(?:src|node_modules|@vite|@id|@fs)(?:\/|$)/i.test(req.path) || req.path.slice(req.path.lastIndexOf('/') + 1).includes('.'))) {
      return res.status(404).json({ error: 'Not found.' });
    }
    // Next only renders pages; there are no Next API routes or server actions.
    if (!isNextInternal && req.method !== 'GET' && req.method !== 'HEAD') {
      return res.status(405).set('Allow', 'GET, HEAD').json({ error: 'Method not allowed.' });
    }
    Promise.resolve(handleNext(req, res)).catch(nextMiddleware);
  });

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
    // Logged: request ID, method, path WITHOUT query string, error class and
    // (Prisma/Node) error code only. Never messages, bodies or query values.
    const requestId = (_req as Request & { requestId?: string }).requestId;
    const code = typeof (err as { code?: unknown } | null)?.code === 'string' ? (err as { code: string }).code : undefined;
    const errorStatus = (err as { status?: number; statusCode?: number } | null)?.status ?? (err as { statusCode?: number } | null)?.statusCode;
    console.error(`[SportingSpy] Request failed id=${requestId} ${_req.method} ${_req.path} status=${errorStatus ?? 500} error=${err instanceof Error ? err.name : 'UnknownError'}${code && /^[A-Z0-9_]{2,40}$/.test(code) ? ` code=${code}` : ''}`);
    if (res.headersSent) return;
    if (err instanceof WorkflowError) return res.status(err.status).json({error:err.message,requestId});

    // PHASE 3: body-parser's "entity too large" (and similar well-known
    // client errors) carry their own correct 4xx status — surface that
    // instead of flattening every error to a generic 500, while still
    // never leaking the underlying message/stack in production.
    const errStatus = (err as { status?: number; statusCode?: number } | null)?.status ?? (err as { statusCode?: number } | null)?.statusCode;
    const isKnownClientError = typeof errStatus === 'number' && errStatus >= 400 && errStatus < 500;
    const status = isKnownClientError ? errStatus! : 500;
    const genericMessage = status === 413 ? 'Request body too large.' : status === 400 ? 'Malformed request.' : 'Internal server error.';

    res.status(status).json({ error: genericMessage, requestId });
  });

  const listener = app.listen(deployment.port, deployment.host, () => {
    console.log(`[SportingSpy] Server running at http://${deployment.host}:${deployment.port} (environment: ${deployment.appEnv}, media storage: ${storage.name})`);
  });
  listener.on('error', () => { console.error('[SportingSpy] Cannot bind configured listening address.'); process.exit(1); });
  // Next.js dev server hot reload uses a websocket on this same server.
  if (!deployment.production) listener.on('upgrade', nextApp.getUpgradeHandler());
  let schedulerWork: Promise<unknown> | undefined;
  const scheduler = setInterval(() => {
    if (stopping || schedulerWork) return;
    schedulerWork = Promise.all([
      publishScheduledArticles().catch(() => console.error('[Scheduler] Publication failed. Check database availability.')),
      // PHASE R.1: only when a schedule is due, the cache is bypassed while it applies and cleared afterwards.
      (async () => {
        if (!(await prisma.siteExperience.count({ where: { scheduledFor: { lte: new Date() } } }))) return 0;
        const end = beginContentWrite('site experience schedule');
        try { return await applyDueSchedules(); } finally { end(); }
      })().catch(() => console.error('[Scheduler] Site Experience publication failed. Check database availability.')),
      // PHASE R: daily Search Console / Bing import, only when configured (no-op otherwise).
      runScheduledSearchSync(seoOrigin()).catch(() => console.error('[Scheduler] Search performance import failed. See Admin → Insights.')),
      // PHASE Q: aggregate analytics retention (self-throttled to every 6 hours; never throws).
      purgeExpiredAnalytics(),
    ]).finally(() => { schedulerWork = undefined; });
  }, 30000);
  scheduler.unref();

  // PHASE J: graceful shutdown. On SIGTERM/SIGINT (platform deploys, restarts,
  // Ctrl+C) stop accepting connections and the scheduler, let in-flight
  // requests finish (at most 10 s), then close the database pool.
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[SportingSpy] ${signal} received; shutting down gracefully.`);
    clearInterval(scheduler);
    const force = setTimeout(() => { console.error('[SportingSpy] Shutdown timed out; exiting.'); process.exit(1); }, 10_000);
    force.unref();
    listener.close(() => {
      Promise.resolve(schedulerWork).then(() => prisma.$disconnect()).catch(() => undefined).finally(() => { console.log('[SportingSpy] Shutdown complete.'); process.exit(0); });
    });
    listener.closeIdleConnections?.();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('[SportingSpy] Startup refused:', err instanceof DeploymentConfigError || err instanceof LaunchGuardError ? err.message : 'Database/schema or server initialization failed. Check configuration and applied migrations.');
  process.exit(1);
});
