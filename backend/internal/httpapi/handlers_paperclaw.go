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
	if s.agent != nil && !s.agent.LLMConfigured(nil) {
		writeError(w, http.StatusServiceUnavailable, "Paperclaw 需要服务端 LLM：请设置 TEXPAD_LLM_BASE_URL 与 TEXPAD_LLM_API_KEY")
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
	var cancelReq bool
	err = s.pool.QueryRow(ctx,
		`SELECT status, step, progress, message, COALESCE(cancel_requested,false), created_at, updated_at FROM paperclaw_jobs WHERE id=$1 AND project_id=$2`,
		jid, pid).Scan(&st, &step, &prog, &msg, &cancelReq, &c, &u)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": jid.String(), "status": st, "step": step, "progress": prog, "message": msg,
		"cancel_requested": cancelReq,
		"created_at":       c, "updated_at": u,
	})
}

func (s *Server) handlePaperclawCancelJob(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	pid := projectIDFrom(ctx)
	jid, err := uuid.Parse(chi.URLParam(r, "jobID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad job id")
		return
	}
	tag, err := s.pool.Exec(ctx,
		`UPDATE paperclaw_jobs SET cancel_requested=true, message=CASE WHEN status IN ('queued','running') THEN '正在取消…' ELSE message END, updated_at=now() WHERE id=$1 AND project_id=$2 AND status IN ('queued','running')`,
		jid, pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusBadRequest, "job not active")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func (s *Server) handleAgentLLMConfigured(w http.ResponseWriter, _ *http.Request) {
	if s.agent == nil {
		writeJSON(w, http.StatusOK, map[string]bool{"configured": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"configured": s.agent.LLMConfigured(nil)})
}
