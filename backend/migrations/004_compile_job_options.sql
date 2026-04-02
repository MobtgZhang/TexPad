-- +goose Up
ALTER TABLE compile_jobs ADD COLUMN IF NOT EXISTS draft_mode BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE compile_jobs ADD COLUMN IF NOT EXISTS halt_on_error BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE compile_jobs ADD COLUMN IF NOT EXISTS clean_build BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE compile_jobs ADD COLUMN IF NOT EXISTS syntax_check BOOLEAN NOT NULL DEFAULT true;

-- +goose Down
ALTER TABLE compile_jobs DROP COLUMN IF EXISTS syntax_check;
ALTER TABLE compile_jobs DROP COLUMN IF EXISTS clean_build;
ALTER TABLE compile_jobs DROP COLUMN IF EXISTS halt_on_error;
ALTER TABLE compile_jobs DROP COLUMN IF EXISTS draft_mode;
