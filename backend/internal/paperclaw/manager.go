package paperclaw

import (
	"context"
	"errors"
	"log/slog"
	"sync"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// JobRunner 执行单个 Paperclaw 任务（由 httpapi 注入，以便访问 Agent 与存储）。
type JobRunner func(ctx context.Context, jobID uuid.UUID) error

// Manager 运行 Paperclaw 异步任务（关网页后仍由服务端继续）。
type Manager struct {
	pool    *pgxpool.Pool
	log     *slog.Logger
	workers int
	jobs    chan uuid.UUID
	run     JobRunner
}

func NewManager(pool *pgxpool.Pool, log *slog.Logger, workers int, run JobRunner) *Manager {
	if workers < 1 {
		workers = 2
	}
	return &Manager{
		pool:    pool,
		log:     log,
		workers: workers,
		jobs:    make(chan uuid.UUID, 64),
		run:     run,
	}
}

func (m *Manager) Start(ctx context.Context) {
	var wg sync.WaitGroup
	for i := 0; i < m.workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case id := <-m.jobs:
					m.runJob(context.Background(), id)
				}
			}
		}()
	}
	<-ctx.Done()
	wg.Wait()
}

func (m *Manager) Enqueue(jobID uuid.UUID) {
	select {
	case m.jobs <- jobID:
	default:
		go func() { m.jobs <- jobID }()
	}
}

func (m *Manager) runJob(ctx context.Context, jobID uuid.UUID) {
	if m.run == nil {
		m.log.Error("paperclaw runner not configured", "job", jobID)
		_, _ = m.pool.Exec(ctx, `UPDATE paperclaw_jobs SET status=$1, message=$2, updated_at=now() WHERE id=$3`,
			"failed", "Paperclaw 执行器未配置", jobID)
		return
	}
	if err := m.run(ctx, jobID); err != nil && !errors.Is(err, context.Canceled) {
		m.log.Error("paperclaw job failed", "job", jobID, "err", err)
	}
}
