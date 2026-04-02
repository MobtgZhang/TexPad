package httpapi

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func sqlNullString(ns sql.NullString) string {
	if !ns.Valid {
		return ""
	}
	return ns.String
}

// writeSchemaOrDBError maps common Postgres / pgx failures to actionable API messages instead of a bare "db error".
func writeSchemaOrDBError(w http.ResponseWriter, log *slog.Logger, err error) {
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "42703" {
		log.Error("postgres undefined_column", "code", pe.Code, "message", pe.Message)
		writeError(w, http.StatusInternalServerError, "database schema outdated; run backend migrations")
		return
	}
	var se pgx.ScanArgError
	if errors.As(err, &se) {
		log.Error("compile_jobs scan failed", "column_index", se.ColumnIndex, "err", se.Err)
		writeError(w, http.StatusInternalServerError, "compile job row could not be read; run backend migrations")
		return
	}
	writeError(w, http.StatusInternalServerError, "db error")
}

type compileReq struct {
	Engine       string  `json:"engine"`
	DraftMode    *bool   `json:"draft_mode"`
	HaltOnError  *bool   `json:"halt_on_error"`
	CleanBuild   *bool   `json:"clean_build"`
	SyntaxCheck  *bool   `json:"syntax_check"`
	TexliveYear  *string `json:"texlive_year"`
}

func (s *Server) handleCompile(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	if s.cfg.CompileDailyLimit > 0 && s.rl != nil {
		uid, ok := UserID(ctx)
		if ok {
			allowed, err := s.rl.Allow(ctx, fmt.Sprintf("compile:user:%s", uid.String()), int64(s.cfg.CompileDailyLimit), 24*time.Hour)
			if err == nil && !allowed {
				writeError(w, http.StatusTooManyRequests, "daily compile limit exceeded")
				return
			}
		}
	}
	pid := projectIDFrom(ctx)
	var req compileReq
	_ = json.NewDecoder(r.Body).Decode(&req)
	engine := req.Engine
	switch engine {
	case "xelatex", "lualatex", "pdflatex", "context":
	default:
		engine = "pdflatex"
	}
	draft := false
	halt := true
	clean := false
	syntax := true
	if req.DraftMode != nil {
		draft = *req.DraftMode
	}
	if req.HaltOnError != nil {
		halt = *req.HaltOnError
	}
	if req.CleanBuild != nil {
		clean = *req.CleanBuild
	}
	if req.SyntaxCheck != nil {
		syntax = *req.SyntaxCheck
	}
	texYear := "2025"
	if req.TexliveYear != nil {
		y := strings.TrimSpace(*req.TexliveYear)
		if y == "2024" || y == "2025" {
			texYear = y
		}
	}
	var jid uuid.UUID
	err := s.pool.QueryRow(ctx, `INSERT INTO compile_jobs (project_id, status, engine, draft_mode, halt_on_error, clean_build, syntax_check, texlive_year) VALUES ($1,'queued',$2,$3,$4,$5,$6,$7) RETURNING id`,
		pid, engine, draft, halt, clean, syntax, texYear).Scan(&jid)
	if err != nil {
		writeSchemaOrDBError(w, s.log, err)
		return
	}
	s.comp.Enqueue(jid)
	writeJSON(w, http.StatusAccepted, map[string]string{"job_id": jid.String(), "status": "queued"})
}

