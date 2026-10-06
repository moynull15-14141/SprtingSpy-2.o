/**
 * CMS Pages for public rendering (PHASE PAGES). Visitors only ever get
 * published pages; the staff preview reads any page by id (callers check the
 * viewer's role). Loaded lazily so importing this module never opens a
 * database connection (the build imports route modules without a database).
 */

import type { Page } from '../../generated/prisma/client';
import { toMediaAsset, type MediaAsset } from '../../../src/lib/media';
import type { PublicPage } from '../../../src/lib/pages';
import type { RichDoc, RichNode } from '../../../src/lib/richText';

const db = async () => (await import('../../db')).prisma;

export interface PageView { page: PublicPage; media: Record<string, MediaAsset> }

async function buildView(row: Page): Promise<PageView> {
  const prisma = await db();
  const ids = new Set<string>(row.mediaIds);
  const collect = (nodes: RichNode[] = []) => nodes.forEach((n) => {
    if (n.type === 'image' && typeof n.attrs?.mediaId === 'string') ids.add(n.attrs.mediaId);
    if (n.type === 'mediaGroup' && Array.isArray(n.attrs?.mediaIds)) (n.attrs.mediaIds as string[]).forEach((id) => ids.add(id));
    collect(n.content);
  });
  collect((row.body as unknown as RichDoc).content);
  if (row.ogMediaId) ids.add(row.ogMediaId);
  const rows = ids.size ? await prisma.mediaItem.findMany({ where: { id: { in: [...ids] } } }) : [];
  const media = Object.fromEntries(rows.map((r) => [r.id, toMediaAsset(r)]));
  const og = row.ogMediaId ? rows.find((r) => r.id === row.ogMediaId) : undefined;
  return {
    media,
    page: {
      id: row.id, slug: row.slug, title: row.title, shortTitle: row.shortTitle, summary: row.summary,
      body: row.body as unknown as RichDoc, content: row.content,
      template: row.template as PublicPage['template'], status: row.status as PublicPage['status'],
      seoTitle: row.seoTitle, seoDescription: row.seoDescription, noIndex: row.noIndex,
      ogImage: og ? toMediaAsset(og).url : null, ogImageAlt: og?.altText || null,
      updatedAt: row.updatedAt.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null,
    },
  };
}

/** The published page at /{slug}/, or null (missing or unpublished → 404). */
export async function getPublishedPage(slug: string): Promise<PageView | null> {
  if (!/^[a-z0-9-]{1,100}$/.test(slug)) return null;
  const prisma = await db();
  const row = await prisma.page.findFirst({ where: { slug, status: 'published' } });
  return row ? buildView(row) : null;
}

/** Any page by id, for the staff preview. */
export async function getPagePreview(id: string): Promise<PageView | null> {
  const prisma = await db();
  const row = await prisma.page.findUnique({ where: { id } });
  return row ? buildView(row) : null;
}
