/**
 * Site Experience API (PHASE F.1), mounted at /api/site-experience.
 *   GET    /                         all areas: draft, published, schedule, meta   Admin, Editor
 *   PUT    /:area/draft              save a draft { document }                     Admin, Editor
 *   POST   /:area/publish            publish the draft                             Admin (all); Editor (editorial areas)
 *   POST   /:area/schedule           { at } publish the draft later                 same as publish
 *   DELETE /:area/schedule           cancel a scheduled change                     same as publish
 *   POST   /:area/discard            drop unpublished changes                       Admin, Editor
 *   POST   /preview                  { enabled } preview drafts on the public site  Admin, Editor
 *
 * Navigation and footer shape the whole site, so only Admins publish them.
 * Nothing here is public: visitors only ever receive published documents,
 * rendered into pages.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { requireRole, type AuthLookup } from './auth';
import { ADMIN_ONLY_PUBLISH, SITE_AREAS, type SiteArea } from '../src/lib/siteExperience/types';
import { SITE_PREVIEW_COOKIE } from '../src/lib/siteExperience/preview';
import { areaStates, cancelSchedule, discardDraft, publish, saveDraft, schedule, SiteExperienceError } from './siteExperience';
import { createRateLimiter } from './rateLimit';

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch((err) => (err instanceof SiteExperienceError ? res.status(err.status).json({ error: err.message }) : next(err)));
};

function areaParam(req: Request, res: Response): SiteArea | null {
  const area = req.params.area as SiteArea;
  if (!SITE_AREAS.includes(area)) { res.status(404).json({ error: 'Unknown site area.' }); return null; }
  return area;
}
const onlyKeys = (body: unknown, keys: string[]) => !!body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every((k) => keys.includes(k));

export function siteExperienceRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  const staff = requireRole(getLookup, ['Admin', 'Editor']);
  const limiter = createRateLimiter(60_000, 120);
  router.use(staff, (req, res, next) => {
    if (req.method === 'GET') return next();
    const key = req.authContext!.userId;
    const limit = limiter.check(key);
    if (limit.limited) { res.setHeader('Retry-After', String(limit.retryAfterSeconds)); res.status(429).json({ error: 'Too many site changes. Try again shortly.' }); return; }
    limiter.record(key); next();
  });
  const actor = (req: Request) => ({ userId: req.authContext!.userId, userName: req.authContext!.userName });
  const canPublish = (req: Request, res: Response, area: SiteArea) => {
    if (ADMIN_ONLY_PUBLISH.includes(area) && req.authContext!.role !== 'Admin') { res.status(403).json({ error: `Only Admins can publish the ${area}.` }); return false; }
    return true;
  };

  router.get('/', staff, wrap(async (_req, res) => res.json({ areas: await areaStates() })));

  router.put('/:area/draft', staff, wrap(async (req, res) => {
    const area = areaParam(req, res); if (!area) return;
    if (!onlyKeys(req.body, ['document']) || !('document' in req.body)) return res.status(400).json({ error: 'Send { document }.' });
    await saveDraft(area, req.body.document, actor(req));
    return res.json({ areas: await areaStates() });
  }));

  router.post('/:area/publish', staff, wrap(async (req, res) => {
    const area = areaParam(req, res); if (!area || !canPublish(req, res, area)) return;
    await publish(area, actor(req));
    return res.json({ areas: await areaStates() });
  }));

  router.post('/:area/schedule', staff, wrap(async (req, res) => {
    const area = areaParam(req, res); if (!area || !canPublish(req, res, area)) return;
    if (!onlyKeys(req.body, ['at']) || typeof req.body.at !== 'string') return res.status(400).json({ error: 'Send { at } as a date/time.' });
    await schedule(area, new Date(req.body.at), actor(req));
    return res.json({ areas: await areaStates() });
  }));

  router.delete('/:area/schedule', staff, wrap(async (req, res) => {
    const area = areaParam(req, res); if (!area || !canPublish(req, res, area)) return;
    await cancelSchedule(area, actor(req));
    return res.json({ areas: await areaStates() });
  }));

  router.post('/:area/discard', staff, wrap(async (req, res) => {
    const area = areaParam(req, res); if (!area) return;
    await discardDraft(area, actor(req));
    return res.json({ areas: await areaStates() });
  }));

  router.post('/preview', staff, wrap(async (req, res) => {
    if (!onlyKeys(req.body, ['enabled']) || typeof req.body.enabled !== 'boolean') return res.status(400).json({ error: 'Send { enabled: true|false }.' });
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.append('Set-Cookie', req.body.enabled
      ? `${SITE_PREVIEW_COOKIE}=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600${secure}`
      : `${SITE_PREVIEW_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
    return res.json({ preview: req.body.enabled });
  }));

  return router;
}
