-- AlterTable
ALTER TABLE "MediaItem" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'image';

-- AlterTable
ALTER TABLE "Sport" ADD COLUMN     "iconMediaId" TEXT;

-- CreateIndex
CREATE INDEX "Sport_iconMediaId_idx" ON "Sport"("iconMediaId");

-- AddForeignKey
ALTER TABLE "Sport" ADD CONSTRAINT "Sport_iconMediaId_fkey" FOREIGN KEY ("iconMediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
