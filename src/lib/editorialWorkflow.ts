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
export interface ArticleReviewFields {
  reviewStatus?: ReviewStatus;
  reviewerId?: string | null;
  reviewComment?: string | null;
  reviewSubmittedAt?: string | null;
  reviewDecidedAt?: string | null;
  reviewVersion?: number;
}
