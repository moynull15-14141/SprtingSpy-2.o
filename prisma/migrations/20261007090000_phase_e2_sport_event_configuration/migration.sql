-- Definitions and values are separate nullable JSONB documents.
-- Existing Sport, Event and Edition rows and columns are untouched.
ALTER TABLE "Sport" ADD COLUMN "eventConfiguration" JSONB;
ALTER TABLE "SportEvent" ADD COLUMN "sportSpecificValues" JSONB;
