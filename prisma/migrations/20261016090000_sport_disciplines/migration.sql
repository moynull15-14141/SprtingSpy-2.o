-- Sport disciplines (Athletics → Running). Additive: one new table and one
-- nullable column on "SportEvent" and on "Article". No existing row, value,
-- constraint or URL changes; every existing event and article stays valid
-- with no discipline. Nothing is backfilled.
CREATE TABLE "Discipline" (
    "id" TEXT NOT NULL,
    "sportSlug" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "seo" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Discipline_pkey" PRIMARY KEY ("id")
);

-- A discipline slug is unique within its sport (two sports may both have "sprint").
CREATE UNIQUE INDEX "Discipline_sportSlug_slug_key" ON "Discipline"("sportSlug", "slug");
CREATE INDEX "Discipline_sportSlug_order_idx" ON "Discipline"("sportSlug", "order");

ALTER TABLE "SportEvent" ADD COLUMN "disciplineSlug" TEXT;
ALTER TABLE "Article" ADD COLUMN "disciplineSlug" TEXT;

CREATE INDEX "SportEvent_sportSlug_disciplineSlug_idx" ON "SportEvent"("sportSlug", "disciplineSlug");
CREATE INDEX "Article_sportSlug_disciplineSlug_status_publishedAt_idx" ON "Article"("sportSlug", "disciplineSlug", "status", "publishedAt");

-- Same natural-key convention as the rest of the schema: a sport rename
-- cascades to its disciplines; a sport that still has disciplines cannot be deleted.
ALTER TABLE "Discipline" ADD CONSTRAINT "Discipline_sportSlug_fkey" FOREIGN KEY ("sportSlug") REFERENCES "Sport"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Composite keys: the discipline must belong to the row's own sport. A NULL
-- disciplineSlug is not checked (MATCH SIMPLE), so unclassified rows are valid.
-- A discipline in use cannot be deleted; a discipline rename cascades.
ALTER TABLE "SportEvent" ADD CONSTRAINT "SportEvent_sportSlug_disciplineSlug_fkey" FOREIGN KEY ("sportSlug", "disciplineSlug") REFERENCES "Discipline"("sportSlug", "slug") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Article" ADD CONSTRAINT "Article_sportSlug_disciplineSlug_fkey" FOREIGN KEY ("sportSlug", "disciplineSlug") REFERENCES "Discipline"("sportSlug", "slug") ON DELETE RESTRICT ON UPDATE CASCADE;
