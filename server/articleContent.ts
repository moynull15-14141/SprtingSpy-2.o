/**
 * Article body + media handling for the article API (PHASE C).
 *
 * - `body` (rich document) is validated against the allow-list in
 *   src/lib/richText.ts; `content` is always re-derived from it as plain text.
 * - Body images and the featured image must be existing Media Library items
 *   whose copyright review is not "restricted"; their URLs come from the
 *   library, never from the client.
 * - Body image usage is recorded in ArticleMedia on every save.
 */

import type { Prisma } from './generated/prisma/client';
import { prisma } from './db';
import { docToPlainText, validateRichDoc, type RichDoc, type RichNode } from '../src/lib/richText';
import { toMediaAsset } from '../src/lib/media';
import { articlePath } from '../src/lib/paths';

type Db = Prisma.TransactionClient | typeof prisma;

export interface PreparedContent {
  data: Record<string, unknown>;
  /** Body image media ids, or undefined when the body was not part of this request. */
  bodyMediaIds?: string[];
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

export async function usableMedia(ids: string[]) {
  const rows = await prisma.mediaItem.findMany({ where: { id: { in: ids } } });
  const missing = ids.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) return { error: `Unknown media item(s): ${missing.join(', ')}.` };
  const restricted = rows.filter((r) => r.copyrightReview === 'restricted');
  if (restricted.length) return { error: `"${restricted[0].title}" is marked copyright-restricted and cannot be used.` };
  return { rows };
}

/**
 * Validates a rich-text body against the allow-list and resolves its
 * references: image URLs come from the Media Library (never the client) and
 * related-story cards from the live article. Shared by articles and Pages
 * (PHASE PAGES) so both store exactly the same safe document format.
 */
export async function prepareRichBody(input: unknown, emptyError = 'The body has no text.', allowEmpty = false): Promise<{ error: string } | { doc: RichDoc; text: string; mediaIds: string[] }> {
  const result = validateRichDoc(input);
  if (!result.ok) return { error: (result as { error: string }).error };
  const media = await usableMedia(result.mediaIds);
  if ('error' in media) return { error: media.error! };
  const byId = new Map(media.rows!.map((m) => [m.id, m]));
  const relatedIds = new Set<string>();
  const collectRelated = (nodes: RichNode[]) => nodes.forEach((n) => { if (n.type === 'relatedStory') relatedIds.add(String(n.attrs?.articleId)); if (n.content) collectRelated(n.content); });
  collectRelated(result.doc.content);
  const relatedRows = relatedIds.size ? await prisma.article.findMany({ where: { id: { in: [...relatedIds] }, status: { not: 'archived' } } }) : [];
  const relatedById = new Map(relatedRows.map((a) => [a.id, a]));
  const missingRelated = [...relatedIds].filter((id) => !relatedById.has(id));
  if (missingRelated.length) return { error: `Unknown related article(s): ${missingRelated.join(', ')}.` };
  // Image URLs always come from the library.
  const withUrls = (nodes: RichNode[]): RichNode[] =>
    nodes.map((n) =>
      n.type === 'image'
        ? { ...n, attrs: { ...n.attrs, src: toMediaAsset(byId.get(String(n.attrs?.mediaId))!).url } }
        : n.type === 'mediaGroup'
          ? { ...n, attrs: { ...n.attrs, mediaIds: (n.attrs?.mediaIds as string[]).filter((id) => byId.has(id)) } }
        : n.type === 'relatedStory'
          ? (() => { const a = relatedById.get(String(n.attrs?.articleId))!; return { ...n, attrs: { ...n.attrs, href: articlePath(a), title: a.title, category: a.articleType, date: a.publishedAt.toISOString(), image: a.featuredImage || '' } }; })()
        : n.content
          ? { ...n, content: withUrls(n.content) }
          : n
    );
  const doc: RichDoc = { ...result.doc, content: withUrls(result.doc.content) };
  const text = docToPlainText(doc);
  if (!text.trim() && !allowEmpty) return { error: emptyError };
  return { doc, text, mediaIds: result.mediaIds };
}

/** Validates body/featuredMediaId from a create/update request. Returns an error message or the data to write. */
export async function prepareArticleContent(input: Record<string, unknown>): Promise<{ error: string } | PreparedContent> {
  const data: Record<string, unknown> = {};
  let bodyMediaIds: string[] | undefined;

  if (input.body !== undefined) {
    if (input.body === null) {
      data.body = null; // revert to the legacy plain-text body
    } else {
      const prepared = await prepareRichBody(input.body, 'The article body has no text.');
      if ('error' in prepared) return { error: prepared.error };
      data.body = prepared.doc as unknown as object;
      data.content = prepared.text;
      data.readingTimeMinutes = Math.max(1, Math.ceil(words(prepared.text) / 200));
      bodyMediaIds = prepared.mediaIds;
    }
  }

  if (input.featuredMediaId !== undefined) {
    if (input.featuredMediaId === null || input.featuredMediaId === '') {
      data.featuredMediaId = null;
    } else if (typeof input.featuredMediaId !== 'string') {
      return { error: 'featuredMediaId must be a media item id.' };
    } else {
      const media = await usableMedia([input.featuredMediaId]);
      if ('error' in media) return { error: media.error! };
      data.featuredMediaId = input.featuredMediaId;
      // Keep the URL column in sync as the resolved fallback.
      data.featuredImage = toMediaAsset(media.rows![0]).url;
    }
  }

  return { data, bodyMediaIds };
}

/** Replaces the recorded body-image usage for an article. */
export async function syncBodyMedia(db: Db, articleId: string, mediaIds: string[]) {
  await db.articleMedia.deleteMany({ where: { articleId } });
  if (mediaIds.length) await db.articleMedia.createMany({ data: mediaIds.map((mediaId) => ({ articleId, mediaId })) });
}
