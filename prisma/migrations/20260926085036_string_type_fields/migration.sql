/*
  Warnings:

  - The `articleType` column on the `Article` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `creationType` column on the `MediaItem` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Article" DROP COLUMN "articleType",
ADD COLUMN     "articleType" TEXT NOT NULL DEFAULT 'Event Guide';

-- AlterTable
ALTER TABLE "MediaItem" DROP COLUMN "creationType",
ADD COLUMN     "creationType" TEXT NOT NULL DEFAULT 'Original';

-- DropEnum
DROP TYPE "ArticleType";

-- DropEnum
DROP TYPE "MediaCreationType";
