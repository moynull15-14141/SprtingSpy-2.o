-- PHASE A — Foundation fixes (Spec v1.1). Non-destructive: no DROP, no
-- TRUNCATE, no column recreation. Every statement is safe to reason about
-- on a database that already holds real content.

-- 1. Event Edition status: "ongoing" becomes "active" (RENAME VALUE keeps
--    every existing row's value, converting ongoing rows in place) and
--    "archived" is added. upcoming/completed rows are untouched.
ALTER TYPE "EditionStatus" RENAME VALUE 'ongoing' TO 'active';
ALTER TYPE "EditionStatus" ADD VALUE IF NOT EXISTS 'archived';

-- 2. Event: official source URL and event type (both optional).
ALTER TABLE "SportEvent" ADD COLUMN IF NOT EXISTS "officialSourceUrl" TEXT;
ALTER TABLE "SportEvent" ADD COLUMN IF NOT EXISTS "eventType" TEXT;

-- 3. Article type: "Sports Viewing Guide" becomes the spec's "How to Watch".
--    Only the articleType column of matching rows changes; the WHERE clause
--    makes a re-run a no-op.
UPDATE "Article" SET "articleType" = 'How to Watch' WHERE "articleType" = 'Sports Viewing Guide';
