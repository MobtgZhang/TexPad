package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type createProjectReq struct {
	Name         string `json:"name"`
	MainTexPath  string `json:"main_tex_path"`
	Template     string `json:"template"` // blank (default) | sample
}

const defaultMainTex = `\documentclass{article}
\usepackage[utf8]{inputenc}
\begin{document}
Hello TexPad!
\end{document}
`

const sampleArticleTex = `\documentclass[11pt,a4paper]{article}
\usepackage[utf8]{inputenc}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{hyperref}
\title{学术论文示例模板\\\large 含摘要、章节与参考文献结构}
\author{作者姓名}
\date{\today}
\begin{document}
\maketitle
\begin{abstract}
这是一段摘要示例。请替换为研究背景、方法、结果与结论等真实内容。
\end{abstract}

\section{引言}
\label{sec:intro}
介绍问题动机与相关工作\cite{example}，并说明本文贡献。

\section{方法}
描述技术路线。公式示例：对 $x \in \mathbb{R}$，
\begin{equation}
  f(x) = \sum_{i=1}^{n} w_i \phi_i(x).
\end{equation}

\section{实验与讨论}
在此汇报主要结果、图表与局限性分析。

\section{结论}
总结贡献并展望未来工作。

\begin{thebibliography}{9}
\bibitem{example} Author, \emph{Sample Reference Title}, Conference, 2024.
\end{thebibliography}
\end{document}
`

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid, _ := UserID(ctx)
	view := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("view")))
	if view == "" {
		view = "all"
	}
	var viewSQL string
	switch view {
	case "all":
		// 未删除且未归档：归档项仅在 view=archived 中列出
		viewSQL = "AND p.deleted_at IS NULL AND p.archived_at IS NULL"
	case "mine":
		viewSQL = "AND p.owner_id = $1 AND p.deleted_at IS NULL AND p.archived_at IS NULL"
	case "shared":
		viewSQL = "AND p.owner_id <> $1 AND m.user_id IS NOT NULL AND p.deleted_at IS NULL AND p.archived_at IS NULL"
	case "archived":
		viewSQL = "AND p.owner_id = $1 AND p.archived_at IS NOT NULL AND p.deleted_at IS NULL"
	case "trash":
		viewSQL = "AND p.owner_id = $1 AND p.deleted_at IS NOT NULL"
	default:
		writeError(w, http.StatusBadRequest, "invalid view")
		return
	}
	q := fmt.Sprintf(`
SELECT p.id, p.name, p.main_tex_path, p.created_at, p.owner_id, p.archived_at, p.deleted_at,
  (p.owner_id = $1) AS is_owner,
  (SELECT pm.role FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1 LIMIT 1) AS member_role,
  (SELECT MAX(f.updated_at) FROM project_files f WHERE f.project_id = p.id) AS last_edited,
  (SELECT j.id::text FROM compile_jobs j WHERE j.project_id = p.id AND j.status = 'success' AND COALESCE(j.pdf_object_key, '') <> '' ORDER BY j.updated_at DESC LIMIT 1) AS latest_pdf_job_id
FROM projects p
LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
WHERE (p.owner_id = $1 OR m.user_id IS NOT NULL)
%s
ORDER BY COALESCE((SELECT MAX(f.updated_at) FROM project_files f WHERE f.project_id = p.id), p.created_at) DESC`, viewSQL)
	rows, err := s.pool.Query(ctx, q, uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id, ownerID uuid.UUID
		var name, main string
		var ts any
		var archivedAt, deletedAt *time.Time
		var isOwner bool
		var memberRole *string
		var lastEdited any
		var latestPDF *string
		if err := rows.Scan(&id, &name, &main, &ts, &ownerID, &archivedAt, &deletedAt, &isOwner, &memberRole, &lastEdited, &latestPDF); err != nil {
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		role := "viewer"
		if isOwner {
			role = "owner"
		} else if memberRole != nil && *memberRole != "" {
			role = *memberRole
		}
		item := map[string]any{
			"id": id.String(), "name": name, "main_tex_path": main, "created_at": ts, "last_edited": lastEdited,
			"owner_id": ownerID.String(), "is_owner": isOwner, "role": role,
			"archived_at": archivedAt, "deleted_at": deletedAt,
		}
		if latestPDF != nil {
			item["latest_pdf_job_id"] = *latestPDF
		} else {
			item["latest_pdf_job_id"] = nil
		}
		list = append(list, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": list, "view": view})
}

func (s *Server) newProject(ctx context.Context, uid uuid.UUID, name, mainPath string) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `INSERT INTO projects (owner_id, name, main_tex_path) VALUES ($1,$2,$3) RETURNING id`,
		uid, name, mainPath).Scan(&id)
	if err != nil {
		return uuid.Nil, err
	}
	_, _ = s.pool.Exec(ctx, `INSERT INTO project_members (project_id, user_id, role) VALUES ($1,$2,'editor') ON CONFLICT DO NOTHING`, id, uid)
	return id, nil
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
	id, err := s.newProject(ctx, uid, req.Name, main)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	content := defaultMainTex
	if strings.EqualFold(strings.TrimSpace(req.Template), "sample") {
		content = sampleArticleTex
	}
	if err := s.putTextFile(ctx, id, main, content); err != nil {
		_, _ = s.pool.Exec(ctx, `DELETE FROM projects WHERE id=$1`, id)
		writeError(w, http.StatusInternalServerError, "storage error")
		return
	}
	if err := s.EnsureAgentWorkspace(ctx, id); err != nil {
		s.log.Warn("ensure agent workspace", "project", id, "err", err)
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
	if err := s.EnsureAgentWorkspace(ctx, pid); err != nil {
		s.log.Warn("ensure agent workspace", "project", pid, "err", err)
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
	var deletedAt *time.Time
	if err := s.pool.QueryRow(ctx, `SELECT deleted_at FROM projects WHERE id=$1`, pid).Scan(&deletedAt); err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if deletedAt == nil {
		writeError(w, http.StatusBadRequest, "use trash first")
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
	var name, main string
	_ = s.pool.QueryRow(ctx, `SELECT name, main_tex_path FROM projects WHERE id=$1`, pid).Scan(&name, &main)
	if err := s.EnsureAgentWorkspace(ctx, pid); err != nil {
		s.log.Warn("ensure agent workspace", "project", pid, "err", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": pid.String(), "name": name, "main_tex_path": main, "share_role": role})
}
