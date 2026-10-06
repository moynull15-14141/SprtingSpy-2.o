-- PHASE AUTOSAVE — server-side editor working copies (autosave + recovery).
-- Additive only: one new table with its indexes, one foreign key to "User"
-- and two CHECK constraints. No existing table, column, row, enum or
-- migration is modified. Working copies are never public and never a
-- publishing state; live content changes only through the existing
-- Article/Event/Edition/Page endpoints.
--
-- UNIQUE("kind", "entityId") allows one shared working copy per existing
-- item; PostgreSQL treats NULLs as distinct, so drafts of new content
-- (entityId NULL, private to their owner) are not limited by it.

-- CreateTable
CREATE TABLE "EditorDraft" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entityId" TEXT,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "baseVersion" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "mediaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditorDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EditorDraft_ownerId_idx" ON "EditorDraft"("ownerId");

-- CreateIndex
CREATE INDEX "EditorDraft_updatedAt_idx" ON "EditorDraft"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EditorDraft_kind_entityId_key" ON "EditorDraft"("kind", "entityId");

-- AddForeignKey
ALTER TABLE "EditorDraft" ADD CONSTRAINT "EditorDraft_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Closed set of editor kinds, and a positive revision (enforced by the API; also here).
ALTER TABLE "EditorDraft" ADD CONSTRAINT "EditorDraft_kind_check" CHECK ("kind" IN ('article', 'event', 'edition', 'page'));
ALTER TABLE "EditorDraft" ADD CONSTRAINT "EditorDraft_revision_check" CHECK ("revision" >= 1);
