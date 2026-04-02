package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func (s *Server) handlePaperclawCreateJob(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	uid, ok := UserID(ctx)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	pid := projectIDFrom(ctx)
	var jid uuid.UUID
	err := s.pool.QueryRow(ctx,
		`INSERT INTO paperclaw_jobs (project_id, user_id, status, step, progress, message) VALUES ($1,$2,'queued',0,0,'排队中') RETURNING id`,
		pid, uid).Scan(&jid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	if s.paperclaw != nil {
		s.paperclaw.Enqueue(jid)
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"job_id": jid.String(), "status": "queued"})
}

func (s *Server) handlePaperclawJob(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	jid, err := uuid.Parse(chi.URLParam(r, "jobID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad job id")
		return
	}
	var st string
	var step, prog int
	var msg string
	var c, u any
	err = s.pool.QueryRow(ctx,
		`SELECT status, step, progress, message, created_at, updated_at FROM paperclaw_jobs WHERE id=$1 AND project_id=$2`,
		jid, pid).Scan(&st, &step, &prog, &msg, &c, &u)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": jid.String(), "status": st, "step": step, "progress": prog, "message": msg,
		"created_at": c, "updated_at": u,
	})
}
