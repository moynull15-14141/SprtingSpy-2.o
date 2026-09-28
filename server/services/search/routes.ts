/**
 * Search API (PHASE E). All three endpoints use the same search service.
 *   GET /api/search                 public article search (published only)    anyone, rate limited
 *   GET /api/search/suggestions     public autocomplete (titles + sports)     anyone, rate limited
 *   GET /api/cms/articles/search    CMS article search, every status          Admin, Editor, Author
 *
 * CMS visibility matches /api/cms/data: every staff role can read every
 * article. Query parameters are validated by services/search/params.ts;
 * unknown or malformed parameters are rejected with 400.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../../db';
import { requireRole, type AuthLookup } from '../../auth';
import { createRateLimiter, type RateLimiter } from '../../rateLimit';
import { articlePath } from '../../../src/lib/paths';
import { searchArticleIds } from './articleSearch';
import { idParam, parseSearchQuery } from './params';
import { publicSuggestions, searchPublic } from '../public/search';

const searchLimiter = createRateLimiter(60 * 1000, 120);
const suggestLimiter = createRateLimiter(60 * 1000, 240);

type Handler = (req: Request, res: Response) => Promise<unknown>;
const asyncHandler = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

function limited(limiter: RateLimiter, req: Request, res: Response): boolean {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const state = limiter.check(key);
  if (state.limited) {
    res.setHeader('Retry-After', String(state.retryAfterSeconds));
    res.status(429).json({ error: 'Too many search requests. Please wait a moment and try again.' });
    return true;
  }
  limiter.record(key);
  return false;
}

export function searchRouter(getAuthLookup: () => AuthLookup) {
  const router = express.Router();

  router.get('/api/search', asyncHandler(async (req, res) => {
    if (limited(searchLimiter, req, res)) return;
    const parsed = parseSearchQuery(req.query as Record<string, unknown>, { strict: true, defaultLimit: 12 });
    if (!parsed.ok) return res.status(400).json({ error: (parsed as { error: string }).error });
    const p = parsed.value;
    const data = await searchPublic({ q: p.q, sport: p.sport, type: p.type, author: p.author, from: p.from, to: p.to, sort: p.sort, page: p.page, limit: p.limit });
    return res.json({
      query: data.query,
      page: data.page,
      pageSize: data.pageSize,
      total: data.articleTotal,
      totalPages: data.totalPages,
      mode: data.mode,
      results: data.articles.map((a) => ({
        id: a.id, title: a.title, excerpt: a.excerpt, url: a.url, sport: a.sportSlug, sportName: a.sportName,
        articleType: a.articleType, publishedAt: a.publishedAt, authorName: a.authorName ?? null,
        image: a.image?.url ?? a.featuredImage ?? null,
      })),
    });
  }));

  router.get('/api/search/suggestions', asyncHandler(async (req, res) => {
    if (limited(suggestLimiter, req, res)) return;
    const parsed = parseSearchQuery(req.query as Record<string, unknown>, { strict: true, defaultLimit: 6 });
    if (!parsed.ok) return res.status(400).json({ error: (parsed as { error: string }).error });
    return res.json(await publicSuggestions(parsed.value.q));
  }));

  router.get('/api/cms/articles/search', requireRole(getAuthLookup, ['Admin', 'Editor', 'Author']), asyncHandler(async (req, res) => {
    const parsed = parseSearchQuery(req.query as Record<string, unknown>, { strict: true, defaultLimit: 25, allowStatus: true });
    if (!parsed.ok) return res.status(400).json({ error: (parsed as { error: string }).error });
    const p = parsed.value;
    const author = p.author ? await prisma.author.findUnique({ where: { slug: p.author }, select: { id: true } }) : null;
    const found = await searchArticleIds({
      scope: p.publicOnly ? 'public' : 'staff', q: p.q, sport: p.sport || undefined, type: p.type || undefined, status: p.status || undefined,
      authorId: p.author ? author?.id ?? '__none__' : undefined, from: p.from, to: p.to, sort: p.sort,
      page: p.page, limit: p.limit, excludeId: idParam(req.query.exclude),
    });
    const rows = found.ids.length
      ? await prisma.article.findMany({
          where: { id: { in: found.ids } },
          select: {
            id: true, title: true, slug: true, status: true, sportSlug: true, eventSlug: true, editionYear: true, articleType: true,
            excerpt: true, publishedAt: true, reviewedAt: true, authorId: true, featuredImage: true,
            sport: { select: { name: true } }, author: { select: { name: true } },
          },
        })
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const items = found.ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r).map(({ sport, author: a, ...r }) => ({
      ...r, sportName: sport.name, authorName: a.name, url: articlePath(r),
    }));
    return res.json({ items, total: found.total, page: found.page, pageSize: found.pageSize, totalPages: Math.max(1, Math.ceil(found.total / found.pageSize)), mode: found.mode });
  }));

  return router;
}
