-- PHASE E — Search. Additive only: a trigram index so the typo-tolerant
-- fallback can match the excerpt as well as the title.

-- CreateIndex
CREATE INDEX "Article_excerpt_trgm_idx" ON "Article" USING GIN ("excerpt" gin_trgm_ops);
