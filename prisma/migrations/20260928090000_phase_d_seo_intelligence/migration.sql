-- PHASE D — SEO Intelligence. Additive only: one nullable Article column and
-- three new tables. No existing value is modified.

-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "reviewedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SeoRule" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "articleTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "severity" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoScanRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "findings" JSONB NOT NULL,

    CONSTRAINT "SeoScanRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoIntegrationLog" (
    "id" TEXT NOT NULL,
    "integration" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "detail" TEXT NOT NULL,
    "urls" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoIntegrationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeoRule_key_key" ON "SeoRule"("key");

-- CreateIndex
CREATE INDEX "SeoScanRun_startedAt_idx" ON "SeoScanRun"("startedAt");

-- CreateIndex
CREATE INDEX "SeoIntegrationLog_integration_createdAt_idx" ON "SeoIntegrationLog"("integration", "createdAt");

