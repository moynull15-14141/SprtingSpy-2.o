/**
 * Search API (PHASE E). All three endpoints use the same search service.
 *   GET /api/search                 public Article + Event search (visible only)  anyone, rate limited
 *       PHASE M: `kind` = article | event (omitted = both). `total`/`results` remain the
 *       Article count/page; `events`/`eventTotal` add Events; `totalPages` counts pages of
 *       the paginated type (Events when kind=event).
 *   GET /api/search/suggestions     public autocomplete (titles + sports)     anyone, rate limited
 *   GET /api/cms/articles/search    CMS article search, every status          Admin, Editor, Author
 *
 * Authors only search their own CMS articles. Public-only editor link pickers
 * use published projections. Query parameters are validated by services/search/params.ts;
 * unknown or malformed parameters are rejected with 400.
 */

import { allArticleTypes } from '../../articleTypes';
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
    // PHASE R: Article Types are database-backed; the strict API still rejects unknown names.
    if (p.type && !(await allArticleTypes()).some((t) => t.name === p.type)) return res.status(400).json({ error: 'type is not a known article type.' });
    const data = await searchPublic({ q: p.q, kind: p.kind, sport: p.sport, type: p.type, author: p.author, from: p.from, to: p.to, sort: p.sort, page: p.page, limit: p.limit });
    return res.json({
      query: data.query,
      kind: data.kind || 'all',
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
      eventTotal: data.eventTotal,
      events: data.events.map((e) => ({
        id: e.id, name: e.name, shortName: e.shortName, url: e.url, sport: e.sportSlug, sportName: e.sportName,
        description: e.description, venue: e.defaultVenue ?? null, location: e.defaultLocation ?? null,
        matchedEdition: e.matchedEdition ?? null,
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
    const ctx = req.authContext!;
    const found = await searchArticleIds({
      scope: p.publicOnly ? 'public' : 'staff', q: p.q, sport: p.sport || undefined, type: p.type || undefined, status: p.status || undefined,
      authorId: p.author ? author?.id ?? '__none__' : undefined, from: p.from, to: p.to, sort: p.sort,
      ownerUserId: ctx.role === 'Author' && !p.publicOnly ? ctx.userId : undefined,
      reviewStatus: p.publicOnly ? undefined : p.reviewStatus,
      draftsOnly: p.myDrafts,
      myDraftsUserId: p.myDrafts && ctx.role === 'Author' ? ctx.userId : undefined,
      page: p.page, limit: p.limit, excludeId: idParam(req.query.exclude),
    });
    const rows = found.ids.length
      ? await prisma.article.findMany({
          where: { id: { in: found.ids } },
          select: {
            id: true, title: true, slug: true, status: true, sportSlug: true, eventSlug: true, editionYear: true, articleType: true,
            excerpt: true, publishedAt: true, reviewedAt: true, scheduledFor: true, authorId: true, featuredImage: true,
            ...(!p.publicOnly ? {reviewStatus:true,reviewerId:true} as const : {}),
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
