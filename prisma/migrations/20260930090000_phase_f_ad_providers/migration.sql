-- PHASE F — Monetization provider layer. Additive only: two columns on the
-- existing ad slot table. Existing slots become "house" (the sponsor banner
-- they already are); no existing value is modified.

-- AlterTable
ALTER TABLE "AdSlotConfig" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'house';
ALTER TABLE "AdSlotConfig" ADD COLUMN "providerSlotId" TEXT;
