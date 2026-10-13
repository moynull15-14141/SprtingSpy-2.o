-- A group's own landing-page settings (model "Discipline"): tagline, icon,
-- header image (Media Library) and featured events, as on "Sport".
-- Additive: five columns with safe defaults or NULL, one index, one foreign
-- key. No existing row, value or constraint changes; existing groups keep
-- working with no tagline, icon, image or featured events.
ALTER TABLE "Discipline" ADD COLUMN "tagline" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Discipline" ADD COLUMN "icon" TEXT;
ALTER TABLE "Discipline" ADD COLUMN "heroImage" TEXT;
ALTER TABLE "Discipline" ADD COLUMN "heroMediaId" TEXT;
ALTER TABLE "Discipline" ADD COLUMN "featuredEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "Discipline_heroMediaId_idx" ON "Discipline"("heroMediaId");

-- Same rule as a sport's image: a Media Library item in use cannot be deleted.
ALTER TABLE "Discipline" ADD CONSTRAINT "Discipline_heroMediaId_fkey" FOREIGN KEY ("heroMediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
