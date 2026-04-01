package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mobtgzhang/TexPad/backend/internal/auth"
	"github.com/mobtgzhang/TexPad/backend/internal/ratelimit"
)

type registerReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	ip := r.RemoteAddr
	if ok, _ := s.rl.Allow(ctx, ratelimit.ClientIPKey("reg", ip), 20, time.Minute); !ok {
		writeError(w, http.StatusTooManyRequests, "rate limited")
		return
	}
	var req registerReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if len(req.Password) < 8 || !strings.Contains(req.Email, "@") {
		writeError(w, http.StatusBadRequest, "invalid email or password")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash failed")
		return
	}
	var id uuid.UUID
	err = s.pool.QueryRow(ctx, `INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id`, req.Email, hash).Scan(&id)
	if err != nil {
		writeError(w, http.StatusConflict, "email taken")
		return
	}
	tok, err := auth.SignJWT([]byte(s.cfg.JWTSecret), id, 24*time.Hour)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "token error")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"token": tok, "user": map[string]string{"id": id.String(), "email": req.Email}})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	ip := r.RemoteAddr
	if ok, _ := s.rl.Allow(ctx, ratelimit.ClientIPKey("login", ip), 40, time.Minute); !ok {
		writeError(w, http.StatusTooManyRequests, "rate limited")
		return
	}
	var req loginReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	var id uuid.UUID
	var enc string
	err := s.pool.QueryRow(ctx, `SELECT id, password_hash FROM users WHERE email=$1`, req.Email).Scan(&id, &enc)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	ok, err := auth.VerifyPassword(req.Password, enc)
	if err != nil || !ok {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	tok, err := auth.SignJWT([]byte(s.cfg.JWTSecret), id, 24*time.Hour)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "token error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": tok, "user": map[string]string{"id": id.String(), "email": req.Email}})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid, _ := UserID(ctx)
	var email string
	_ = s.pool.QueryRow(ctx, `SELECT email FROM users WHERE id=$1`, uid).Scan(&email)
	writeJSON(w, http.StatusOK, map[string]string{"id": uid.String(), "email": email})
}
