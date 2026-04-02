package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type addMemberReq struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

func (s *Server) handleListProjectMembers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	role := projectRoleFrom(ctx)
	if role == "" {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	pid := projectIDFrom(ctx)

	var ownerID uuid.UUID
	err := s.pool.QueryRow(ctx, `SELECT owner_id FROM projects WHERE id=$1`, pid).Scan(&ownerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}

	type row struct {
		UserID uuid.UUID `json:"user_id"`
		Email  string    `json:"email"`
		Role   string    `json:"role"`
	}
	var out []row

	var ownerEmail string
	if err := s.pool.QueryRow(ctx, `SELECT email FROM users WHERE id=$1`, ownerID).Scan(&ownerEmail); err == nil {
		out = append(out, row{UserID: ownerID, Email: ownerEmail, Role: "owner"})
	}

	rows, err := s.pool.Query(ctx, `
SELECT pm.user_id, u.email, pm.role
FROM project_members pm
JOIN users u ON u.id = pm.user_id
WHERE pm.project_id=$1
ORDER BY u.email`, pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	for rows.Next() {
		var uid uuid.UUID
		var em, rl string
		if err := rows.Scan(&uid, &em, &rl); err != nil {
			writeError(w, http.StatusInternalServerError, "scan")
			return
		}
		out = append(out, row{UserID: uid, Email: em, Role: rl})
	}
	writeJSON(w, http.StatusOK, map[string]any{"members": out})
}

func (s *Server) handleAddProjectMember(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) != "owner" {
		writeError(w, http.StatusForbidden, "owner only")
		return
	}
	pid := projectIDFrom(ctx)
	var req addMemberReq
	_ = json.NewDecoder(r.Body).Decode(&req)
	email := strings.TrimSpace(strings.ToLower(req.Email))
	if email == "" {
		writeError(w, http.StatusBadRequest, "missing email")
		return
	}
	rl := strings.TrimSpace(req.Role)
	if rl == "" {
		rl = "editor"
	}
	if rl != "editor" && rl != "viewer" {
		rl = "editor"
	}

	var owner uuid.UUID
	if err := s.pool.QueryRow(ctx, `SELECT owner_id FROM projects WHERE id=$1`, pid).Scan(&owner); err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}

	var uid uuid.UUID
	err := s.pool.QueryRow(ctx, `SELECT id FROM users WHERE lower(email)=$1`, email).Scan(&uid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	if uid == owner {
		writeError(w, http.StatusBadRequest, "owner already has access")
		return
	}

	_, err = s.pool.Exec(ctx, `
INSERT INTO project_members (project_id, user_id, role) VALUES ($1,$2,$3)
ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`, pid, uid, rl)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (s *Server) handleRemoveProjectMember(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) != "owner" {
		writeError(w, http.StatusForbidden, "owner only")
		return
	}
	pid := projectIDFrom(ctx)
	uidStr := strings.TrimSpace(chi.URLParam(r, "userID"))
	uid, err := uuid.Parse(uidStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad user id")
		return
	}

	var owner uuid.UUID
	if err := s.pool.QueryRow(ctx, `SELECT owner_id FROM projects WHERE id=$1`, pid).Scan(&owner); err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	if uid == owner {
		writeError(w, http.StatusBadRequest, "cannot remove owner")
		return
	}

	tag, err := s.pool.Exec(ctx, `DELETE FROM project_members WHERE project_id=$1 AND user_id=$2`, pid, uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "not a member")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
