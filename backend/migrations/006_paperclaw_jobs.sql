-- +goose Up
CREATE TABLE paperclaw_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued',
    step INT NOT NULL DEFAULT 0,
    progress INT NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX paperclaw_jobs_project_id_idx ON paperclaw_jobs(project_id);
CREATE INDEX paperclaw_jobs_status_idx ON paperclaw_jobs(status);

-- +goose Down
DROP TABLE IF EXISTS paperclaw_jobs;
