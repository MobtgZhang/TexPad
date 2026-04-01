package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
	"github.com/mobtgzhang/TexPad/backend/internal/agent"
	"github.com/mobtgzhang/TexPad/backend/internal/compile"
	"github.com/mobtgzhang/TexPad/backend/internal/config"
	"github.com/mobtgzhang/TexPad/backend/internal/db"
	"github.com/mobtgzhang/TexPad/backend/internal/httpapi"
	"github.com/mobtgzhang/TexPad/backend/internal/storage"
)

func main() {
	_ = godotenv.Load()
	_ = godotenv.Load("../.env")
	_ = godotenv.Load("../../.env")

	cfg := config.Load()
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	ctx := context.Background()
	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("db", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	rdb := redis.NewClient(&redis.Options{Addr: cfg.RedisAddr})
	defer rdb.Close()
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Warn("redis unavailable, rate limit/cache degraded", "err", err)
	}

	st, err := storage.New(cfg.MinioEndpoint, cfg.MinioAccess, cfg.MinioSecret, cfg.MinioUseSSL, cfg.MinioBucket)
	if err != nil {
		log.Error("minio", "err", err)
		os.Exit(1)
	}
	if err := st.EnsureBucket(ctx); err != nil {
		log.Error("bucket", "err", err)
		os.Exit(1)
	}

	comp := compile.NewManager(pool, st, cfg.DockerBin, cfg.TexliveImage, 4, rdb, log, cfg.CompileNative)
	ag := agent.New(cfg, pool)
	srv := httpapi.New(cfg, log, pool, rdb, st, comp, ag)

	comp.OnFinish = func(projectID, jobID uuid.UUID) {
		srv.PublishCompileDone(projectID, jobID)
	}

	ctxWorkers, cancelWorkers := context.WithCancel(context.Background())
	defer cancelWorkers()
	go comp.Start(ctxWorkers)

	h := srv.Router()
	httpSrv := &http.Server{Addr: cfg.HTTPAddr, Handler: h, ReadHeaderTimeout: 10 * time.Second}

	go func() {
		log.Info("listening", "addr", cfg.HTTPAddr)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("server", "err", err)
			os.Exit(1)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	cancelWorkers()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}
