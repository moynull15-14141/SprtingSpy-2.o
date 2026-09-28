CREATE TABLE "AdCreative" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "durationSeconds" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdCreative_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdCreative_storageKey_key" ON "AdCreative"("storageKey");
ALTER TABLE "AdSlotConfig" ADD COLUMN "creativeId" TEXT,
  ADD COLUMN "creativeAlt" TEXT,
  ADD COLUMN "creativeFit" TEXT NOT NULL DEFAULT 'contain';
ALTER TABLE "AdSlotConfig" ADD CONSTRAINT "AdSlotConfig_creativeId_fkey"
  FOREIGN KEY ("creativeId") REFERENCES "AdCreative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
