-- Additive review metadata. Existing publication status/content stays intact.
CREATE TYPE "ArticleReviewStatus" AS ENUM ('not_required', 'draft', 'in_review', 'changes_requested', 'approved');
ALTER TABLE "Article"
  ADD COLUMN "reviewStatus" "ArticleReviewStatus" NOT NULL DEFAULT 'not_required',
  ADD COLUMN "reviewerId" TEXT,
  ADD COLUMN "reviewComment" TEXT,
  ADD COLUMN "reviewSubmittedAt" TIMESTAMP(3),
  ADD COLUMN "reviewDecidedAt" TIMESTAMP(3),
  ADD COLUMN "reviewVersion" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "Article_reviewStatus_reviewerId_idx" ON "Article"("reviewStatus", "reviewerId");
ALTER TABLE "Article" ADD CONSTRAINT "Article_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
