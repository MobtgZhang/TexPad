package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

type createCommentReq struct {
	Path     string `json:"path"`
	Line     int    `json:"line"`
	Body     string `json:"body"`
	EndLine  *int   `json:"end_line"`
	StartCol *int   `json:"start_col"`
	EndCol   *int   `json:"end_col"`
	Quote    string `json:"quote"`
}

func (s *Server) handleListComments(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	rows, err := s.pool.Query(ctx, `
SELECT c.id, c.path, c.line, c.body, c.created_at, u.email,
       c.end_line, c.start_col, c.end_col, c.quote
FROM project_comments c
JOIN users u ON u.id = c.user_id
WHERE c.project_id=$1
ORDER BY c.created_at DESC
LIMIT 200`, pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var path, body, email string
		var line int
		var ts time.Time
		var endLine, startCol, endCol *int
		var quote *string
		if err := rows.Scan(&id, &path, &line, &body, &ts, &email, &endLine, &startCol, &endCol, &quote); err != nil {
			writeError(w, http.StatusInternalServerError, "scan")
			return
		}
		m := map[string]any{
			"id": id.String(), "path": path, "line": line, "body": body,
			"created_at": ts, "author_email": email,
		}
		if endLine != nil {
			m["end_line"] = *endLine
		}
		if startCol != nil {
			m["start_col"] = *startCol
		}
		if endCol != nil {
			m["end_col"] = *endCol
		}
		if quote != nil && *quote != "" {
			m["quote"] = *quote
		}
		list = append(list, m)
	}
	writeJSON(w, http.StatusOK, map[string]any{"comments": list})
}

func (s *Server) handleCreateComment(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	pid := projectIDFrom(ctx)
	uid, _ := UserID(ctx)
	var req createCommentReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	rel, ok := sanitizeRelPath(req.Path)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}
	body := strings.TrimSpace(req.Body)
	if body == "" || req.Line < 1 {
		writeError(w, http.StatusBadRequest, "invalid comment")
		return
	}

	q := strings.TrimSpace(req.Quote)
	endLine := req.Line
	startCol := 1
	endCol := 1
	var quotePtr *string

	if q != "" {
		if req.EndLine == nil || *req.EndLine < req.Line {
			writeError(w, http.StatusBadRequest, "invalid range")
			return
		}
		if req.StartCol == nil || *req.StartCol < 1 || req.EndCol == nil || *req.EndCol < 1 {
			writeError(w, http.StatusBadRequest, "invalid columns")
			return
		}
		endLine = *req.EndLine
		startCol = *req.StartCol
		endCol = *req.EndCol
		quotePtr = &q
	} else {
		if req.EndLine != nil && *req.EndLine >= req.Line {
			endLine = *req.EndLine
		}
		if req.StartCol != nil && *req.StartCol >= 1 {
			startCol = *req.StartCol
		}
		if req.EndCol != nil && *req.EndCol >= 1 {
			endCol = *req.EndCol
		}
	}

	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
INSERT INTO project_comments (project_id, path, line, end_line, start_col, end_col, quote, body, user_id)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
		pid, rel, req.Line, endLine, startCol, endCol, quotePtr, body, uid).Scan(&id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id.String()})
}
