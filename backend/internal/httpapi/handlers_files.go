package httpapi

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

var allowedExt = map[string]bool{
	".tex": true, ".bib": true, ".cls": true, ".sty": true,
	".png": true, ".jpg": true, ".jpeg": true, ".pdf": true, ".svg": true, ".eps": true,
	".bst": true, ".clo": true, ".cfg": true, ".def": true,
}

func sanitizeRelPath(raw string) (string, bool) {
	p := strings.TrimSpace(raw)
	p = strings.TrimPrefix(p, "/")
	if p == "" || strings.Contains(p, "..") {
		return "", false
	}
	c := path.Clean(p)
	if c == "." || strings.HasPrefix(c, "../") {
		return "", false
	}
	return c, true
}

func (s *Server) handleListFiles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	rows, err := s.pool.Query(ctx, `SELECT path, size_bytes, updated_at FROM project_files WHERE project_id=$1 ORDER BY path`, pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	var files []map[string]any
	for rows.Next() {
		var p string
		var sz int64
		var ts any
		if err := rows.Scan(&p, &sz, &ts); err != nil {
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		files = append(files, map[string]any{"path": p, "size_bytes": sz, "updated_at": ts})
	}
	writeJSON(w, http.StatusOK, map[string]any{"files": files})
}

func (s *Server) handleGetFile(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	rel, ok := sanitizeRelPath(chi.URLParam(r, "*"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}
	obj, err := s.store.GetFile(ctx, pid, rel)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	defer obj.Close()
	stat, err := obj.Stat()
	if err == nil && stat.ContentType != "" {
		w.Header().Set("Content-Type", stat.ContentType)
	} else {
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	_, _ = io.Copy(w, obj)
}

func (s *Server) handleShareGetFile(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	token := chi.URLParam(r, "token")
	var pid uuid.UUID
	var role string
	var exp *time.Time
	err := s.pool.QueryRow(ctx, `SELECT project_id, role, expires_at FROM project_shares WHERE token=$1`, token).Scan(&pid, &role, &exp)
	if err != nil {
		writeError(w, http.StatusNotFound, "invalid share")
		return
	}
	if exp != nil && time.Now().After(*exp) {
		writeError(w, http.StatusGone, "share expired")
		return
	}
	_ = role
	rel, ok := sanitizeRelPath(chi.URLParam(r, "*"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}
	obj, err := s.store.GetFile(ctx, pid, rel)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	defer obj.Close()
	_, _ = io.Copy(w, obj)
}

func (s *Server) handlePutFile(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	pid := projectIDFrom(ctx)
	rel, ok := sanitizeRelPath(chi.URLParam(r, "*"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}
	if !allowedFile(rel) {
		writeError(w, http.StatusBadRequest, "extension not allowed")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "body too large")
		return
	}
	ct := r.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/octet-stream"
	}
	if err := s.store.PutFile(ctx, pid, rel, bytes.NewReader(data), int64(len(data)), ct); err != nil {
		writeError(w, http.StatusInternalServerError, "storage error")
		return
	}
	_, err = s.pool.Exec(ctx, `
INSERT INTO project_files (project_id, path, content_type, size_bytes, updated_at)
VALUES ($1,$2,$3,$4, now())
ON CONFLICT (project_id, path) DO UPDATE SET content_type=EXCLUDED.content_type, size_bytes=EXCLUDED.size_bytes, updated_at=now()`,
		pid, rel, ct, len(data))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func allowedFile(rel string) bool {
	ext := strings.ToLower(path.Ext(rel))
	if ext == "" {
		return false
	}
	return allowedExt[ext]
}

func (s *Server) handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	pid := projectIDFrom(ctx)
	rel, ok := sanitizeRelPath(chi.URLParam(r, "*"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}
	_ = s.store.RemoveFile(ctx, pid, rel)
	_, _ = s.pool.Exec(ctx, `DELETE FROM project_files WHERE project_id=$1 AND path=$2`, pid, rel)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUploadFile(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	pid := projectIDFrom(ctx)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "multipart")
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file")
		return
	}
	defer file.Close()
	rel := r.FormValue("path")
	if rel == "" {
		rel = hdr.Filename
	}
	rel, ok := sanitizeRelPath(rel)
	if !ok || !allowedFile(rel) {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}
	if err := s.saveUpload(ctx, pid, rel, file, hdr); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"path": rel})
}

func (s *Server) saveUpload(ctx context.Context, pid uuid.UUID, rel string, file multipart.File, hdr *multipart.FileHeader) error {
	data, err := io.ReadAll(file)
	if err != nil {
		return err
	}
	ct := hdr.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/octet-stream"
	}
	if err := s.store.PutFile(ctx, pid, rel, bytes.NewReader(data), int64(len(data)), ct); err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
INSERT INTO project_files (project_id, path, content_type, size_bytes, updated_at)
VALUES ($1,$2,$3,$4, now())
ON CONFLICT (project_id, path) DO UPDATE SET content_type=EXCLUDED.content_type, size_bytes=EXCLUDED.size_bytes, updated_at=now()`,
		pid, rel, ct, len(data))
	return err
}
