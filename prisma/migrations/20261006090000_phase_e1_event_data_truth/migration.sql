-- Optional factual Event/Edition fields must represent unknown information as NULL.
-- Existing values and rows are preserved unchanged.
ALTER TABLE "SportEvent"
  ALTER COLUMN "frequency" DROP NOT NULL,
  ALTER COLUMN "defaultVenue" DROP NOT NULL,
  ALTER COLUMN "defaultLocation" DROP NOT NULL,
  ALTER COLUMN "currentEditionYear" DROP NOT NULL;

ALTER TABLE "EventEdition"
  ALTER COLUMN "startDate" DROP NOT NULL,
  ALTER COLUMN "endDate" DROP NOT NULL,
  ALTER COLUMN "venue" DROP NOT NULL,
  ALTER COLUMN "location" DROP NOT NULL,
  ALTER COLUMN "featuredImage" DROP NOT NULL;
