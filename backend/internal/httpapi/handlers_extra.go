package httpapi

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mobtgzhang/TexPad/backend/internal/agent"
	"github.com/mobtgzhang/TexPad/backend/internal/parse"
	"github.com/mobtgzhang/TexPad/backend/internal/storage"
)

type createShareReq struct {
	Role string `json:"role"`
}

func (s *Server) handleCreateShare(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) != "owner" {
		writeError(w, http.StatusForbidden, "owner only")
		return
	}
	pid := projectIDFrom(ctx)
	var req createShareReq
	_ = json.NewDecoder(r.Body).Decode(&req)
	role := strings.TrimSpace(req.Role)
	if role == "" {
		role = "viewer"
	}
	if role != "viewer" && role != "editor" {
		role = "viewer"
	}
	tok := uuid.NewString()
	_, err := s.pool.Exec(ctx, `INSERT INTO project_shares (token, project_id, role) VALUES ($1,$2,$3)`, tok, pid, role)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"token": tok, "role": role})
}

type snapshotReq struct {
	Label string `json:"label"`
}

func (s *Server) handleCreateSnapshot(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	pid := projectIDFrom(ctx)
	var req snapshotReq
	_ = json.NewDecoder(r.Body).Decode(&req)
	rows, err := s.pool.Query(ctx, `SELECT path, size_bytes FROM project_files WHERE project_id=$1`, pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	type ent struct {
		Path string `json:"path"`
		Size int64  `json:"size"`
	}
	var manifest []ent
	for rows.Next() {
		var e ent
		if err := rows.Scan(&e.Path, &e.Size); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "scan")
			return
		}
		manifest = append(manifest, e)
	}
	rows.Close()
	mb, _ := json.Marshal(manifest)
	var sid uuid.UUID
	err = s.pool.QueryRow(ctx, `INSERT INTO project_snapshots (project_id, label, manifest) VALUES ($1,$2,$3) RETURNING id`,
		pid, strings.TrimSpace(req.Label), mb).Scan(&sid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "insert")
		return
	}
	for _, e := range manifest {
		src := storage.ProjectFileKey(pid, e.Path)
		dst := storage.SnapshotObjectKey(pid, sid, e.Path)
		if err := s.store.CopyObject(ctx, src, dst); err != nil {
			s.log.Warn("snapshot copy", "path", e.Path, "err", err)
		}
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": sid.String()})
}

func (s *Server) handleListSnapshots(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	rows, err := s.pool.Query(ctx, `SELECT id, label, created_at FROM project_snapshots WHERE project_id=$1 ORDER BY created_at DESC`, pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var label *string
		var ts any
		if err := rows.Scan(&id, &label, &ts); err != nil {
			writeError(w, http.StatusInternalServerError, "scan")
			return
		}
		l := ""
		if label != nil {
			l = *label
		}
		list = append(list, map[string]any{"id": id.String(), "label": l, "created_at": ts})
	}
	writeJSON(w, http.StatusOK, map[string]any{"snapshots": list})
}

func (s *Server) handleRestoreSnapshot(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	pid := projectIDFrom(ctx)
	sid, err := uuid.Parse(chi.URLParam(r, "snapshotID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad id")
		return
	}
	var raw []byte
	err = s.pool.QueryRow(ctx, `SELECT manifest FROM project_snapshots WHERE id=$1 AND project_id=$2`, sid, pid).Scan(&raw)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	var manifest []struct {
		Path string `json:"path"`
	}
	if json.Unmarshal(raw, &manifest) != nil {
		writeError(w, http.StatusInternalServerError, "bad manifest")
		return
	}
	for _, m := range manifest {
		src := storage.SnapshotObjectKey(pid, sid, m.Path)
		dst := storage.ProjectFileKey(pid, m.Path)
		if err := s.store.CopyObject(ctx, src, dst); err != nil {
			s.log.Warn("restore copy", "path", m.Path, "err", err)
			continue
		}
		obj, err := s.store.GetFile(ctx, pid, m.Path)
		if err != nil {
			continue
		}
		st, err := obj.Stat()
		_ = obj.Close()
		sz := int64(0)
		ct := "application/octet-stream"
		if err == nil {
			sz = st.Size
			if st.ContentType != "" {
				ct = st.ContentType
			}
		}
		_, _ = s.pool.Exec(ctx, `
INSERT INTO project_files (project_id, path, content_type, size_bytes, updated_at)
VALUES ($1,$2,$3,$4, now())
ON CONFLICT (project_id, path) DO UPDATE SET content_type=EXCLUDED.content_type, size_bytes=EXCLUDED.size_bytes, updated_at=now()`,
			pid, m.Path, ct, sz)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "restored"})
}

