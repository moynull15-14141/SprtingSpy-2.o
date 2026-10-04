-- PHASE E5 — Event-scoped FAQ entries. Additive only: one nullable column,
-- one index and one foreign key. Existing rows keep eventId NULL and remain
-- on the global /faq/ page exactly as before.

-- AlterTable
ALTER TABLE "FaqEntry" ADD COLUMN "eventId" TEXT;

-- CreateIndex
CREATE INDEX "FaqEntry_eventId_status_displayOrder_idx" ON "FaqEntry"("eventId", "status", "displayOrder");

-- AddForeignKey
ALTER TABLE "FaqEntry" ADD CONSTRAINT "FaqEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SportEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
