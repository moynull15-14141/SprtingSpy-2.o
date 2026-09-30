/** E2 staff configuration API. No duplicate Event endpoint or CMS screen. */
import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { Prisma } from './generated/prisma/client';
import { prisma } from './db';
import { requireRole, type AuthLookup } from './auth';
import { existingValuesCompatible, parseSportEventConfiguration, resolveSportEventConfiguration } from './sportEventConfiguration';

export function sportEventConfigurationRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

  router.get('/:slug/event-configuration', requireRole(getLookup, ['Admin', 'Editor']), wrap(async (req, res) => {
    const sport = await prisma.sport.findUnique({ where: { slug: req.params.slug }, select: { slug: true, eventConfiguration: true } });
    if (!sport) return res.status(404).json({ error: 'Sport not found.' });
    const parsed = sport.eventConfiguration === null ? null : parseSportEventConfiguration(sport.eventConfiguration);
    return res.json({ sportSlug: sport.slug, configuration: parsed?.ok ? parsed.value : null, resolved: resolveSportEventConfiguration(sport.eventConfiguration), ...(parsed && !parsed.ok ? { error: 'Stored configuration is invalid; generic fallback is active.' } : {}) });
  }));

  router.put('/:slug/event-configuration', requireRole(getLookup, ['Admin']), wrap(async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'configuration')) {
      return res.status(400).json({ error: 'Send only a configuration property (object or null).' });
    }
    const parsed = req.body.configuration === null ? null : parseSportEventConfiguration(req.body.configuration);
    if (parsed && 'error' in parsed) return res.status(400).json({ error: parsed.error });
    const config = parsed && 'value' in parsed ? parsed.value : null;
    const proposed = resolveSportEventConfiguration(config);
    const result = await prisma.$transaction(async (tx) => {
      // Serialize configuration edits for this Sport. Existing Event values are checked in the same transaction.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Sport" WHERE "slug" = ${req.params.slug} FOR UPDATE`;
      if (!locked.length) return { status: 404 as const, error: 'Sport not found.' };
      const values = await tx.sportEvent.findMany({ where: { sportSlug: req.params.slug }, select: { sportSpecificValues: true } });
      for (const row of values) {
        const incompatibility = existingValuesCompatible(row.sportSpecificValues, proposed);
        if (incompatibility) return { status: 409 as const, error: incompatibility };
      }
      await tx.sport.update({ where: { id: locked[0].id }, data: { eventConfiguration: config === null ? Prisma.DbNull : config as unknown as Prisma.InputJsonValue } });
      await tx.auditLog.create({ data: {
        id: `log-${crypto.randomUUID()}`, userId: req.authContext!.userId, userName: req.authContext!.userName,
        action: 'Updated Sport Event Configuration', entityType: 'Sport', entityId: locked[0].id,
        timestamp: new Date(), details: `${req.authContext!.userName} ${parsed === null ? 'cleared' : 'updated'} Event configuration for ${req.params.slug}.`,
      } });
      return { status: 200 as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    return res.json({ sportSlug: req.params.slug, configuration: config, resolved: proposed });
  }));

  return router;
}
