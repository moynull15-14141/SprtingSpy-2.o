-- Sport icon chosen by an Admin from the curated set (src/config/sportIcons.ts).
-- Additive only: one nullable column. NULL means "use the suggestion for the
-- sport's name", so every existing sport keeps rendering without a backfill.

-- AlterTable
ALTER TABLE "Sport" ADD COLUMN "icon" TEXT;
