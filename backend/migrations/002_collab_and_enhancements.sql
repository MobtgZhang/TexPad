-- +goose Up
CREATE TABLE project_collab_state (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    state BYTEA NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, path)
);

CREATE INDEX idx_project_collab_updated ON project_collab_state (project_id, updated_at);

ALTER TABLE compile_jobs ADD COLUMN IF NOT EXISTS synctex_object_key TEXT;

ALTER TABLE project_shares ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE TABLE project_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    line INT NOT NULL,
    body TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_comments_project ON project_comments (project_id);

-- +goose Down
DROP TABLE IF EXISTS project_comments;
ALTER TABLE project_shares DROP COLUMN IF EXISTS expires_at;
ALTER TABLE compile_jobs DROP COLUMN IF EXISTS synctex_object_key;
DROP TABLE IF EXISTS project_collab_state;
