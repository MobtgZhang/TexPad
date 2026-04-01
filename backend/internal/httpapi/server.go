package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/mobtgzhang/TexPad/backend/internal/agent"
	"github.com/mobtgzhang/TexPad/backend/internal/auth"
	"github.com/mobtgzhang/TexPad/backend/internal/compile"
	"github.com/mobtgzhang/TexPad/backend/internal/config"
	"github.com/mobtgzhang/TexPad/backend/internal/ratelimit"
	"github.com/mobtgzhang/TexPad/backend/internal/storage"
)

type Server struct {
	cfg    config.Config
	log    *slog.Logger
	pool   *pgxpool.Pool
	rdb    *redis.Client
	store  *storage.Client
	comp   *compile.Manager
	agent  *agent.Service
	rl     *ratelimit.Redis
	notify *compileNotifier
}

func New(cfg config.Config, log *slog.Logger, pool *pgxpool.Pool, rdb *redis.Client, store *storage.Client, comp *compile.Manager, ag *agent.Service) *Server {
	return &Server{
		cfg:    cfg,
		log:    log,
		pool:   pool,
		rdb:    rdb,
		store:  store,
		comp:   comp,
		agent:  ag,
		rl:     ratelimit.New(rdb),
		notify: newCompileNotifier(),
	}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(securityHeaders)
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Share-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/auth/register", s.handleRegister)
		r.Post("/auth/login", s.handleLogin)

		r.Route("/share/{token}", func(r chi.Router) {
			r.Get("/project", s.handleShareProject)
			r.Get("/files/*", s.handleShareGetFile)
		})

		r.Group(func(r chi.Router) {
			r.Use(s.authMiddleware)
			r.Get("/me", s.handleMe)
			r.Get("/projects", s.handleListProjects)
			r.Post("/projects", s.handleCreateProject)
			r.Route("/projects/{projectID}", func(r chi.Router) {
				r.Use(s.projectAccessMiddleware)
				r.Get("/", s.handleGetProject)
				r.Patch("/", s.handlePatchProject)
				r.Delete("/", s.handleDeleteProject)

				r.Get("/files", s.handleListFiles)
				r.Get("/files/*", s.handleGetFile)
				r.Put("/files/*", s.handlePutFile)
				r.Delete("/files/*", s.handleDeleteFile)
				r.Post("/files/upload", s.handleUploadFile)

				r.Post("/compile", s.handleCompile)
				r.Get("/compile/jobs/{jobID}", s.handleCompileJob)
				r.Get("/pdf/{jobID}", s.handlePDFPresign)
				r.Get("/pdf/{jobID}/download", s.handlePDFDownload)
				r.Get("/ws", s.handleCompileWS)

				r.Post("/shares", s.handleCreateShare)
				r.Get("/snapshots", s.handleListSnapshots)
				r.Post("/snapshots", s.handleCreateSnapshot)
				r.Post("/snapshots/{snapshotID}/restore", s.handleRestoreSnapshot)
				r.Get("/export.zip", s.handleExportZip)
				r.Post("/import.zip", s.handleImportZip)

				r.Post("/agent/stream", s.handleAgentStream)
				r.Get("/agent/suggest", s.handleAgentSuggest)
				r.Get("/agent/papers", s.handleAgentPapers)
			})

			r.Get("/agent/memories", s.handleAgentMemories)
			r.Post("/agent/feedback", s.handleAgentFeedback)
		})
	})

	return r
}

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var tok string
		h := r.Header.Get("Authorization")
		const p = "Bearer "
		if len(h) >= len(p) && h[:len(p)] == p {
			tok = h[len(p):]
		} else if strings.HasSuffix(r.URL.Path, "/ws") {
			tok = r.URL.Query().Get("token")
		}
		if tok == "" {
			writeError(w, http.StatusUnauthorized, "missing bearer token")
			return
		}
		uid, err := auth.ParseJWT([]byte(s.cfg.JWTSecret), tok)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid token")
			return
		}
		next.ServeHTTP(w, r.WithContext(WithUserID(r.Context(), uid)))
	})
}

func (s *Server) projectAccessMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pid, err := uuid.Parse(chi.URLParam(r, "projectID"))
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid project id")
			return
		}
		uid, ok := UserID(r.Context())
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		role, err := s.projectRole(r.Context(), uid, pid)
		if err != nil {
			writeError(w, http.StatusForbidden, "forbidden")
			return
		}
		ctx := context.WithValue(r.Context(), ctxProjID{}, pid)
		ctx = context.WithValue(ctx, ctxProjRole{}, role)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

type ctxProjID struct{}
type ctxProjRole struct{}

func projectIDFrom(ctx context.Context) uuid.UUID {
	v, _ := ctx.Value(ctxProjID{}).(uuid.UUID)
	return v
}

func projectRoleFrom(ctx context.Context) string {
	v, _ := ctx.Value(ctxProjRole{}).(string)
	return v
}

func (s *Server) PublishCompileDone(projectID, jobID uuid.UUID) {
	s.notify.publish(projectID, jobID)
}

func (s *Server) projectRole(ctx context.Context, userID, projectID uuid.UUID) (string, error) {
	var owner uuid.UUID
	if err := s.pool.QueryRow(ctx, `SELECT owner_id FROM projects WHERE id=$1`, projectID).Scan(&owner); err != nil {
		return "", err
	}
	if owner == userID {
		return "owner", nil
	}
	var role string
	err := s.pool.QueryRow(ctx, `SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2`, projectID, userID).Scan(&role)
	if err != nil {
		return "", err
	}
	return role, nil
}
