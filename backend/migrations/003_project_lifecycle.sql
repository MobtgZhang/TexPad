-- +goose Up
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE projects DROP COLUMN IF EXISTS archived_at;
ALTER TABLE projects DROP COLUMN IF EXISTS deleted_at;
