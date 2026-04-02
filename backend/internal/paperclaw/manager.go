package paperclaw

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Manager 运行 Paperclaw 占位异步任务（关网页后仍由服务端继续）。
type Manager struct {
	pool    *pgxpool.Pool
	log     *slog.Logger
	workers int
	jobs    chan uuid.UUID
}

func NewManager(pool *pgxpool.Pool, log *slog.Logger, workers int) *Manager {
	if workers < 1 {
		workers = 2
	}
	return &Manager{
		pool:    pool,
		log:     log,
		workers: workers,
		jobs:    make(chan uuid.UUID, 64),
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
					m.runStubJob(context.Background(), id)
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

func (m *Manager) runStubJob(ctx context.Context, jobID uuid.UUID) {
	steps := []struct {
		msg string
		pct int
	}{
		{"准备论文结构…", 15},
		{"收集章节大纲（占位）…", 35},
		{"生成草稿内容（占位）…", 55},
		{"排版与引用检查（占位）…", 80},
		{"完成", 100},
	}
	_, err := m.pool.Exec(ctx, `UPDATE paperclaw_jobs SET status=$1, step=$2, progress=$3, message=$4, updated_at=now() WHERE id=$5`,
		"running", 0, 0, "已开始", jobID)
	if err != nil {
		m.log.Error("paperclaw start", "job", jobID, "err", err)
		return
	}
	for i, st := range steps {
		time.Sleep(2 * time.Second)
		_, err := m.pool.Exec(ctx, `UPDATE paperclaw_jobs SET step=$1, progress=$2, message=$3, updated_at=now() WHERE id=$4`,
			i+1, st.pct, st.msg, jobID)
		if err != nil {
			m.log.Error("paperclaw step", "job", jobID, "err", err)
			_, _ = m.pool.Exec(ctx, `UPDATE paperclaw_jobs SET status=$1, message=$2, updated_at=now() WHERE id=$3`,
				"failed", "内部错误：更新进度失败", jobID)
			return
		}
	}
	_, _ = m.pool.Exec(ctx, `UPDATE paperclaw_jobs SET status=$1, message=$2, updated_at=now() WHERE id=$3`,
		"success", "占位流程已完成；后续版本将接入真实论文生成。", jobID)
}
