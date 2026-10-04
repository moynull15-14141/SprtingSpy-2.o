/**
 * CMS Settings foundation (PHASE C).
 *
 * A fixed registry of allowed settings (no arbitrary keys), each with a
 * validator. Only Admins can read or change settings. Values reach public
 * pages only when marked `public` — currently just the search-engine
 * verification tokens, which are public by design. Analytics, advertising
 * and social values are stored now and wired up in their own later phases.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from './db';
import { requireRole, type AuthLookup } from './auth';
import { SETTINGS, SETTING_KEYS, type SettingKey } from './settingsRegistry';
import { forgetIndexNowKey } from './seo/indexnow';

import { invalidateTrackingConfig } from './trackingConfig';
import { recordAudit } from './audit';
import { forgetRumSetting } from './rum';
export { publicSettings } from './settingsRegistry';

export function settingsRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

  router.get('/', requireRole(getLookup, ['Admin']), wrap(async (_req, res) => {
    const rows = await prisma.siteSetting.findMany();
    const values = Object.fromEntries(rows.filter((r) => r.key in SETTINGS).map((r) => [r.key, r.value]));
    const definitions = SETTING_KEYS.map((key) => ({ key, group: SETTINGS[key].group, label: SETTINGS[key].label, public: SETTINGS[key].public, options: 'options' in SETTINGS[key] ? (SETTINGS[key] as { options: readonly string[] }).options : undefined }));
    return res.json({ values, definitions });
  }));

  // Partial update: { key: "value" } sets, { key: "" } clears. Unknown keys are rejected.
  router.put('/', requireRole(getLookup, ['Admin']), wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Send an object of settings.' });
    const entries = Object.entries(body);
    if (!entries.length) return res.status(400).json({ error: 'No settings to save.' });
    for (const [key, value] of entries) {
      if (!(key in SETTINGS)) return res.status(400).json({ error: `Unknown setting "${key}".` });
      if (typeof value !== 'string') return res.status(400).json({ error: `${key} must be text.` });
      const trimmed = value.trim();
      if (trimmed) {
        const result = SETTINGS[key as SettingKey].validate(trimmed);
        if (!result.valid) return res.status(400).json({ error: result.error });
      }
    }
    const { userId, userName } = req.authContext!;
    const previous = Object.fromEntries((await prisma.siteSetting.findMany({ where: { key: { in: entries.map(([k]) => k) } } })).map((r) => [r.key, r.value]));
    await prisma.$transaction(async (tx) => {
      for (const [key, value] of entries) {
        const trimmed = (value as string).trim();
        if (trimmed) await tx.siteSetting.upsert({ where: { key }, create: { key, value: trimmed, updatedAt: new Date(), updatedBy: userId }, update: { value: trimmed, updatedAt: new Date(), updatedBy: userId } });
        else await tx.siteSetting.deleteMany({ where: { key } });
      }
      // PHASE R: previous and new values (settings hold IDs and tokens that are public by design, no secrets).
      await recordAudit(tx, {
        userId, userName, action: 'Updated Settings', entityType: 'Setting', entityId: 'site-settings',
        details: `Admin ${userName} updated settings: ${entries.map(([k]) => k).join(', ')}.`,
        before: Object.fromEntries(entries.map(([k]) => [k, previous[k] ?? null])),
        after: Object.fromEntries(entries.map(([k, v]) => [k, (v as string).trim() || null])),
      });
    });
    forgetIndexNowKey();
    invalidateTrackingConfig();
    forgetRumSetting();
    void crypto;
    const rows = await prisma.siteSetting.findMany();
    return res.json({ values: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  }));

  return router;
}
