package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type compileReq struct {
	Engine string `json:"engine"`
}

func (s *Server) handleCompile(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	pid := projectIDFrom(ctx)
	var req compileReq
	_ = json.NewDecoder(r.Body).Decode(&req)
	engine := req.Engine
	switch engine {
	case "xelatex", "lualatex", "pdflatex":
	default:
		engine = "pdflatex"
	}
	var jid uuid.UUID
	err := s.pool.QueryRow(ctx, `INSERT INTO compile_jobs (project_id, status, engine) VALUES ($1,'queued',$2) RETURNING id`, pid, engine).Scan(&jid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
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
	var st, eng, logt, errt, pdf string
	var c, u any
	err = s.pool.QueryRow(ctx, `SELECT status, engine, log_text, error_text, pdf_object_key, created_at, updated_at FROM compile_jobs WHERE id=$1 AND project_id=$2`,
		jid, pid).Scan(&st, &eng, &logt, &errt, &pdf, &c, &u)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": jid.String(), "status": st, "engine": eng, "log": logt, "error": errt, "pdf_key": pdf,
		"created_at": c, "updated_at": u,
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
