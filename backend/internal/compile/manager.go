package compile

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/mobtgzhang/TexPad/backend/internal/parse"
	"github.com/mobtgzhang/TexPad/backend/internal/storage"
)

type Manager struct {
	pool         *pgxpool.Pool
	store        *storage.Client
	dockerBin    string
	texImage     string
	workers      int
	jobs         chan uuid.UUID
	rdb          *redis.Client
	logger       *slog.Logger
	cacheEnabled bool
	native       bool
	OnFinish     func(projectID, jobID uuid.UUID)
}

func NewManager(pool *pgxpool.Pool, store *storage.Client, dockerBin, texImage string, workers int, rdb *redis.Client, logger *slog.Logger, native bool) *Manager {
	if workers < 1 {
		workers = 2
	}
	return &Manager{
		pool:         pool,
		store:        store,
		dockerBin:    dockerBin,
		texImage:     texImage,
		workers:      workers,
		jobs:         make(chan uuid.UUID, 256),
		rdb:          rdb,
		logger:       logger,
		cacheEnabled: true,
		native:       native,
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
	var projectID uuid.UUID
	var engine, mainPath string
	err := m.pool.QueryRow(ctx, `SELECT project_id, engine FROM compile_jobs WHERE id=$1`, jobID).Scan(&projectID, &engine)
	if err != nil {
		m.logger.Error("compile job lookup", "job", jobID, "err", err)
		return
	}
	defer func() {
		if m.OnFinish != nil {
			m.OnFinish(projectID, jobID)
		}
	}()
	_, _ = m.pool.Exec(ctx, `UPDATE compile_jobs SET status=$1, updated_at=now() WHERE id=$2`, "running", jobID)
	_ = m.pool.QueryRow(ctx, `SELECT main_tex_path FROM projects WHERE id=$1`, projectID).Scan(&mainPath)
	if mainPath == "" {
		mainPath = "main.tex"
	}

	tmp, err := os.MkdirTemp("", "texpad-compile-*")
	if err != nil {
		m.fail(ctx, jobID, err.Error())
		return
	}
	defer os.RemoveAll(tmp)

	contentHash, err := m.materializeProject(ctx, projectID, tmp)
	if err != nil {
		m.fail(ctx, jobID, err.Error())
		return
	}

	cacheKey := ""
	if m.cacheEnabled && m.rdb != nil {
		h := sha256.Sum256([]byte(contentHash + "|" + engine + "|" + mainPath))
		cacheKey = "compile:cache:" + hex.EncodeToString(h[:])
		if s, err := m.rdb.Get(ctx, cacheKey).Result(); err == nil && s != "" {
			var cached struct {
				PDFKey string `json:"pdf"`
				Log    string `json:"log"`
			}
			if json.Unmarshal([]byte(s), &cached) == nil && cached.PDFKey != "" {
				newKey := storage.ArtifactPDFKey(projectID, jobID)
				if err := m.store.CopyObject(ctx, cached.PDFKey, newKey); err == nil {
					_, _ = m.pool.Exec(ctx, `UPDATE compile_jobs SET status=$1, pdf_object_key=$2, log_text=$3, updated_at=now() WHERE id=$4`,
						"success", newKey, cached.Log, jobID)
					return
				}
			}
		}
	}

	mainBase := filepath.Base(mainPath)
	logPath := filepath.Join(tmp, "build.log")
	pdfHostPath := filepath.Join(tmp, strings.TrimSuffix(mainBase, filepath.Ext(mainBase))+".pdf")

	var latexmkLine string
	switch engine {
	case "xelatex":
		latexmkLine = fmt.Sprintf("latexmk -xelatex -interaction=nonstopmode -halt-on-error %q > build.log 2>&1", mainBase)
	case "lualatex":
		latexmkLine = fmt.Sprintf("latexmk -lualatex -interaction=nonstopmode -halt-on-error %q > build.log 2>&1", mainBase)
	default:
		engine = "pdflatex"
		latexmkLine = fmt.Sprintf("latexmk -pdf -interaction=nonstopmode -halt-on-error %q > build.log 2>&1", mainBase)
	}

	cctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	if m.native {
		cmd := exec.CommandContext(cctx, "sh", "-c", latexmkLine)
		cmd.Dir = tmp
		cmd.Env = os.Environ()
		cmd.Stdout = io.Discard
		cmd.Stderr = io.Discard
		_ = cmd.Run()
	} else {
		dockerArgs := []string{
			"run", "--rm",
			"--memory=512m", "--cpus=1",
			"-v", tmp + ":/work",
			"-w", "/work",
			m.texImage,
			"sh", "-c", latexmkLine,
		}
		cmd := exec.CommandContext(cctx, m.dockerBin, dockerArgs...)
		cmd.Stdout = io.Discard
		cmd.Stderr = io.Discard
		_ = cmd.Run()
	}

	logBytes, _ := os.ReadFile(logPath)
	logText := string(logBytes)
	issues := parse.LaTeXIssues(logText)

	pdfData, err := os.ReadFile(pdfHostPath)
	if err != nil || len(pdfData) < 100 {
		errMsg := "PDF not produced"
		if len(issues) > 0 {
			errMsg = issues[0].Message
		}
		_, _ = m.pool.Exec(ctx, `UPDATE compile_jobs SET status=$1, log_text=$2, error_text=$3, updated_at=now() WHERE id=$4`,
			"failed", logText, errMsg, jobID)
		return
	}

	pdfKey := storage.ArtifactPDFKey(projectID, jobID)
	if err := m.store.PutArtifact(ctx, pdfKey, bytes.NewReader(pdfData), int64(len(pdfData))); err != nil {
		m.fail(ctx, jobID, err.Error())
		return
	}
	_, _ = m.pool.Exec(ctx, `UPDATE compile_jobs SET status=$1, pdf_object_key=$2, log_text=$3, error_text=$4, updated_at=now() WHERE id=$5`,
		"success", pdfKey, logText, "", jobID)

	if cacheKey != "" && m.rdb != nil {
		b, _ := json.Marshal(map[string]string{"pdf": pdfKey, "log": logText})
		_ = m.rdb.Set(ctx, cacheKey, b, 24*time.Hour).Err()
	}
}

func (m *Manager) materializeProject(ctx context.Context, projectID uuid.UUID, dir string) (fingerprint string, err error) {
	rows, err := m.pool.Query(ctx, `SELECT path FROM project_files WHERE project_id=$1`, projectID)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var paths []string
	h := sha256.New()
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return "", err
		}
		paths = append(paths, p)
	}
	for _, p := range paths {
		obj, err := m.store.GetFile(ctx, projectID, p)
		if err != nil {
			return "", err
		}
		full := filepath.Join(dir, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			obj.Close()
			return "", err
		}
		f, err := os.Create(full)
		if err != nil {
			obj.Close()
			return "", err
		}
		_, copyErr := io.Copy(f, obj)
		_ = f.Close()
		_ = obj.Close()
		if copyErr != nil {
			return "", copyErr
		}
		h.Write([]byte(p))
		b, _ := os.ReadFile(full)
		h.Write(b)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func (m *Manager) fail(ctx context.Context, jobID uuid.UUID, msg string) {
	_, _ = m.pool.Exec(ctx, `UPDATE compile_jobs SET status=$1, error_text=$2, updated_at=now() WHERE id=$3`, "failed", msg, jobID)
}
