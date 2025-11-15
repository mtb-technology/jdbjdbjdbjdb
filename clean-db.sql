UPDATE reports 
SET "conceptReportVersions" = jsonb_set(
  COALESCE("conceptReportVersions", '{}'::jsonb),
  '{history}',
  '[]'::jsonb
)
WHERE id = '5e1de768-9fc3-4f19-b930-f968996cfaaf';
