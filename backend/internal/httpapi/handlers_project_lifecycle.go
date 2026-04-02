package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/mobtgzhang/TexPad/backend/internal/storage"
)

type duplicateProjectReq struct {
	Name string `json:"name"`
}

func (s *Server) handleTrashProject(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) != "owner" {
		writeError(w, http.StatusForbidden, "owner only")
		return
	}
	pid := projectIDFrom(ctx)
	tag, err := s.pool.Exec(ctx, `UPDATE projects SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusBadRequest, "already trashed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRestoreProject(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) != "owner" {
		writeError(w, http.StatusForbidden, "owner only")
		return
	}
	pid := projectIDFrom(ctx)
	tag, err := s.pool.Exec(ctx, `UPDATE projects SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL`, pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusBadRequest, "not in trash")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleArchiveProject(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) != "owner" {
		writeError(w, http.StatusForbidden, "owner only")
		return
	}
	pid := projectIDFrom(ctx)
	tag, err := s.pool.Exec(ctx, `
UPDATE projects SET archived_at = now()
WHERE id = $1 AND deleted_at IS NULL AND archived_at IS NULL`, pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusBadRequest, "cannot archive")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUnarchiveProject(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) != "owner" {
		writeError(w, http.StatusForbidden, "owner only")
		return
	}
	pid := projectIDFrom(ctx)
	tag, err := s.pool.Exec(ctx, `UPDATE projects SET archived_at = NULL WHERE id = $1 AND archived_at IS NOT NULL AND deleted_at IS NULL`, pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusBadRequest, "not archived")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

var reCopyName = regexp.MustCompile(`^复制(\d+)$`)

func (s *Server) nextDuplicateProjectName(ctx context.Context, uid uuid.UUID) (string, error) {
	rows, err := s.pool.Query(ctx, `SELECT name FROM projects WHERE owner_id = $1`, uid)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	maxN := 0
	hasBare := false
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return "", err
		}
		if n == "复制" {
			hasBare = true
			continue
		}
		m := reCopyName.FindStringSubmatch(n)
		if len(m) == 2 {
			v, _ := strconv.Atoi(m[1])
			if v > maxN {
				maxN = v
			}
		}
	}
	if hasBare && maxN == 0 {
		return "复制1", nil
	}
	return "复制" + strconv.Itoa(maxN+1), nil
}

func (s *Server) handleDuplicateProject(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	uid, _ := UserID(ctx)

	var req duplicateProjectReq
	if r.Body != nil {
		dec := json.NewDecoder(r.Body)
		_ = dec.Decode(&req)
		_ = r.Body.Close()
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		var err error
		name, err = s.nextDuplicateProjectName(ctx, uid)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "db error")
			return
		}
	}

	var mainPath string
	err := s.pool.QueryRow(ctx, `SELECT main_tex_path FROM projects WHERE id=$1`, pid).Scan(&mainPath)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	rows, err := s.pool.Query(ctx, `SELECT path, content_type, size_bytes FROM project_files WHERE project_id=$1 ORDER BY path`, pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	type fileRow struct {
		path, ct string
		sz       int64
	}
	var files []fileRow
	for rows.Next() {
		var fr fileRow
		if err := rows.Scan(&fr.path, &fr.ct, &fr.sz); err != nil {
			writeError(w, http.StatusInternalServerError, "scan")
			return
		}
		files = append(files, fr)
	}

	newID, err := s.newProject(ctx, uid, name, mainPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}

	for _, fr := range files {
		srcKey := storage.ProjectFileKey(pid, fr.path)
		dstKey := storage.ProjectFileKey(newID, fr.path)
		if err := s.store.CopyObject(ctx, srcKey, dstKey); err != nil {
			_, _ = s.pool.Exec(ctx, `DELETE FROM projects WHERE id=$1`, newID)
			writeError(w, http.StatusInternalServerError, "storage error")
			return
		}
		ct := fr.ct
		if ct == "" {
			ct = "application/octet-stream"
		}
		_, err = s.pool.Exec(ctx, `
INSERT INTO project_files (project_id, path, content_type, size_bytes, updated_at)
VALUES ($1,$2,$3,$4, now())`,
			newID, fr.path, ct, fr.sz)
		if err != nil {
			_, _ = s.pool.Exec(ctx, `DELETE FROM projects WHERE id=$1`, newID)
			writeError(w, http.StatusInternalServerError, "db error")
			return
		}
	}

	writeJSON(w, http.StatusCreated, map[string]any{"id": newID.String(), "name": name, "main_tex_path": mainPath})
}

func (s *Server) handleLatestPDFDownload(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	var pdfKey string
	err := s.pool.QueryRow(ctx, `
SELECT pdf_object_key FROM compile_jobs
WHERE project_id=$1 AND status='success' AND COALESCE(pdf_object_key,'') <> ''
ORDER BY updated_at DESC LIMIT 1`, pid).Scan(&pdfKey)
	if err != nil || pdfKey == "" {
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
	w.Header().Set("Content-Disposition", `attachment; filename="output.pdf"`)
	_, _ = io.Copy(w, obj)
}
