-- PHASE R — Requirement reconciliation (Spec v1.1 / v2.0 / v2.2).
-- Additive only. No table, column or row is dropped, except the generated
-- SportEvent.searchVector column, which PostgreSQL recomputes from existing
-- columns (it is never written by the application).
--
-- Data steps in this file, all idempotent and value-preserving:
--   1. Seed the database-backed Article Type list (both "How to Watch" and
--      "Sports Viewing Guide"), plus any type already used by an article.
--   2. Link existing Sport/Event/Edition image URLs to their Media Library item.
--   3. Relabel Media creation types to the v2.0 wording (same meaning).
--   4. Give "Sports Viewing Guide" the same type-aware SEO checks as
--      "How to Watch" in stored SEO rule settings.

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'ArticleType';
ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'Migration';
ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'Media';
ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'Integration';

-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "faqSchemaEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "after" JSONB,
ADD COLUMN     "before" JSONB;

-- AlterTable
ALTER TABLE "EventEdition" ADD COLUMN     "faqSchemaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "featuredMediaId" TEXT;

-- AlterTable
ALTER TABLE "FaqEntry" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "articleId" TEXT,
ADD COLUMN     "editionId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'editor',
ADD COLUMN     "sportId" TEXT;

-- AlterTable
ALTER TABLE "MediaItem" ADD COLUMN     "contentHash" TEXT;

-- AlterTable
ALTER TABLE "Sport" ADD COLUMN     "faqSchemaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "heroMediaId" TEXT;

-- AlterTable
ALTER TABLE "SportEvent" ADD COLUMN     "alternativeNames" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "faqSchemaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "featuredMediaId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpSecret" TEXT;

-- CreateTable
CREATE TABLE "ArticleType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "schemaType" TEXT NOT NULL DEFAULT 'Article',
    "seoProfile" TEXT NOT NULL DEFAULT 'general',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchQueryStat" (
    "day" DATE NOT NULL,
    "query" TEXT NOT NULL,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "zeroResults" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SearchQueryStat_pkey" PRIMARY KEY ("day","query")
);

-- CreateTable
CREATE TABLE "WebVitalStat" (
    "day" DATE NOT NULL,
    "pageType" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "samples" INTEGER NOT NULL DEFAULT 0,
    "good" INTEGER NOT NULL DEFAULT 0,
    "needsWork" INTEGER NOT NULL DEFAULT 0,
    "poor" INTEGER NOT NULL DEFAULT 0,
    "histogram" INTEGER[] DEFAULT ARRAY[]::INTEGER[],

    CONSTRAINT "WebVitalStat_pkey" PRIMARY KEY ("day","pageType","metric","device")
);

-- CreateTable
CREATE TABLE "PageViewStat" (
    "day" DATE NOT NULL,
    "path" TEXT NOT NULL,
    "pageType" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PageViewStat_pkey" PRIMARY KEY ("day","path")
);

-- CreateTable
CREATE TABLE "SearchPerformanceStat" (
    "source" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "dimension" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "ctr" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SearchPerformanceStat_pkey" PRIMARY KEY ("source","day","dimension","key")
);

-- CreateTable
CREATE TABLE "SearchEngineSnapshot" (
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "SearchEngineSnapshot_pkey" PRIMARY KEY ("source","kind")
);

