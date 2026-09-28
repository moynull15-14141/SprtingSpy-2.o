-- PHASE F.1 — Site Experience (editorial & layout control). Additive only:
-- one new table holding one validated JSON document per site area, with
-- draft / published / scheduled versions. No existing table is modified.

-- CreateTable
CREATE TABLE "SiteExperience" (
    "area" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "scheduled" JSONB,
    "scheduledFor" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "draftUpdatedAt" TIMESTAMP(3) NOT NULL,
    "draftUpdatedBy" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,

    CONSTRAINT "SiteExperience_pkey" PRIMARY KEY ("area")
);