func (s *Server) putBytesFile(ctx context.Context, projectID uuid.UUID, path string, data []byte) error {
	ct := "application/octet-stream"
	if strings.HasSuffix(strings.ToLower(path), ".tex") {
		ct = "text/plain"
	}
	if err := s.store.PutFile(ctx, projectID, path, bytes.NewReader(data), int64(len(data)), ct); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `
INSERT INTO project_files (project_id, path, content_type, size_bytes, updated_at)
VALUES ($1,$2,$3,$4, now())
ON CONFLICT (project_id, path) DO UPDATE SET content_type=EXCLUDED.content_type, size_bytes=EXCLUDED.size_bytes, updated_at=now()`,
		projectID, path, ct, len(data))
	return err
}

func (s *Server) handleExportZip(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	rows, err := s.pool.Query(ctx, `SELECT path FROM project_files WHERE project_id=$1`, pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	var paths []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			writeError(w, http.StatusInternalServerError, "scan")
			return
		}
		paths = append(paths, p)
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="project.zip"`)
	zw := zip.NewWriter(w)
	defer zw.Close()
	for _, p := range paths {
		obj, err := s.store.GetFile(ctx, pid, p)
		if err != nil {
			continue
		}
		data, _ := io.ReadAll(obj)
		_ = obj.Close()
		f, err := zw.Create(p)
		if err != nil {
			continue
		}
		_, _ = f.Write(data)
	}
}

func (s *Server) handleImportZip(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	pid := projectIDFrom(ctx)
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "multipart")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, "read")
		return
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		writeError(w, http.StatusBadRequest, "not zip")
		return
	}
	n := 0
	for _, zf := range zr.File {
		if zf.FileInfo().IsDir() {
			continue
		}
		rel, ok := sanitizeRelPath(zf.Name)
		if !ok || !allowedFile(rel) {
			continue
		}
		rc, err := zf.Open()
		if err != nil {
			continue
		}
		b, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			continue
		}
		if err := s.putBytesFile(ctx, pid, rel, b); err != nil {
			continue
		}
		n++
	}
	writeJSON(w, http.StatusOK, map[string]int{"imported": n})
}

type agentStreamReq struct {
	Messages []map[string]string `json:"messages"`
}

func (s *Server) handleAgentStream(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid, _ := UserID(ctx)
	pid := projectIDFrom(ctx)
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	var req agentStreamReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	fl, ok := w.(http.Flusher)
	if ok {
		fl.Flush()
	}
	_ = s.agent.StreamChat(ctx, uid, pid, req.Messages, w)
}

func (s *Server) handleAgentSuggest(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("log")
	issues := parse.LaTeXIssues(q)
	msg := agent.SuggestFix(q)
	writeJSON(w, http.StatusOK, map[string]any{"suggestion": msg, "issues": issues})
}

func (s *Server) handleAgentPapers(w http.ResponseWriter, r *http.Request) {
	topic := r.URL.Query().Get("topic")
	writeJSON(w, http.StatusOK, map[string]any{"items": agent.PaperRecommendations(topic)})
}

func (s *Server) handleAgentMemories(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid, _ := UserID(ctx)
	var pid uuid.UUID
	if s := r.URL.Query().Get("project_id"); s != "" {
		var err error
		pid, err = uuid.Parse(s)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad project id")
			return
		}
	}
	list, err := s.agent.ListMemories(ctx, uid, pid, 30)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"memories": list})
}

type feedbackReq struct {
	ProjectID string `json:"project_id"`
	Helpful   bool   `json:"helpful"`
	Note      string `json:"note"`
}

func (s *Server) handleAgentFeedback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid, _ := UserID(ctx)
	var req feedbackReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	var pid uuid.UUID
	if req.ProjectID != "" {
		var err error
		pid, err = uuid.Parse(req.ProjectID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad project id")
			return
		}
	}
	if err := s.agent.RecordFeedback(ctx, uid, pid, req.Helpful, req.Note); err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
