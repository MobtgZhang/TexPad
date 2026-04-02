-- +goose Up
ALTER TABLE compile_jobs ADD COLUMN IF NOT EXISTS texlive_year TEXT NOT NULL DEFAULT '2025';

-- +goose Down
ALTER TABLE compile_jobs DROP COLUMN IF EXISTS texlive_year;
