/**
 * Media service (PHASE C): the only code that combines processing, storage
 * and the MediaItem table. Routes call this; nothing else touches storage.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db';
import type { Prisma } from '../generated/prisma/client';
import { mediaStorage } from './storage';
import { processUpload } from './processing';
import { mediaUrl, type MediaVariant } from '../../src/lib/media';
import { introMediaReferences } from '../../src/lib/siteExperience/intro';

export const COPYRIGHT_REVIEW_STATES = ['pending', 'reviewed', 'restricted'] as const;

export interface MediaMetadataInput {
  title: string;
  altText?: string;
  caption?: string;
  credit?: string;
  source?: string;
  license?: string;
  creationType?: string;
  aiTool?: string;
  humanEditing?: string;
}

/** Processes and stores an image, returning the storage fields for a MediaItem. */
async function storeImage(data: Buffer, originalName: string, declaredMime: string) {
  const image = await processUpload(data, originalName, declaredMime);
  const storage = mediaStorage();
  const now = new Date();
  const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}`;
  const written: string[] = [];
  try {
    const originalKey = `${folder}/original.${image.ext}`;
    await storage.put(originalKey, image.original, image.mime);
    written.push(originalKey);
    const variants: MediaVariant[] = [];
    for (const v of image.variants) {
      const key = `${folder}/w${v.width}.${v.ext}`;
      await storage.put(key, v.data, `image/${v.format}`);
      written.push(key);
      variants.push({ width: v.width, height: v.height, format: v.format, key, bytes: v.data.length });
    }
    return {
      storageKey: originalKey,
      url: mediaUrl(originalKey),
      mimeType: image.mime,
      width: image.width,
      height: image.height,
      sizeBytes: image.original.length,
      variants,
      written,
    };
  } catch (err) {
    await Promise.all(written.map((key) => storage.delete(key).catch(() => undefined)));
    throw err;
  }
}

/** A safe display filename: the base name only, printable characters, length-capped. */
function displayFilename(name: string): string {
  return path.basename(name).replace(/[^\w.\- ()]/g, '_').slice(0, 200) || 'upload';
}

/** PHASE R (Spec §18.2 duplicate detection): SHA-256 of the uploaded bytes. */
export const contentHashOf = (buffer: Buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/** An existing library item with exactly the same file, if any. */
export async function findDuplicateMedia(buffer: Buffer) {
  return prisma.mediaItem.findFirst({ where: { contentHash: contentHashOf(buffer) }, select: { id: true, title: true, url: true }, orderBy: { uploadedAt: 'asc' } });
}

/** The upload is a byte-identical copy of an existing library item. */
export class DuplicateMedia extends Error {
  constructor(readonly duplicateOf: { id: string; title: string; url: string }) {
    super(`This exact image is already in the Media Library as "${duplicateOf.title}". Use that item, or upload again and confirm a duplicate copy.`);
  }
}

export async function createMediaFromUpload(file: { buffer: Buffer; originalname: string; mimetype: string }, meta: MediaMetadataInput, options: { rejectDuplicates?: boolean } = {}) {
  const contentHash = contentHashOf(file.buffer);
  // Validation/processing first (format errors win), then the duplicate check.
  const stored = await storeImage(file.buffer, file.originalname, file.mimetype);
  if (options.rejectDuplicates) {
    const duplicate = await findDuplicateMedia(file.buffer);
    if (duplicate) {
      await Promise.all(stored.written.map((key) => mediaStorage().delete(key).catch(() => undefined)));
      throw new DuplicateMedia(duplicate);
    }
  }
  try {
    return await prisma.mediaItem.create({
      data: {
        id: `media-${crypto.randomUUID()}`,
        title: meta.title,
        url: stored.url,
        altText: meta.altText || '',
        caption: meta.caption || null,
        credit: meta.credit || null,
        source: meta.source || null,
        license: meta.license || null,
        creationType: meta.creationType || 'SportingSpy Original',
        aiTool: meta.aiTool || null,
        humanEditing: meta.humanEditing || null,
        copyrightReview: 'pending',
        uploadedAt: new Date(),
        updatedAt: new Date(),
        filename: displayFilename(file.originalname),
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        width: stored.width,
        height: stored.height,
        sizeBytes: stored.sizeBytes,
        variants: stored.variants as unknown as object,
        fileSize: `${Math.round(stored.sizeBytes / 1024)} KB`,
        dimensions: `${stored.width}x${stored.height}`,
        contentHash,
      },
    });
  } catch (err) {
    await Promise.all(stored.written.map((key) => mediaStorage().delete(key).catch(() => undefined)));
    throw err;
  }
}

export type MediaUsage = { kind: 'article' | 'event' | 'edition' | 'sport' | 'site'; id: string; title: string; role: 'featured' | 'body' | 'image' };

/**
 * Where each media item is used: article featured images and body images
 * (relations), plus sport/event/edition images that reference its URL.
 */
export async function mediaUsageMap(options: {articleWhere?: Prisma.ArticleWhereInput; publicSiteOnly?: boolean} = {}): Promise<Record<string, MediaUsage[]>> {
  const [media, featured, body, sports, events, editions, site] = await Promise.all([
    prisma.mediaItem.findMany({ select: { id: true, url: true } }),
    prisma.article.findMany({ where: { AND: [{ featuredMediaId: { not: null } }, options.articleWhere ?? {}] }, select: { id: true, title: true, featuredMediaId: true } }),
    prisma.articleMedia.findMany({ where: { article: options.articleWhere ?? {} }, select: { mediaId: true, article: { select: { id: true, title: true } } } }),
    prisma.sport.findMany({ where: { heroImage: { not: null } }, select: { id: true, name: true, heroImage: true } }),
    prisma.sportEvent.findMany({ where: { featuredImage: { not: null } }, select: { id: true, name: true, featuredImage: true } }),
    prisma.eventEdition.findMany({ select: { id: true, title: true, featuredImage: true } }),
    prisma.siteExperience.findUnique({ where: { area: 'homepage' }, select: { draft: true, published: true, scheduled: true } }),
  ]);
  const byUrl = new Map(media.map((m) => [m.url, m.id]));
  const map: Record<string, MediaUsage[]> = Object.fromEntries(media.map((m) => [m.id, []]));
  for (const a of featured) map[a.featuredMediaId!]?.push({ kind: 'article', id: a.id, title: a.title, role: 'featured' });
  for (const u of body) map[u.mediaId]?.push({ kind: 'article', id: u.article.id, title: u.article.title, role: 'body' });
  const byRef = (kind: MediaUsage['kind'], id: string, title: string, url: string | null) => {
    const mediaId = url ? byUrl.get(url) : undefined;
    if (mediaId) map[mediaId].push({ kind, id, title, role: 'image' });
  };
  sports.forEach((s) => byRef('sport', s.id, s.name, s.heroImage));
  events.forEach((e) => byRef('event', e.id, e.name, e.featuredImage));
  editions.forEach((e) => byRef('edition', e.id, e.title, e.featuredImage));
  if (site) for (const state of ['draft', 'published', 'scheduled'] as const) {
    if (options.publicSiteOnly && state !== 'published') continue;
    for (const ref of introMediaReferences(site[state])) map[ref.mediaId]?.push({ kind: 'site', id: `homepage:${state}:${ref.id}`, title: `Homepage ${state}: ${ref.title}`, role: 'image' });
  }
  return map;
}

/** Deletes a media item and its stored files. Refuses while anything uses it. */
export async function deleteMedia(id: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const item = await prisma.mediaItem.findUnique({ where: { id } });
  if (!item) return { ok: false, status: 404, error: 'Media item not found.' };
  const usage = (await mediaUsageMap())[id] || [];
  if (usage.length) {
    return { ok: false, status: 409, error: `This image is in use (${usage.length} place(s), e.g. ${usage[0].kind} "${usage[0].title}"). Remove it from that content first.` };
  }
  await prisma.mediaItem.delete({ where: { id } });
  const keys = [item.storageKey, ...((item.variants as unknown as MediaVariant[] | null) || []).map((v) => v.key)].filter((k): k is string => !!k);
  await Promise.all(keys.map((key) => mediaStorage().delete(key).catch(() => undefined)));
  return { ok: true };
}

/**
 * One-time processing of legacy media rows whose URL points at a bundled
 * file under /src/assets/images. Adds the processed original + responsive
 * variants and real dimensions; the row's URL is left unchanged, so every
 * existing reference keeps working. Idempotent (skips processed rows).
 */
export async function importLegacyMedia(): Promise<{ processed: string[]; skipped: string[] }> {
  const processed: string[] = [];
  const skipped: string[] = [];
  const rows = await prisma.mediaItem.findMany({ where: { storageKey: null } });
  for (const row of rows) {
    const match = row.url.match(/^\/src\/assets\/images\/([A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp))$/);
    if (!match) { skipped.push(`${row.id} (not a bundled asset URL)`); continue; }
    const file = path.resolve('src/assets/images', match[1]);
    let data: Buffer;
    try { data = await fs.readFile(file); } catch { skipped.push(`${row.id} (file missing)`); continue; }
    const ext = match[1].split('.').pop()!.toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const stored = await storeImage(data, match[1], mime);
    await prisma.mediaItem.update({
      where: { id: row.id },
      data: {
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        width: stored.width,
        height: stored.height,
        sizeBytes: stored.sizeBytes,
        variants: stored.variants as unknown as object,
        filename: row.filename || match[1],
        updatedAt: new Date(),
      },
    });
    processed.push(row.id);
  }
  return { processed, skipped };
}
