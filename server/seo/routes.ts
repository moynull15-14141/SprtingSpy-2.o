/**
 * SEO Intelligence API (PHASE D), mounted at /api/seo. Staff only:
 *   GET  /overview            latest scan (cached findings) + previous summary   Admin, Editor
 *   POST /scan                run a full scan now                               Admin, Editor
 *   GET  /runs, /runs/:id     scan history (reports)                            Admin, Editor
 *   GET  /rules               rules with their stored settings                  Admin, Editor
 *   PUT  /rules/:key          enable/disable, severity, types, config           Admin
 *   POST /article-check       checklist + suggestions for a (draft) article     Admin, Editor, Author
 *   POST /assistant           optional AI suggestions (never writes)            Admin, Editor, Author
 *   GET  /technical           sitemap, robots, integrations, IndexNow log       Admin, Editor
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../db';
import { requireRole, type AuthLookup } from '../auth';
import { allArticleTypes } from '../articleTypes';
import { recordAudit } from '../audit';
import { RULES_BY_KEY, SEVERITIES } from './rules';
import { checkArticleDraft, loadRuleSettings, runScan } from './engine';
import { coverageGaps, externalSourceSuggestions, internalLinkSuggestions } from './suggestions';
import { aiSuggestions, assistantState } from './assistant';
import { indexNowState } from './indexnow';
import { sitemapFiles } from './sitemap';
import { robotsTxt } from './robots';
import { appEnv } from '../deployment';
import { validateRichDoc } from '../../src/lib/richText';

/** A stored rule config must keep the default's shape: same keys, same value kinds. */
function configError(defaults: Record<string, unknown>, config: unknown): string | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return 'config must be an object.';
  if (JSON.stringify(config).length > 20000) return 'config is too large.';
  for (const [key, value] of Object.entries(config)) {
    if (!(key in defaults)) return `config.${key} is not a setting of this rule.`;
    const def = defaults[key];
    const kind = (v: unknown) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
    if (kind(def) !== kind(value)) return `config.${key} must be a ${kind(def)}.`;
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0 || value > 100000)) return `config.${key} must be between 0 and 100000.`;
  }
  return null;
}

