-- PHASE M — Unified search. Additive only: two database-maintained columns
-- and three indexes. No existing value is modified or removed.
--
-- Events join the same PostgreSQL full-text search Articles use (Phase E).
-- PostgreSQL recomputes each column on every INSERT/UPDATE of its sources,
-- so it can never go stale.

-- SportEvent document:
--   A  name, short name
--   B  sport and event slugs (as words), event type
--   C  default venue, default location, frequency
--   D  description, history
ALTER TABLE "SportEvent" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english'::regconfig, coalesce("name", '') || ' ' || coalesce("shortName", '')), 'A') ||
  setweight(to_tsvector('english'::regconfig,
    replace(coalesce("sportSlug", ''), '-', ' ') || ' ' ||
    replace(coalesce("slug", ''), '-', ' ') || ' ' ||
    coalesce("eventType", '')
  ), 'B') ||
  setweight(to_tsvector('english'::regconfig,
    coalesce("defaultVenue", '') || ' ' || coalesce("defaultLocation", '') || ' ' || coalesce("frequency", '')
  ), 'C') ||
  setweight(to_tsvector('english'::regconfig, coalesce("description", '') || ' ' || coalesce("history", '')), 'D')
) STORED;

-- EventEdition document (lets "french open 2027" or an edition venue find its Event):
--   A  title
--   B  year
--   C  venue, location
--   D  description
ALTER TABLE "EventEdition" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english'::regconfig, coalesce("title", '')), 'A') ||
  setweight(to_tsvector('english'::regconfig, "year"::text), 'B') ||
  setweight(to_tsvector('english'::regconfig, coalesce("venue", '') || ' ' || coalesce("location", '')), 'C') ||
  setweight(to_tsvector('english'::regconfig, coalesce("description", '')), 'D')
) STORED;

-- CreateIndex
CREATE INDEX "SportEvent_searchVector_idx" ON "SportEvent" USING GIN ("searchVector");

-- CreateIndex
CREATE INDEX "EventEdition_searchVector_idx" ON "EventEdition" USING GIN ("searchVector");

-- CreateIndex (typo-tolerant Event name matching, like Article_title_trgm_idx)
CREATE INDEX "SportEvent_name_trgm_idx" ON "SportEvent" USING GIN ("name" gin_trgm_ops);
