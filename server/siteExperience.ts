/**
 * Site Experience service (PHASE F.1). One code path for the CMS API and the
 * public pages. Documents are validated on every write AND every read: a
 * stored document that no longer validates is replaced by the built-in
 * default for that area, so a configuration problem never breaks the site.
 */

import crypto from 'node:crypto';
import { prisma } from './db';
import { DEFAULT_SITE_EXPERIENCE } from '../src/lib/siteExperience/defaults';
import { checkDocument } from '../src/lib/siteExperience/validate';
import { sameDocument } from '../src/lib/siteExperience/compare';
import { introMediaReferences } from '../src/lib/siteExperience/intro';
import { SITE_AREAS, type SiteArea, type SiteExperienceDocs } from '../src/lib/siteExperience/types';

export type AreaState = {
  area: SiteArea;
  draft: unknown;
  published: unknown | null;
  scheduled: unknown | null;
  scheduledFor: string | null;
  version: number;
  draftUpdatedAt: string | null;
  draftUpdatedBy: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  /** True when the draft differs from what visitors currently see. */
  hasDraftChanges: boolean;
  /** True when the live document is the built-in default (never published). */
  usingDefaults: boolean;
};


export async function areaStates(): Promise<AreaState[]> {
  const rows = await prisma.siteExperience.findMany();
  return SITE_AREAS.map((area) => {
    const row = rows.find((r) => r.area === area);
    const live = row?.published ?? DEFAULT_SITE_EXPERIENCE[area];
    const draft = row?.draft ?? live;
    return {
      area, draft, published: row?.published ?? null, scheduled: row?.scheduled ?? null,
      scheduledFor: row?.scheduledFor?.toISOString() ?? null, version: row?.version ?? 0,
      draftUpdatedAt: row?.draftUpdatedAt.toISOString() ?? null, draftUpdatedBy: row?.draftUpdatedBy ?? null,
      publishedAt: row?.publishedAt?.toISOString() ?? null, publishedBy: row?.publishedBy ?? null,
      hasDraftChanges: !sameDocument(draft, live), usingDefaults: !row?.published,
    };
  });
}

/** Documents visitors (or a previewing editor) should see right now. */
export async function effectiveDocuments(options: { preview?: boolean } = {}): Promise<SiteExperienceDocs> {
  let rows: Awaited<ReturnType<typeof prisma.siteExperience.findMany>> = [];
  try { rows = await prisma.siteExperience.findMany(); } catch { /* database trouble: defaults keep the site up */ }
  const now = Date.now();
  const out = {} as Record<SiteArea, unknown>;
  for (const area of SITE_AREAS) {
    const row = rows.find((r) => r.area === area);
    const candidate = !row ? null
      : options.preview ? row.draft
      : row.scheduled && row.scheduledFor && row.scheduledFor.getTime() <= now ? row.scheduled
      : row.published;
    const checked = candidate == null ? null : checkDocument(area, candidate);
    if (checked && !checked.ok) console.error(`[SiteExperience] Stored ${area} document is invalid; serving defaults. (${checked.error.split(':')[0]})`);
    out[area] = checked?.ok ? checked.value : DEFAULT_SITE_EXPERIENCE[area];
  }
  return out as SiteExperienceDocs;
}

/** Article ids a document depends on (must be public when published). */
export function referencedArticleIds(area: SiteArea, doc: unknown): string[] {
  const d = doc as SiteExperienceDocs[SiteArea];
  if (area === 'homepage') return (d as SiteExperienceDocs['homepage']).sections.flatMap((s) => ('source' in s ? s.source.articleIds : []));
  if (area === 'announcements') return (d as SiteExperienceDocs['announcements']).items.map((a) => a.articleId).filter(Boolean);
  if (area === 'blocks') return (d as SiteExperienceDocs['blocks']).items.map((b) => b.articleId).filter(Boolean);
  return [];
}

/** Ids from `ids` that are NOT currently publicly visible articles. */
export async function unavailableArticles(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { _publishedArticleWhere } = await import('./services/public/content');
  const ok = await prisma.article.findMany({ where: await _publishedArticleWhere({ id: { in: ids } }), select: { id: true } });
  const found = new Set(ok.map((a) => a.id));
  return [...new Set(ids)].filter((id) => !found.has(id));
}

type Actor = { userId: string; userName: string };
async function audit(actor: Actor, action: string, area: SiteArea, details: string) {
  await prisma.auditLog.create({ data: { id: `log-${crypto.randomUUID()}`, userId: actor.userId, userName: actor.userName, action, entityType: 'Setting', entityId: `site-experience:${area}`, timestamp: new Date(), details } });
}

export class SiteExperienceError extends Error { constructor(message: string, public status = 400) { super(message); } }

async function checkIntroImages(area: SiteArea, doc: unknown) {
  if (area !== 'homepage') return;
  const ids = [...new Set(introMediaReferences(doc).map((s) => s.mediaId))];
  if (!ids.length) return;
  const images = await prisma.mediaItem.findMany({ where: { id: { in: ids }, copyrightReview: { not: 'restricted' } }, select: { id: true } });
  if (images.length !== ids.length) throw new SiteExperienceError('A banner image is missing or copyright-restricted. Choose another image from Media Library.');
}

