-- CreateEnum
CREATE TYPE "Role" AS ENUM ('Admin', 'Editor', 'Author', 'Reader');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('draft', 'preview', 'scheduled', 'published', 'archived');

-- CreateEnum
CREATE TYPE "EditionStatus" AS ENUM ('upcoming', 'ongoing', 'completed');

-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ArticleType" AS ENUM ('Event Guide', 'Schedule', 'Results', 'Sports Viewing Guide', 'Preview', 'Update', 'News', 'Past Winners', 'Records', 'Prize Money', 'Players', 'Teams', 'Venue', 'Qualification', 'Rules & Format', 'History', 'Analysis', 'General Information', 'Other');

-- CreateEnum
CREATE TYPE "MediaCreationType" AS ENUM ('Original', 'AI-created', 'AI-assisted', 'Licensed', 'Official Source', 'Creative Commons', 'Other');

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('Sport', 'Event', 'Edition', 'Article', 'Comment', 'Setting', 'User', 'Author', 'Redirect');

-- CreateTable
CREATE TABLE "Sport" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "featuredEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "colorTheme" TEXT,
    "heroImage" TEXT,
    "seo" JSONB NOT NULL,

    CONSTRAINT "Sport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SportEvent" (
    "id" TEXT NOT NULL,
    "sportSlug" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "history" TEXT,
    "frequency" TEXT NOT NULL,
    "defaultVenue" TEXT NOT NULL,
    "defaultLocation" TEXT NOT NULL,
    "currentEditionYear" INTEGER NOT NULL,
    "allEditionYears" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "featuredImage" TEXT,
    "seo" JSONB NOT NULL,

    CONSTRAINT "SportEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventEdition" (
    "id" TEXT NOT NULL,
    "eventSlug" TEXT NOT NULL,
    "sportSlug" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "status" "EditionStatus" NOT NULL DEFAULT 'upcoming',
    "quickFacts" JSONB NOT NULL DEFAULT '[]',
    "prizeMoneyTotal" TEXT,
    "defendingChampions" JSONB,
    "qualificationInfo" TEXT,
    "participantsCount" INTEGER,
    "officialSourceUrl" TEXT,
    "description" TEXT NOT NULL,
    "featuredImage" TEXT NOT NULL,
    "seo" JSONB NOT NULL,

    CONSTRAINT "EventEdition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "sportSlug" TEXT NOT NULL,
    "eventSlug" TEXT,
    "editionYear" INTEGER,
    "articleType" "ArticleType" NOT NULL DEFAULT 'Event Guide',
    "excerpt" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "featuredImage" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3),
    "scheduledFor" TIMESTAMP(3),
    "status" "ArticleStatus" NOT NULL DEFAULT 'draft',
    "readingTimeMinutes" INTEGER NOT NULL,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "tables" JSONB,
    "references" JSONB,
    "seo" JSONB NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Author" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "avatar" TEXT NOT NULL,
    "twitter" TEXT,
    "email" TEXT,
    "articleCount" INTEGER DEFAULT 0,
    "userId" TEXT,

    CONSTRAINT "Author_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "avatar" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3),
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "passwordHash" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "userAvatar" TEXT,
    "userRole" "Role",
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT NOT NULL,
    "caption" TEXT,
    "credit" TEXT,
    "source" TEXT,
    "license" TEXT,
    "creationType" "MediaCreationType" NOT NULL DEFAULT 'Original',
    "uploadedAt" TIMESTAMP(3) NOT NULL,
    "fileSize" TEXT,
    "dimensions" TEXT,

    CONSTRAINT "MediaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdSlotConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "placementDescription" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sponsorName" TEXT,
    "bannerText" TEXT,
    "linkUrl" TEXT,
    "dimensions" TEXT NOT NULL,

    CONSTRAINT "AdSlotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedirectRule" (
    "id" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RedirectRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" "AuditEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "details" TEXT NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sport_slug_key" ON "Sport"("slug");

-- CreateIndex
CREATE INDEX "Sport_isVisible_idx" ON "Sport"("isVisible");

-- CreateIndex
CREATE INDEX "SportEvent_sportSlug_idx" ON "SportEvent"("sportSlug");

-- CreateIndex
CREATE UNIQUE INDEX "SportEvent_sportSlug_slug_key" ON "SportEvent"("sportSlug", "slug");

-- CreateIndex
CREATE INDEX "EventEdition_sportSlug_eventSlug_idx" ON "EventEdition"("sportSlug", "eventSlug");

-- CreateIndex
CREATE UNIQUE INDEX "EventEdition_sportSlug_eventSlug_year_key" ON "EventEdition"("sportSlug", "eventSlug", "year");

-- CreateIndex
CREATE INDEX "Article_sportSlug_idx" ON "Article"("sportSlug");

-- CreateIndex
CREATE INDEX "Article_status_idx" ON "Article"("status");

-- CreateIndex
CREATE INDEX "Article_status_scheduledFor_idx" ON "Article"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "Article_slug_idx" ON "Article"("slug");

-- CreateIndex
CREATE INDEX "Article_authorId_idx" ON "Article"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "Author_slug_key" ON "Author"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Author_userId_key" ON "Author"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Comment_articleId_idx" ON "Comment"("articleId");

-- CreateIndex
CREATE INDEX "Comment_status_idx" ON "Comment"("status");

-- CreateIndex
CREATE INDEX "RedirectRule_sourceUrl_idx" ON "RedirectRule"("sourceUrl");

-- CreateIndex
CREATE INDEX "RedirectRule_isActive_idx" ON "RedirectRule"("isActive");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "SportEvent" ADD CONSTRAINT "SportEvent_sportSlug_fkey" FOREIGN KEY ("sportSlug") REFERENCES "Sport"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventEdition" ADD CONSTRAINT "EventEdition_sportSlug_eventSlug_fkey" FOREIGN KEY ("sportSlug", "eventSlug") REFERENCES "SportEvent"("sportSlug", "slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_sportSlug_fkey" FOREIGN KEY ("sportSlug") REFERENCES "Sport"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Author"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_sportSlug_eventSlug_editionYear_fkey" FOREIGN KEY ("sportSlug", "eventSlug", "editionYear") REFERENCES "EventEdition"("sportSlug", "eventSlug", "year") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Author" ADD CONSTRAINT "Author_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
