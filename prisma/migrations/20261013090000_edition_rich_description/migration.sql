-- Rich edition description: nullable, additive. Existing editions keep their plain-text description.
ALTER TABLE "EventEdition" ADD COLUMN "descriptionBody" JSONB;
