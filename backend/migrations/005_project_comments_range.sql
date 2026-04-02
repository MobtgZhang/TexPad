-- +goose Up
ALTER TABLE project_comments ADD COLUMN IF NOT EXISTS end_line INT;
ALTER TABLE project_comments ADD COLUMN IF NOT EXISTS start_col INT;
ALTER TABLE project_comments ADD COLUMN IF NOT EXISTS end_col INT;
ALTER TABLE project_comments ADD COLUMN IF NOT EXISTS quote TEXT;

-- Backfill legacy rows: treat as whole-line anchor
UPDATE project_comments
SET end_line = line, start_col = 1, end_col = 1
WHERE end_line IS NULL;

-- +goose Down
ALTER TABLE project_comments DROP COLUMN IF EXISTS quote;
ALTER TABLE project_comments DROP COLUMN IF EXISTS end_col;
ALTER TABLE project_comments DROP COLUMN IF EXISTS start_col;
ALTER TABLE project_comments DROP COLUMN IF EXISTS end_line;