func (s *Server) handleCompileJob(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	jid, err := uuid.Parse(chi.URLParam(r, "jobID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad job id")
		return
	}
	var st, eng string
	var logt, errt, pdf, syn sql.NullString
	var createdAt, updatedAt time.Time
	err = s.pool.QueryRow(ctx, `SELECT status, engine, log_text, error_text, pdf_object_key, synctex_object_key, created_at, updated_at FROM compile_jobs WHERE id=$1 AND project_id=$2`,
		jid, pid).Scan(&st, &eng, &logt, &errt, &pdf, &syn, &createdAt, &updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			msg := "unknown_job"
			var otherPID uuid.UUID
			err2 := s.pool.QueryRow(ctx, `SELECT project_id FROM compile_jobs WHERE id=$1`, jid).Scan(&otherPID)
			if err2 == nil && otherPID != pid {
				msg = "job_wrong_project"
			} else if err2 != nil && !errors.Is(err2, pgx.ErrNoRows) {
				s.log.Error("compile job lookup by id", "job", jid, "err", err2)
				writeSchemaOrDBError(w, s.log, err2)
				return
			}
			if uid, ok := UserID(ctx); ok {
				s.log.Warn("compile job get not found", "job_id", jid, "project_id", pid, "user_id", uid, "reason", msg)
			} else {
				s.log.Warn("compile job get not found", "job_id", jid, "project_id", pid, "reason", msg)
			}
			writeError(w, http.StatusNotFound, msg)
			return
		}
		s.log.Error("compile job query", "job", jid, "project", pid, "err", err)
		writeSchemaOrDBError(w, s.log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": jid.String(), "status": st, "engine": eng, "log": sqlNullString(logt), "error": sqlNullString(errt),
		"pdf_key": sqlNullString(pdf), "synctex_key": sqlNullString(syn), "created_at": createdAt, "updated_at": updatedAt,
	})
}

func (s *Server) handlePDFDownload(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	jid, err := uuid.Parse(chi.URLParam(r, "jobID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad job id")
		return
	}
	var pdfKey, st string
	err = s.pool.QueryRow(ctx, `SELECT pdf_object_key, status FROM compile_jobs WHERE id=$1 AND project_id=$2`, jid, pid).Scan(&pdfKey, &st)
	if err != nil || pdfKey == "" || st != "success" {
		writeError(w, http.StatusNotFound, "pdf not ready")
		return
	}
	obj, err := s.store.GetObject(ctx, pdfKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage")
		return
	}
	defer obj.Close()
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", "inline; filename=output.pdf")
	_, _ = io.Copy(w, obj)
}

func (s *Server) handleSynctexDownload(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	jid, err := uuid.Parse(chi.URLParam(r, "jobID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad job id")
		return
	}
	var synKey, st string
	err = s.pool.QueryRow(ctx, `SELECT synctex_object_key, status FROM compile_jobs WHERE id=$1 AND project_id=$2`, jid, pid).Scan(&synKey, &st)
	if err != nil || synKey == "" || st != "success" {
		writeError(w, http.StatusNotFound, "synctex not available")
		return
	}
	obj, err := s.store.GetObject(ctx, synKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage")
		return
	}
	defer obj.Close()
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", "attachment; filename=output.synctex.gz")
	_, _ = io.Copy(w, obj)
}

func (s *Server) handlePDFPresign(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	jid, err := uuid.Parse(chi.URLParam(r, "jobID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad job id")
		return
	}
	var pdfKey, st string
	err = s.pool.QueryRow(ctx, `SELECT pdf_object_key, status FROM compile_jobs WHERE id=$1 AND project_id=$2`, jid, pid).Scan(&pdfKey, &st)
	if err != nil || pdfKey == "" || st != "success" {
		writeError(w, http.StatusNotFound, "pdf not ready")
		return
	}
	url, err := s.store.PresignedGet(ctx, pdfKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "presign failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": url})
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

func (s *Server) handleCompileWS(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	if _, ok := UserID(ctx); !ok {
		writeError(w, http.StatusUnauthorized, "missing user")
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	ch := s.notify.subscribe(pid)
	defer s.notify.unsubscribe(pid, ch)
	_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	done := make(chan struct{})
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				close(done)
				return
			}
		}
	}()
	tick := time.NewTicker(30 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-done:
			return
		case jid := <-ch:
			b, _ := json.Marshal(map[string]string{"type": "compile_done", "job_id": jid.String()})
			_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
				return
			}
		case <-tick.C:
			_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
