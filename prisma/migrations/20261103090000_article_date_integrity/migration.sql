-- Article date integrity: add createdAt and firstPublishedAt columns
-- with safe backfill from existing data.

-- 1. Add createdAt with a server default so existing rows get now().
ALTER TABLE "Article" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill createdAt from publishedAt for existing articles (better than now()).
UPDATE "Article" SET "createdAt" = "publishedAt";

-- 2. Add firstPublishedAt (nullable; drafts do not have one).
ALTER TABLE "Article" ADD COLUMN "firstPublishedAt" TIMESTAMP(3);

-- Backfill firstPublishedAt from publishedAt for already-published articles.
UPDATE "Article" SET "firstPublishedAt" = "publishedAt"
WHERE "status" IN ('published', 'archived');
