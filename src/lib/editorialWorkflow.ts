import type { Role } from '../types';

// Matches the existing article management RBAC; shared by API and CMS.
export const ARTICLE_REVIEW_ROLES: Role[] = ['Admin', 'Editor'];
export const canReviewArticles = (role: Role) => ARTICLE_REVIEW_ROLES.includes(role);
export const REVIEW_STATUSES = ['not_required', 'draft', 'in_review', 'changes_requested', 'approved'] as const;
export type ReviewStatus = typeof REVIEW_STATUSES[number];
export const REVIEW_LABELS: Record<ReviewStatus, string> = {
  not_required: 'Review not required', draft: 'Draft for review', in_review: 'Needs review',
  changes_requested: 'Changes requested', approved: 'Approved',
};
/**
 * Review state of a NEW article. An Author's article always starts in review.
 * Staff may ask for the same with `requireReview: true` for content they did
 * not write themselves (imported articles): it starts as a private draft that
 * must be submitted and approved before it can be published or scheduled.
 * The flag can only tighten the rules: it is accepted on creation only, only
 * as `true`, and never together with a publishing state.
 */
export function initialReviewStatus(role: Role, body: { requireReview?: unknown; status?: unknown; scheduledFor?: unknown }): { reviewStatus: 'draft' | 'not_required' } | { error: string } {
  if (body.requireReview !== undefined) {
    if (body.requireReview !== true) return { error: 'requireReview can only be true.' };
    if ((body.status !== undefined && body.status !== 'draft') || body.scheduledFor != null) return { error: 'An article that requires review must be created as a draft, without a publication time.' };
    return { reviewStatus: 'draft' };
  }
  return { reviewStatus: role === 'Author' ? 'draft' : 'not_required' };
}

export const IMPORT_SOURCES = ['wordpress'] as const;
export type ImportSourceName = typeof IMPORT_SOURCES[number];
export const IMPORT_SOURCE_LABELS: Record<ImportSourceName, string> = { wordpress: 'WordPress Import' };
export interface ArticleImportSource { source: ImportSourceName; sourceId: string; sourceTitle: string; sourceUrl: string }

/**
 * The origin of an imported article, sent once when it is created. It is a
 * label for editors only, and it is accepted only for an article that is also
 * created with requireReview, so marking something as imported can never be a
 * way around review.
 */
export function parseImportSource(body: { importSource?: unknown; requireReview?: unknown }): { importSource: ArticleImportSource | null } | { error: string } {
  if (body.importSource === undefined) return { importSource: null };
  const raw = body.importSource as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((k) => !['source', 'sourceId', 'sourceTitle', 'sourceUrl'].includes(k))) return { error: 'importSource must be { source, sourceId, sourceTitle, sourceUrl }.' };
  if (body.requireReview !== true) return { error: 'An imported article must be created with requireReview: true.' };
  if (!(IMPORT_SOURCES as readonly unknown[]).includes(raw.source)) return { error: `importSource.source must be one of: ${IMPORT_SOURCES.join(', ')}.` };
  if (typeof raw.sourceId !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(raw.sourceId)) return { error: 'importSource.sourceId must be the original post ID.' };
  const sourceTitle = raw.sourceTitle ?? '';
  const sourceUrl = raw.sourceUrl ?? '';
  if (typeof sourceTitle !== 'string' || sourceTitle.length > 300 || /[\u0000-\u001f\u007f]/.test(sourceTitle)) return { error: 'importSource.sourceTitle must be plain text of at most 300 characters.' };
  if (typeof sourceUrl !== 'string' || sourceUrl.length > 1000 || (sourceUrl !== '' && (!sourceUrl.startsWith('/') || sourceUrl.startsWith('//') || /[\s<>"\u0000-\u001f]/.test(sourceUrl)))) return { error: 'importSource.sourceUrl must be the old page path (starting with "/").' };
  return { importSource: { source: raw.source as ImportSourceName, sourceId: raw.sourceId, sourceTitle, sourceUrl } };
}

export interface ArticleReviewFields {
  reviewStatus?: ReviewStatus;
  reviewerId?: string | null;
  reviewComment?: string | null;
  reviewSubmittedAt?: string | null;
  reviewDecidedAt?: string | null;
  reviewVersion?: number;
}
