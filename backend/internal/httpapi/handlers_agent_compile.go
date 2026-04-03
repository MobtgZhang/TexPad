package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/mobtgzhang/TexPad/backend/internal/agent"
)

// agentCompileRunForTool 将一次编译任务入队（逻辑对齐 handleCompile）。
func (s *Server) agentCompileRunForTool(ctx context.Context, pid uuid.UUID, uid uuid.UUID, role string, argsJSON string) (string, error) {
	if role == "viewer" {
		return "", fmt.Errorf("只读成员无法触发编译")
	}
	if s.cfg.CompileDailyLimit > 0 && s.rl != nil {
		allowed, err := s.rl.Allow(ctx, fmt.Sprintf("compile:user:%s", uid.String()), int64(s.cfg.CompileDailyLimit), 24*time.Hour)
		if err == nil && !allowed {
			return "", fmt.Errorf("已超过每日编译次数上限")
		}
	}

	var req struct {
		Engine        string  `json:"engine"`
		DraftMode     *bool   `json:"draft_mode"`
		HaltOnError   *bool   `json:"halt_on_error"`
		CleanBuild    *bool   `json:"clean_build"`
		SyntaxCheck   *bool   `json:"syntax_check"`
		TexliveYear   *string `json:"texlive_year"`
	}
	if strings.TrimSpace(argsJSON) != "" && argsJSON != "null" {
		_ = json.Unmarshal([]byte(argsJSON), &req)
	}

	engine := req.Engine
	switch engine {
	case "xelatex", "lualatex", "pdflatex", "context":
	default:
		engine = "pdflatex"
	}
	draft := false
	halt := true
	clean := false
	syntax := true
	if req.DraftMode != nil {
		draft = *req.DraftMode
	}
	if req.HaltOnError != nil {
		halt = *req.HaltOnError
	}
	if req.CleanBuild != nil {
		clean = *req.CleanBuild
	}
	if req.SyntaxCheck != nil {
		syntax = *req.SyntaxCheck
	}
	texYear := "2025"
	if req.TexliveYear != nil {
		y := strings.TrimSpace(*req.TexliveYear)
		if y == "2024" || y == "2025" {
			texYear = y
		}
	}

	var jid uuid.UUID
	err := s.pool.QueryRow(ctx, `INSERT INTO compile_jobs (project_id, status, engine, draft_mode, halt_on_error, clean_build, syntax_check, texlive_year) VALUES ($1,'queued',$2,$3,$4,$5,$6,$7) RETURNING id`,
		pid, engine, draft, halt, clean, syntax, texYear).Scan(&jid)
	if err != nil {
		return "", fmt.Errorf("编译入队失败: %w", err)
	}
	s.comp.Enqueue(jid)
	return fmt.Sprintf("已加入编译队列 job_id=%s status=queued engine=%s texlive_year=%s", jid.String(), engine, texYear), nil
}

// agentCompileJobForTool 返回指定或最近一条编译任务摘要（含截断日志）。
func (s *Server) agentCompileJobForTool(ctx context.Context, pid uuid.UUID, jobID string) (string, error) {
	jidStr := strings.TrimSpace(jobID)
	var jid uuid.UUID
	var err error
	if jidStr == "" {
		err = s.pool.QueryRow(ctx, `SELECT id FROM compile_jobs WHERE project_id=$1 ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1`, pid).Scan(&jid)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return "该项目尚无编译任务记录。", nil
			}
			return "", err
		}
	} else {
		jid, err = uuid.Parse(jidStr)
		if err != nil {
			return "", fmt.Errorf("无效的 job_id")
		}
	}

	var st, eng string
	var logt, errt, pdfKey, synKey sql.NullString
	var createdAt, updatedAt time.Time
	err = s.pool.QueryRow(ctx, `SELECT status, engine, log_text, error_text, pdf_object_key, synctex_object_key, created_at, updated_at FROM compile_jobs WHERE id=$1 AND project_id=$2`,
		jid, pid).Scan(&st, &eng, &logt, &errt, &pdfKey, &synKey, &createdAt, &updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("未找到该编译任务或无权访问")
		}
		return "", err
	}

	logStr := sqlNullString(logt)
	errStr := sqlNullString(errt)
	hasPDF := sqlNullString(pdfKey) != ""
	hasSyn := sqlNullString(synKey) != ""

	const logCap = 28000
	logExcerpt := agent.CompressToolOutput(logStr, logCap)
	errExcerpt := agent.CompressToolOutput(errStr, 4000)

	var b strings.Builder
	fmt.Fprintf(&b, "job_id=%s\nstatus=%s\nengine=%s\npdf_ready=%v\nsynctex_ready=%v\ncreated_at=%s\nupdated_at=%s\n",
		jid.String(), st, eng, hasPDF, hasSyn, createdAt.Format(time.RFC3339), updatedAt.Format(time.RFC3339))
	if errExcerpt != "" {
		b.WriteString("\n--- error_text ---\n")
		b.WriteString(errExcerpt)
		b.WriteByte('\n')
	}
	if logExcerpt != "" {
		b.WriteString("\n--- log excerpt ---\n")
		b.WriteString(logExcerpt)
		b.WriteByte('\n')
	}
	return b.String(), nil
}
