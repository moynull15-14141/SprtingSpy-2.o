-- AlterTable
ALTER TABLE "Discipline" ADD COLUMN     "iconMediaId" TEXT;

-- CreateIndex
CREATE INDEX "Discipline_iconMediaId_idx" ON "Discipline"("iconMediaId");

-- AddForeignKey
ALTER TABLE "Discipline" ADD CONSTRAINT "Discipline_iconMediaId_fkey" FOREIGN KEY ("iconMediaId") REFERENCES "MediaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