-- CreateTable
CREATE TABLE "MigrationItem" (
    "id" TEXT NOT NULL,
    "oldUrl" TEXT NOT NULL,
    "oldCategory" TEXT NOT NULL DEFAULT '',
    "oldTitle" TEXT NOT NULL DEFAULT '',
    "decision" TEXT NOT NULL DEFAULT 'UNDECIDED',
    "newCategory" TEXT NOT NULL DEFAULT '',
    "newTitle" TEXT NOT NULL DEFAULT '',
    "newUrl" TEXT NOT NULL DEFAULT '',
    "checkStatus" TEXT NOT NULL DEFAULT 'pending',
    "validation" JSONB,
    "redirectId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "MigrationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArticleType_name_key" ON "ArticleType"("name");
CREATE UNIQUE INDEX "ArticleType_slug_key" ON "ArticleType"("slug");
CREATE INDEX "ArticleType_isActive_sortOrder_idx" ON "ArticleType"("isActive", "sortOrder");
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");
CREATE INDEX "SearchQueryStat_day_idx" ON "SearchQueryStat"("day");
CREATE INDEX "WebVitalStat_day_idx" ON "WebVitalStat"("day");
CREATE INDEX "PageViewStat_day_pageType_idx" ON "PageViewStat"("day", "pageType");
CREATE INDEX "SearchPerformanceStat_source_dimension_day_idx" ON "SearchPerformanceStat"("source", "dimension", "day");
CREATE UNIQUE INDEX "MigrationItem_oldUrl_key" ON "MigrationItem"("oldUrl");
CREATE INDEX "MigrationItem_decision_idx" ON "MigrationItem"("decision");
CREATE INDEX "MigrationItem_checkStatus_idx" ON "MigrationItem"("checkStatus");
CREATE INDEX "Article_articleType_idx" ON "Article"("articleType");
CREATE INDEX "Article_sportSlug_eventSlug_editionYear_status_publishedAt_idx" ON "Article"("sportSlug", "eventSlug", "editionYear", "status", "publishedAt");
CREATE INDEX "EventEdition_featuredMediaId_idx" ON "EventEdition"("featuredMediaId");
CREATE INDEX "FaqEntry_articleId_status_displayOrder_idx" ON "FaqEntry"("articleId", "status", "displayOrder");
CREATE INDEX "FaqEntry_editionId_status_displayOrder_idx" ON "FaqEntry"("editionId", "status", "displayOrder");
CREATE INDEX "FaqEntry_sportId_status_displayOrder_idx" ON "FaqEntry"("sportId", "status", "displayOrder");
CREATE INDEX "MediaItem_contentHash_idx" ON "MediaItem"("contentHash");
CREATE INDEX "Sport_heroMediaId_idx" ON "Sport"("heroMediaId");
CREATE INDEX "SportEvent_featuredMediaId_idx" ON "SportEvent"("featuredMediaId");

-- ── Data step 1: Article Types ──
-- The specification list (v2.0 §9.3 + v1.1 §5). "How to Watch" (v1.1) and
-- "Sports Viewing Guide" (v2.0) are BOTH kept as separate, normal types with
-- the same "viewing" SEO profile.
INSERT INTO "ArticleType" ("id", "name", "slug", "description", "sortOrder", "isActive", "isSystem", "schemaType", "seoProfile", "updatedAt") VALUES
  ('type-event-guide',          'Event Guide',          'event-guide',          'Complete guide to an event or edition.',                       10,  true, true, 'Article',     'event-guide',  CURRENT_TIMESTAMP),
  ('type-schedule',             'Schedule',             'schedule',             'Dates, sessions, fixtures and times.',                         20,  true, true, 'Article',     'schedule',     CURRENT_TIMESTAMP),
  ('type-results',              'Results',              'results',              'Outcomes, scores and standings.',                              30,  true, true, 'NewsArticle', 'results',      CURRENT_TIMESTAMP),
  ('type-how-to-watch',         'How to Watch',         'how-to-watch',         'Broadcasters, official streams, regions and viewing times (Blueprint v1.1 name).', 40, true, true, 'Article', 'viewing', CURRENT_TIMESTAMP),
  ('type-sports-viewing-guide', 'Sports Viewing Guide', 'sports-viewing-guide', 'Broadcasters, official streams, regions and viewing times (Spec v2.0 name).',     45, true, true, 'Article', 'viewing', CURRENT_TIMESTAMP),
  ('type-preview',              'Preview',              'preview',              'What to expect before an event or match.',                     50,  true, true, 'NewsArticle', 'preview',      CURRENT_TIMESTAMP),
  ('type-update',               'Update',               'update',               'A development affecting an event.',                            60,  true, true, 'NewsArticle', 'news',         CURRENT_TIMESTAMP),
  ('type-news',                 'News',                 'news',                 'News report.',                                                  70,  true, true, 'NewsArticle', 'news',         CURRENT_TIMESTAMP),
  ('type-past-winners',         'Past Winners',         'past-winners',         'Historical champions and winners.',                            80,  true, true, 'Article',     'past-winners', CURRENT_TIMESTAMP),
  ('type-records',              'Records',              'records',              'Records and statistics.',                                      90,  true, true, 'Article',     'records',      CURRENT_TIMESTAMP),
  ('type-prize-money',          'Prize Money',          'prize-money',          'Prize money totals and breakdown.',                            100, true, true, 'Article',     'prize-money',  CURRENT_TIMESTAMP),
  ('type-players',              'Players',              'players',              'Players and participants.',                                    110, true, true, 'Article',     'players',      CURRENT_TIMESTAMP),
  ('type-teams',                'Teams',                'teams',                'Teams and squads.',                                            120, true, true, 'Article',     'teams',        CURRENT_TIMESTAMP),
  ('type-venue',                'Venue',                'venue',                'Venue guide.',                                                 130, true, true, 'Article',     'venue',        CURRENT_TIMESTAMP),
  ('type-qualification',        'Qualification',        'qualification',        'How to qualify and entry criteria.',                           140, true, true, 'Article',     'qualification', CURRENT_TIMESTAMP),
  ('type-rules-format',         'Rules & Format',       'rules-format',         'Rules, scoring and competition format.',                       150, true, true, 'Article',     'rules-format', CURRENT_TIMESTAMP),
  ('type-history',              'History',              'history',              'History and heritage.',                                        160, true, true, 'Article',     'history',      CURRENT_TIMESTAMP),
  ('type-analysis',             'Analysis',             'analysis',             'Analysis and opinion.',                                        170, true, true, 'Article',     'analysis',     CURRENT_TIMESTAMP),
  ('type-general-information',  'General Information',  'general-information',  'General sports information.',                                 180, true, true, 'Article',     'general',      CURRENT_TIMESTAMP),
  ('type-other',                'Other',                'other',                'Anything that fits no other type.',                            190, true, true, 'Article',     'general',      CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

-- Any other type already stored on an article is preserved as a custom
-- (inactive) type so the foreign key below never rejects existing data.
INSERT INTO "ArticleType" ("id", "name", "slug", "description", "sortOrder", "isActive", "isSystem", "schemaType", "seoProfile", "updatedAt")
SELECT 'type-legacy-' || md5(a."articleType"), a."articleType",
       'legacy-' || substr(md5(a."articleType"), 1, 12),
       'Kept from existing articles during the Phase R migration.', 1000, false, false, 'Article', 'general', CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "articleType" FROM "Article") a
WHERE NOT EXISTS (SELECT 1 FROM "ArticleType" t WHERE t."name" = a."articleType");

-- AddForeignKey
ALTER TABLE "Sport" ADD CONSTRAINT "Sport_heroMediaId_fkey" FOREIGN KEY ("heroMediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SportEvent" ADD CONSTRAINT "SportEvent_featuredMediaId_fkey" FOREIGN KEY ("featuredMediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventEdition" ADD CONSTRAINT "EventEdition_featuredMediaId_fkey" FOREIGN KEY ("featuredMediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Article" ADD CONSTRAINT "Article_articleType_fkey" FOREIGN KEY ("articleType") REFERENCES "ArticleType"("name") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FaqEntry" ADD CONSTRAINT "FaqEntry_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FaqEntry" ADD CONSTRAINT "FaqEntry_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "EventEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FaqEntry" ADD CONSTRAINT "FaqEntry_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An FAQ entry belongs to at most one context (v2.2 FAQ & Reader Questions).
ALTER TABLE "FaqEntry" ADD CONSTRAINT "FaqEntry_single_context" CHECK (num_nonnulls("eventId", "articleId", "editionId", "sportId") <= 1);

-- ── Data step 2: link existing entity images to the Media Library ──
UPDATE "Sport" s SET "heroMediaId" = m."id"
FROM (SELECT DISTINCT ON ("url") "id", "url" FROM "MediaItem" ORDER BY "url", "uploadedAt" ASC, "id" ASC) m
WHERE s."heroMediaId" IS NULL AND s."heroImage" = m."url";

UPDATE "SportEvent" e SET "featuredMediaId" = m."id"
FROM (SELECT DISTINCT ON ("url") "id", "url" FROM "MediaItem" ORDER BY "url", "uploadedAt" ASC, "id" ASC) m
WHERE e."featuredMediaId" IS NULL AND e."featuredImage" = m."url";

UPDATE "EventEdition" ed SET "featuredMediaId" = m."id"
FROM (SELECT DISTINCT ON ("url") "id", "url" FROM "MediaItem" ORDER BY "url", "uploadedAt" ASC, "id" ASC) m
WHERE ed."featuredMediaId" IS NULL AND ed."featuredImage" = m."url";

-- ── Data step 3: Media creation types, v2.0 §18.3 wording (same meaning) ──
UPDATE "MediaItem" SET "creationType" = 'SportingSpy Original' WHERE "creationType" = 'Original';
UPDATE "MediaItem" SET "creationType" = 'SportingSpy AI-Created' WHERE "creationType" = 'AI-created';
UPDATE "MediaItem" SET "creationType" = 'SportingSpy AI-Assisted/Edited' WHERE "creationType" = 'AI-assisted';
ALTER TABLE "MediaItem" ALTER COLUMN "creationType" SET DEFAULT 'SportingSpy Original';

-- ── Data step 4: SEO rule settings — "Sports Viewing Guide" gets the same
-- checks as "How to Watch" wherever an editor-stored setting lists types. ──
UPDATE "SeoRule" SET "articleTypes" = array_append("articleTypes", 'Sports Viewing Guide'), "updatedAt" = CURRENT_TIMESTAMP, "version" = "version" + 1
WHERE 'How to Watch' = ANY("articleTypes") AND NOT ('Sports Viewing Guide' = ANY("articleTypes"));

UPDATE "SeoRule" SET "config" = jsonb_set("config", '{byType,Sports Viewing Guide}', "config"->'byType'->'How to Watch'), "updatedAt" = CURRENT_TIMESTAMP, "version" = "version" + 1
WHERE "config" ? 'byType' AND ("config"->'byType') ? 'How to Watch' AND NOT (("config"->'byType') ? 'Sports Viewing Guide');

UPDATE "SeoRule" SET "config" = jsonb_set("config", '{requireEvent}', ("config"->'requireEvent') || '["Sports Viewing Guide"]'::jsonb), "updatedAt" = CURRENT_TIMESTAMP, "version" = "version" + 1
WHERE "key" = 'relationships' AND ("config"->'requireEvent') ? 'How to Watch' AND NOT (("config"->'requireEvent') ? 'Sports Viewing Guide');

UPDATE "SeoRule" SET "config" = jsonb_set("config", '{requireEdition}', ("config"->'requireEdition') || '["Sports Viewing Guide"]'::jsonb), "updatedAt" = CURRENT_TIMESTAMP, "version" = "version" + 1
WHERE "key" = 'relationships' AND ("config"->'requireEdition') ? 'How to Watch' AND NOT (("config"->'requireEdition') ? 'Sports Viewing Guide');

-- ── Event search: alternative names join the "A" weight ──
DROP INDEX IF EXISTS "SportEvent_searchVector_idx";
ALTER TABLE "SportEvent" DROP COLUMN "searchVector";
ALTER TABLE "SportEvent" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english'::regconfig, coalesce("name", '') || ' ' || coalesce("shortName", '') || ' ' || coalesce("alternativeNames", '')), 'A') ||
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
CREATE INDEX "SportEvent_searchVector_idx" ON "SportEvent" USING GIN ("searchVector");
-- Typo-tolerant matching on alternative names (like SportEvent_name_trgm_idx).
CREATE INDEX "SportEvent_alternativeNames_trgm_idx" ON "SportEvent" USING GIN ("alternativeNames" gin_trgm_ops);
