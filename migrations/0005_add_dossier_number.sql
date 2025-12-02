-- Add dossier_number field to reports table
-- This creates an auto-incrementing sequence for dossier numbers

-- Create a sequence for dossier numbers
CREATE SEQUENCE IF NOT EXISTS dossier_number_seq START WITH 1;

-- Add dossier_number column to reports table
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "dossier_number" integer;

-- Set existing reports to have sequential dossier numbers based on creation date
UPDATE "reports"
SET "dossier_number" = subquery.row_num
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "created_at" ASC) as row_num
  FROM "reports"
) AS subquery
WHERE "reports".id = subquery.id
AND "reports"."dossier_number" IS NULL;

-- Update the sequence to continue from the highest existing number
SELECT setval('dossier_number_seq', COALESCE((SELECT MAX("dossier_number") FROM "reports"), 0));

-- Add NOT NULL constraint after setting values
ALTER TABLE "reports" ALTER COLUMN "dossier_number" SET NOT NULL;

-- Add unique constraint
ALTER TABLE "reports" ADD CONSTRAINT "reports_dossier_number_unique" UNIQUE ("dossier_number");

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS "reports_dossier_number_idx" ON "reports" ("dossier_number");
