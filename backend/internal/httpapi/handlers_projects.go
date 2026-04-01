package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type createProjectReq struct {
	Name         string `json:"name"`
	MainTexPath  string `json:"main_tex_path"`
}

const defaultMainTex = `\documentclass{article}
\usepackage[utf8]{inputenc}
\begin{document}
Hello TexPad!
\end{document}
`

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid, _ := UserID(ctx)
	rows, err := s.pool.Query(ctx, `
SELECT p.id, p.name, p.main_tex_path, p.created_at
FROM projects p
LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
WHERE p.owner_id = $1 OR m.user_id IS NOT NULL
ORDER BY p.created_at DESC`, uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var name, main string
		var ts any
		if err := rows.Scan(&id, &name, &main, &ts); err != nil {
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		list = append(list, map[string]any{"id": id.String(), "name": name, "main_tex_path": main, "created_at": ts})
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": list})
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid, _ := UserID(ctx)
	var req createProjectReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		req.Name = "Untitled"
	}
	main := strings.TrimSpace(req.MainTexPath)
	if main == "" {
		main = "main.tex"
	}
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `INSERT INTO projects (owner_id, name, main_tex_path) VALUES ($1,$2,$3) RETURNING id`,
		uid, req.Name, main).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	_, _ = s.pool.Exec(ctx, `INSERT INTO project_members (project_id, user_id, role) VALUES ($1,$2,'editor') ON CONFLICT DO NOTHING`, id, uid)
	if err := s.putTextFile(ctx, id, main, defaultMainTex); err != nil {
		writeError(w, http.StatusInternalServerError, "storage error")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id.String(), "name": req.Name, "main_tex_path": main})
}

func (s *Server) putTextFile(ctx context.Context, projectID uuid.UUID, path, content string) error {
	r := strings.NewReader(content)
	if err := s.store.PutFile(ctx, projectID, path, r, int64(len(content)), "text/plain"); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `
INSERT INTO project_files (project_id, path, content_type, size_bytes, updated_at)
VALUES ($1,$2,$3,$4, now())
ON CONFLICT (project_id, path) DO UPDATE SET content_type=EXCLUDED.content_type, size_bytes=EXCLUDED.size_bytes, updated_at=now()`,
		projectID, path, "text/plain", len(content))
	return err
}

func (s *Server) handleGetProject(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	var name, main string
	var owner uuid.UUID
	var ts any
	err := s.pool.QueryRow(ctx, `SELECT name, main_tex_path, owner_id, created_at FROM projects WHERE id=$1`, pid).Scan(&name, &main, &owner, &ts)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": pid.String(), "name": name, "main_tex_path": main, "owner_id": owner.String(), "created_at": ts,
		"role": projectRoleFrom(ctx),
	})
}

type patchProjectReq struct {
	Name        *string `json:"name"`
	MainTexPath *string `json:"main_tex_path"`
}

func (s *Server) handlePatchProject(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	var req patchProjectReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Name != nil && strings.TrimSpace(*req.Name) != "" {
		_, _ = s.pool.Exec(ctx, `UPDATE projects SET name=$1 WHERE id=$2`, strings.TrimSpace(*req.Name), pid)
	}
	if req.MainTexPath != nil && strings.TrimSpace(*req.MainTexPath) != "" {
		_, _ = s.pool.Exec(ctx, `UPDATE projects SET main_tex_path=$1 WHERE id=$2`, strings.TrimSpace(*req.MainTexPath), pid)
	}
	s.handleGetProject(w, r.WithContext(ctx))
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	if projectRoleFrom(ctx) != "owner" {
		writeError(w, http.StatusForbidden, "owner only")
		return
	}
	_, err := s.pool.Exec(ctx, `DELETE FROM projects WHERE id=$1`, pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleShareProject(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	token := chi.URLParam(r, "token")
	var pid uuid.UUID
	var role string
	err := s.pool.QueryRow(ctx, `SELECT project_id, role FROM project_shares WHERE token=$1`, token).Scan(&pid, &role)
	if err != nil {
		writeError(w, http.StatusNotFound, "invalid share")
		return
	}
	var name, main string
	_ = s.pool.QueryRow(ctx, `SELECT name, main_tex_path FROM projects WHERE id=$1`, pid).Scan(&name, &main)
	writeJSON(w, http.StatusOK, map[string]any{"id": pid.String(), "name": name, "main_tex_path": main, "share_role": role})
}