export function seoRouter(getLookup: () => AuthLookup, origin: () => string) {
  const router = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
  const staff = requireRole(getLookup, ['Admin', 'Editor']);

  router.get('/overview', staff, wrap(async (_req, res) => {
    const runs = await prisma.seoScanRun.findMany({ orderBy: { startedAt: 'desc' }, take: 2 });
    return res.json({ latest: runs[0] || null, previousSummary: runs[1]?.summary || null });
  }));

  router.post('/scan', staff, wrap(async (req, res) => {
    const run = await runScan(origin(), req.authContext!.userName);
    await prisma.auditLog.create({ data: { id: `log-${crypto.randomUUID()}`, userId: req.authContext!.userId, userName: req.authContext!.userName, action: 'Ran SEO Scan', entityType: 'Setting', entityId: run.id, timestamp: new Date(), details: `SEO scan: ${(run.summary as { total: number }).total} findings.` } });
    return res.status(201).json(run);
  }));

  router.get('/runs', staff, wrap(async (_req, res) => {
    const runs = await prisma.seoScanRun.findMany({ orderBy: { startedAt: 'desc' }, take: 30, select: { id: true, startedAt: true, finishedAt: true, status: true, triggeredBy: true, summary: true } });
    return res.json(runs);
  }));

  router.get('/runs/:id', staff, wrap(async (req, res) => {
    const run = await prisma.seoScanRun.findUnique({ where: { id: req.params.id } });
    return run ? res.json(run) : res.status(404).json({ error: 'Scan not found.' });
  }));

  router.get('/rules', staff, wrap(async (_req, res) => {
    const settings = await loadRuleSettings();
    const rows = await prisma.seoRule.findMany();
    return res.json(
      [...RULES_BY_KEY.values()].map((def) => ({
        key: def.key, name: def.name, why: def.why, fix: def.fix, category: def.category, target: def.target,
        defaults: { severity: def.severity, articleTypes: def.articleTypes || [], config: def.config },
        ...settings.get(def.key)!,
        updatedAt: rows.find((r) => r.key === def.key)?.updatedAt || null,
      }))
    );
  }));

  router.put('/rules/:key', requireRole(getLookup, ['Admin']), wrap(async (req, res) => {
    const def = RULES_BY_KEY.get(req.params.key);
    const row = await prisma.seoRule.findUnique({ where: { key: req.params.key } });
    if (!def || !row) return res.status(404).json({ error: 'Rule not found.' });
    const body = req.body as Record<string, unknown>;
    const allowed = ['enabled', 'severity', 'articleTypes', 'config'];
    if (!body || typeof body !== 'object' || Object.keys(body).some((k) => !allowed.includes(k))) return res.status(400).json({ error: `Only ${allowed.join(', ')} can be changed.` });
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false.' });
    if (body.severity !== undefined && !SEVERITIES.includes(body.severity as never)) return res.status(400).json({ error: `severity must be one of ${SEVERITIES.join(', ')}.` });
    if (body.articleTypes !== undefined) {
      if (def.target !== 'article') return res.status(400).json({ error: 'Only article rules have article types.' });
      const known = new Set((await allArticleTypes()).map((t) => t.name));
      if (!Array.isArray(body.articleTypes) || body.articleTypes.some((t) => !known.has(t as string))) return res.status(400).json({ error: 'articleTypes must be a list of existing article types.' });
    }
    if (body.config !== undefined) {
      const err = configError(def.config, body.config);
      if (err) return res.status(400).json({ error: err });
    }
    const updated = await prisma.seoRule.update({
      where: { key: def.key },
      data: {
        ...(body.enabled !== undefined ? { enabled: body.enabled as boolean } : {}),
        ...(body.severity !== undefined ? { severity: body.severity as string } : {}),
        ...(body.articleTypes !== undefined ? { articleTypes: [...new Set(body.articleTypes as string[])] } : {}),
        ...(body.config !== undefined ? { config: body.config as object } : {}),
        version: row.version + 1,
        updatedAt: new Date(),
      },
    });
    await recordAudit(prisma, { userId: req.authContext!.userId, userName: req.authContext!.userName, action: 'Updated SEO Rule', entityType: 'Setting', entityId: def.key, details: `SEO rule "${def.key}" updated to version ${updated.version} (${Object.keys(body).join(', ')}).`, before: row as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, fields: ['enabled', 'severity', 'articleTypes', 'config'] });
    return res.json(updated);
  }));

  /** Validates the editor draft sent for checking (never saved). */
  function draftInput(body: Record<string, unknown>, knownTypes: Set<string>) {
    if (!body || typeof body !== 'object') return { error: 'Send the article draft.' };
    if (typeof body.articleType !== 'string' || !knownTypes.has(body.articleType)) return { error: 'articleType is required.' };
    if (typeof body.sportSlug !== 'string') return { error: 'sportSlug is required.' };
    let doc = null;
    if (body.body !== undefined && body.body !== null) {
      const result = validateRichDoc(body.body);
      if (!result.ok) return { error: (result as { error: string }).error };
      doc = result.doc;
    }
    const str = (v: unknown, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : '');
    return {
      input: {
        id: str(body.id, 100) || 'draft', title: str(body.title, 300), subtitle: str(body.subtitle, 300), slug: str(body.slug, 120), status: str(body.status, 20) || 'draft',
        articleType: body.articleType, sportSlug: body.sportSlug, eventSlug: str(body.eventSlug, 120) || null,
        editionYear: typeof body.editionYear === 'number' ? body.editionYear : null, excerpt: str(body.excerpt, 1000), seo: typeof body.seo === 'object' ? body.seo : {},
        body: doc, content: str(body.content, 200000), featuredMediaId: str(body.featuredMediaId, 100) || null, featuredImage: str(body.featuredImage, 2048),
        references: Array.isArray(body.references) ? body.references.slice(0, 50) : [], publishedAt: typeof body.publishedAt === 'string' ? body.publishedAt : null,
        updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : null, reviewedAt: typeof body.reviewedAt === 'string' ? body.reviewedAt : null, authorId: str(body.authorId, 100) || 'author',
      },
    };
  }

  router.post('/article-check', requireRole(getLookup, ['Admin', 'Editor', 'Author']), wrap(async (req, res) => {
    const parsed = draftInput(req.body, new Set((await allArticleTypes()).map((t) => t.name)));
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const { ctx, subject, checklist } = await checkArticleDraft(origin(), parsed.input as never);
    const coverage = (await loadRuleSettings()).get('edition-coverage')!;
    return res.json({
      checklist,
      suggestions: {
        internalLinks: internalLinkSuggestions(subject, ctx),
        externalSources: externalSourceSuggestions(subject, ctx),
        coverage: coverage.enabled ? coverageGaps(subject, ctx, coverage.config as Record<string, string[]>) : [],
      },
      assistant: assistantState(),
    });
  }));

  router.post('/assistant', requireRole(getLookup, ['Admin', 'Editor', 'Author']), wrap(async (req, res) => {
    const state = assistantState();
    if (!state.configured) return res.status(503).json({ error: state.reason, configured: false });
    const parsed = draftInput(req.body, new Set((await allArticleTypes()).map((t) => t.name)));
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const { ctx, subject } = await checkArticleDraft(origin(), parsed.input as never);
    const result = await aiSuggestions(subject, ctx);
    if (!result.ok) return res.status((result as { status: number }).status).json({ error: (result as { error: string }).error, configured: true });
    return res.json({ configured: true, suggestions: (result as { suggestions: unknown }).suggestions });
  }));

  router.get('/technical', staff, wrap(async (_req, res) => {
    const o = origin();
    const [sitemap, indexNow, logs, settings] = await Promise.all([
      sitemapFiles(o),
      indexNowState(o),
      prisma.seoIntegrationLog.findMany({ where: { integration: 'indexnow' }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.siteSetting.findMany({ where: { key: { in: ['googleSiteVerification', 'bingSiteVerification'] } } }),
    ]);
    const has = (k: string) => settings.some((s) => s.key === k);
    return res.json({
      origin: o,
      sitemap: { indexUrl: `${o}/sitemap.xml`, files: [...sitemap.files.keys()].map((f) => `${o}/sitemaps/${f}`), ...sitemap.report },
      robots: robotsTxt(o, appEnv()),
      searchConsole: {
        verificationTokenSet: has('googleSiteVerification'),
        sitemapUrl: `${o}/sitemap.xml`,
        apiConnected: false,
        setup: [
          has('googleSiteVerification') ? 'Verification meta tag is published on every page.' : 'Add the Google verification token in Settings.',
          `Submit ${o}/sitemap.xml in Search Console (Sitemaps).`,
          'Performance data (clicks, impressions, CTR, position, indexing) needs a Search Console API connection, which is not configured in this installation. No metrics are shown until it is.',
        ],
      },
      bing: {
        verificationTokenSet: has('bingSiteVerification'),
        sitemapUrl: `${o}/sitemap.xml`,
        apiConnected: false,
        indexNow: indexNow.configured,
        setup: [
          has('bingSiteVerification') ? 'msvalidate.01 meta tag is published on every page.' : 'Add the Bing verification token in Settings.',
          `Submit ${o}/sitemap.xml in Bing Webmaster Tools.`,
          'Bing performance data needs a Bing Webmaster API key, which is not configured. No metrics are shown until it is.',
        ],
      },
      indexNow: { ...indexNow, recent: logs },
    });
  }));

  return router;
}
