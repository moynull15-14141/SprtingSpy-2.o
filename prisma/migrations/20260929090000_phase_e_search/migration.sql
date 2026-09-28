-- PHASE E — Search. Additive only: one extension, one database-maintained
-- column and two indexes. No existing value is modified or removed.

-- Trigram matching for typo-tolerant title lookup and suggestions.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Weighted full-text document, recomputed by PostgreSQL itself on every
-- INSERT/UPDATE of the source columns, so it can never go stale.
--   A  title
--   B  subtitle, article type (category), sport, event, SEO keywords (tags)
--   C  excerpt
--   D  plain-text body projection (`content`, maintained on every save)
-- The 'english' configuration stems English words; words in other scripts
-- (e.g. Bangla) pass through unchanged as whole-word lexemes.
ALTER TABLE "Article" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english'::regconfig, coalesce("title", '')), 'A') ||
  setweight(to_tsvector('english'::regconfig,
    coalesce("subtitle", '') || ' ' ||
    coalesce("articleType", '') || ' ' ||
    replace(coalesce("sportSlug", ''), '-', ' ') || ' ' ||
    replace(coalesce("eventSlug", ''), '-', ' ') || ' ' ||
    coalesce(("seo" -> 'keywords')::text, '')
  ), 'B') ||
  setweight(to_tsvector('english'::regconfig, coalesce("excerpt", '')), 'C') ||
  setweight(to_tsvector('english'::regconfig, coalesce("content", '')), 'D')
) STORED;

-- CreateIndex
CREATE INDEX "Article_searchVector_idx" ON "Article" USING GIN ("searchVector");

-- CreateIndex
CREATE INDEX "Article_title_trgm_idx" ON "Article" USING GIN ("title" gin_trgm_ops);

-- CreateIndex (public listing/sorting by date within the visible status)
CREATE INDEX "Article_status_publishedAt_idx" ON "Article" ("status", "publishedAt");
