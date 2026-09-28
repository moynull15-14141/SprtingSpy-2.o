-- PHASE C — CMS quality & media architecture. Additive only: new nullable
-- columns, two new tables, and a UNIQUE index replacing the plain index on
-- RedirectRule.sourceUrl (existing values were verified unique first).
-- No DROP TABLE/COLUMN, no TRUNCATE, no existing value is modified except the
-- targeted featuredMediaId association at the end.

-- DropIndex
DROP INDEX "RedirectRule_sourceUrl_idx";

-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "body" JSONB,
ADD COLUMN     "featuredMediaId" TEXT;

-- AlterTable
ALTER TABLE "MediaItem" ADD COLUMN     "aiTool" TEXT,
ADD COLUMN     "copyrightReview" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN     "filename" TEXT,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "humanEditing" TEXT,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "sizeBytes" INTEGER,
ADD COLUMN     "storageKey" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3),
ADD COLUMN     "variants" JSONB,
ADD COLUMN     "width" INTEGER;

-- AlterTable
ALTER TABLE "RedirectRule" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ArticleMedia" (
    "articleId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,

    CONSTRAINT "ArticleMedia_pkey" PRIMARY KEY ("articleId","mediaId")
);

-- CreateTable
CREATE TABLE "SiteSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ArticleMedia_mediaId_idx" ON "ArticleMedia"("mediaId");

-- CreateIndex
CREATE INDEX "Article_featuredMediaId_idx" ON "Article"("featuredMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "RedirectRule_sourceUrl_key" ON "RedirectRule"("sourceUrl");

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_featuredMediaId_fkey" FOREIGN KEY ("featuredMediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleMedia" ADD CONSTRAINT "ArticleMedia_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleMedia" ADD CONSTRAINT "ArticleMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Link each article's existing featured-image URL to the Media Library item
-- with exactly that URL. Only fills empty featuredMediaId values, so a re-run
-- changes nothing. featuredImage (the URL) itself is left untouched.
UPDATE "Article" a
SET "featuredMediaId" = m."id"
FROM "MediaItem" m
WHERE m."url" = a."featuredImage"
  AND a."featuredMediaId" IS NULL
  AND (SELECT COUNT(*) FROM "MediaItem" m2 WHERE m2."url" = a."featuredImage") = 1;
