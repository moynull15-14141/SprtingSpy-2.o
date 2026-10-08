-- Rich event overview: nullable, additive. Existing events keep their plain-text description.
ALTER TABLE "SportEvent" ADD COLUMN "descriptionBody" JSONB;