export async function saveDraft(area: SiteArea, doc: unknown, actor: Actor) {
  const checked = checkDocument(area, doc);
  if (!checked.ok) throw new SiteExperienceError(checked.error);
  await checkIntroImages(area, checked.value);
  const now = new Date();
  await prisma.siteExperience.upsert({
    where: { area },
    create: { area, draft: checked.value as object, draftUpdatedAt: now, draftUpdatedBy: actor.userName },
    update: { draft: checked.value as object, draftUpdatedAt: now, draftUpdatedBy: actor.userName },
  });
  await audit(actor, 'Site Experience: Draft Saved', area, `${actor.userName} saved a draft of the ${area} configuration.`);
}

async function readyDraft(area: SiteArea) {
  const row = await prisma.siteExperience.findUnique({ where: { area } });
  if (!row) throw new SiteExperienceError('There is no draft to publish. Save a draft first.');
  const checked = checkDocument(area, row.draft);
  if (!checked.ok) throw new SiteExperienceError(checked.error);
  const missing = await unavailableArticles(referencedArticleIds(area, checked.value));
  if (missing.length) throw new SiteExperienceError(`These selected articles are not published or not public: ${missing.join(', ')}. Replace them before publishing.`);
  await checkIntroImages(area, checked.value);
  return { row, doc: checked.value };
}

export async function publish(area: SiteArea, actor: Actor) {
  const { row, doc } = await readyDraft(area);
  await prisma.$transaction(async (tx) => {
    const result = await tx.siteExperience.updateMany({ where: { area, version: row.version, draftUpdatedAt: row.draftUpdatedAt }, data: { published: doc as object, scheduled: Prisma.DbNull, scheduledFor: null, version: { increment: 1 }, publishedAt: new Date(), publishedBy: actor.userName } });
    if (!result.count) throw new SiteExperienceError('Configuration changed while publishing. Reload and review the latest draft.', 409);
    await tx.auditLog.create({ data: { id: `log-${crypto.randomUUID()}`, userId: actor.userId, userName: actor.userName, action: 'Site Experience: Published', entityType: 'Setting', entityId: `site-experience:${area}`, timestamp: new Date(), details: `${actor.userName} published version ${row.version + 1} of the ${area} configuration.` } });
  });
}

export async function schedule(area: SiteArea, at: Date, actor: Actor) {
  if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now() + 30_000) throw new SiteExperienceError('Choose a time in the future.');
  if (at.getTime() > Date.now() + 366 * 86400000) throw new SiteExperienceError('Schedule at most a year ahead.');
  const { row, doc } = await readyDraft(area);
  const result = await prisma.siteExperience.updateMany({ where: { area, version: row.version, draftUpdatedAt: row.draftUpdatedAt }, data: { scheduled: doc as object, scheduledFor: at } });
  if (!result.count) throw new SiteExperienceError('Configuration changed while scheduling. Reload and review the latest draft.', 409);
  await audit(actor, 'Site Experience: Scheduled', area, `${actor.userName} scheduled the ${area} configuration for ${at.toISOString()}.`);
}

export async function cancelSchedule(area: SiteArea, actor: Actor) {
  await prisma.siteExperience.updateMany({ where: { area }, data: { scheduled: Prisma.DbNull, scheduledFor: null } });
  await audit(actor, 'Site Experience: Schedule Cancelled', area, `${actor.userName} cancelled the scheduled ${area} change.`);
}

export async function discardDraft(area: SiteArea, actor: Actor) {
  const row = await prisma.siteExperience.findUnique({ where: { area } });
  if (!row) return;
  await prisma.siteExperience.update({ where: { area }, data: { draft: (row.published ?? DEFAULT_SITE_EXPERIENCE[area]) as object, draftUpdatedAt: new Date(), draftUpdatedBy: actor.userName } });
  await audit(actor, 'Site Experience: Draft Discarded', area, `${actor.userName} discarded unpublished ${area} changes.`);
}

/** Scheduler tick: make due scheduled documents the published version. */
export async function applyDueSchedules(): Promise<number> {
  const due = await prisma.siteExperience.findMany({ where: { scheduledFor: { lte: new Date() } } });
  let applied = 0;
  for (const row of due) {
    if (!row.scheduled || !SITE_AREAS.includes(row.area as SiteArea)) continue;
    const checked = checkDocument(row.area as SiteArea, row.scheduled);
    if (!checked.ok) { console.error(`[SiteExperience] Invalid scheduled ${row.area} document; publication skipped.`); continue; }
    applied += await prisma.$transaction(async (tx) => {
      // A competing tick/publish/cancellation must not apply the same snapshot twice.
      const result = await tx.siteExperience.updateMany({ where: { area: row.area, version: row.version, scheduledFor: row.scheduledFor, scheduled: { equals: row.scheduled } }, data: { published: checked.value as object, scheduled: Prisma.DbNull, scheduledFor: null, version: { increment: 1 }, publishedAt: new Date(), publishedBy: 'Scheduler' } });
      if (!result.count) return 0;
      await tx.auditLog.create({ data: { id: `log-${crypto.randomUUID()}`, userId: 'system', userName: 'Scheduler', action: 'Site Experience: Scheduled Publish', entityType: 'Setting', entityId: `site-experience:${row.area}`, timestamp: new Date(), details: `Scheduled ${row.area} configuration went live (version ${row.version + 1}).` } });
      return 1;
    });
  }
  return applied;
}

import { Prisma } from './generated/prisma/client';
