-- +goose Up
ALTER TABLE paperclaw_jobs ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE paperclaw_jobs DROP COLUMN IF EXISTS cancel_requested;
