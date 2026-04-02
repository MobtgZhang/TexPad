package httpapi

import (
	"io"
	"net/http"
)

const maxCollabStateBytes = 4 << 20 // 4 MiB

func (s *Server) handleCollabGetState(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	rel, ok := sanitizeRelPath(r.URL.Query().Get("path"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}
	var state []byte
	err := s.pool.QueryRow(ctx, `SELECT state FROM project_collab_state WHERE project_id=$1 AND path=$2`, pid, rel).Scan(&state)
	if err != nil || len(state) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	_, _ = w.Write(state)
}

func (s *Server) handleCollabPutState(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	pid := projectIDFrom(ctx)
	rel, ok := sanitizeRelPath(r.URL.Query().Get("path"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxCollabStateBytes)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "body too large")
		return
	}
	if len(data) == 0 {
		writeError(w, http.StatusBadRequest, "empty state")
		return
	}
	_, err = s.pool.Exec(ctx, `
INSERT INTO project_collab_state (project_id, path, state, updated_at)
VALUES ($1,$2,$3, now())
ON CONFLICT (project_id, path) DO UPDATE SET state=EXCLUDED.state, updated_at=now()`,
		pid, rel, data)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
