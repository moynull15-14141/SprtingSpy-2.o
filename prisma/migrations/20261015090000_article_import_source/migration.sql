-- Where an imported article came from (old WordPress site). Additive: one new
-- table; no existing table, row or enum changes. Removed with its article.
CREATE TABLE "ArticleImport" (
    "articleId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL DEFAULT '',
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleImport_pkey" PRIMARY KEY ("articleId")
);

CREATE UNIQUE INDEX "ArticleImport_source_sourceId_key" ON "ArticleImport"("source", "sourceId");

ALTER TABLE "ArticleImport" ADD CONSTRAINT "ArticleImport_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
