/**
 * PHASE 6: small, testable rules of the Article editor (no React, no network).
 * They decide only what the editor offers; the server still enforces every workflow rule.
 */
import { REVIEW_LABELS, type ReviewStatus } from './editorialWorkflow';

type ArticleStatus = 'draft' | 'preview' | 'scheduled' | 'published' | 'archived';
const PRIVATE = new Set<string>(['draft', 'preview']);

/** URL slug from a title: a–z/0–9 words joined by hyphens, within the server's 120-character limit. */
export const slugFromTitle = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120).replace(/-+$/, '');

/** Saving a live or scheduled article as a draft takes it off the site or cancels its schedule. */
export const leavesPublicState = (savedStatus: string | undefined, nextStatus: string) =>
  nextStatus === 'draft' && (savedStatus === 'published' || savedStatus === 'scheduled');

/**
 * Preview never changes what is public or scheduled:
 * - `save`: a private (draft/preview) article, kept private, is saved first so the preview shows the edits;
 * - `saved-version`: anything else that exists opens its last saved version without saving;
 * - `save-first`: a new article whose selected state is not private must be saved explicitly first.
 */
export function previewPlan({ savedStatus, selectedStatus, hasId, readOnly }: { savedStatus?: string; selectedStatus: string; hasId: boolean; readOnly?: boolean }): 'save' | 'saved-version' | 'save-first' {
  if (readOnly) return hasId ? 'saved-version' : 'save-first';
  if (PRIVATE.has(selectedStatus) && (!savedStatus || PRIVATE.has(savedStatus))) return 'save';
  return hasId ? 'saved-version' : 'save-first';
}

/** What is saved right now (not what the "Publishing state" control is set to). */
export function savedStateLabel(article?: { status: ArticleStatus | string; reviewStatus?: ReviewStatus | string | null; scheduledFor?: string | null }): { label: string; tone: 'new' | 'private' | 'live' | 'scheduled' | 'archived' } {
  if (!article) return { label: 'New · not saved yet', tone: 'new' };
  const review = article.reviewStatus && article.reviewStatus !== 'not_required' ? ` · ${REVIEW_LABELS[article.reviewStatus as ReviewStatus] ?? article.reviewStatus}` : '';
  if (article.status === 'published') return { label: `Published · live${review}`, tone: 'live' };
  if (article.status === 'scheduled') return { label: `Scheduled${article.scheduledFor ? ` · ${new Date(article.scheduledFor).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}${review}`, tone: 'scheduled' };
  if (article.status === 'archived') return { label: `Archived${review}`, tone: 'archived' };
  return { label: `${article.status === 'preview' ? 'Preview only' : 'Draft'} · private${review}`, tone: 'private' };
}

/**
 * PHASE 6: images pasted from web pages or Word documents are free URLs, which the stored
 * format rejects (body images must come from the Media Library), so one pasted photo used to
 * block saving the whole article. They are dropped on paste; library images copied inside the
 * editor keep their mediaId and survive (unless `keepLibraryImages` is false, for text that cannot
 * contain images). Returns the cleaned HTML and how many were removed.
 */
export function stripNonLibraryImages(html: string, keepLibraryImages = true): { html: string; removed: number } {
  if (!/<img\b/i.test(html) || typeof DOMParser === 'undefined') return { html, removed: 0 };
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  let removed = 0;
  parsed.body.querySelectorAll('img').forEach((img) => {
    if (!keepLibraryImages || !/^[A-Za-z0-9_-]{1,100}$/.test(img.getAttribute('mediaid') ?? '')) { img.remove(); removed++; }
  });
  return removed ? { html: parsed.body.innerHTML, removed } : { html, removed: 0 };
}
