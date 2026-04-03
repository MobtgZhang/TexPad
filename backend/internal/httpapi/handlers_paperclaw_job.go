package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mobtgzhang/TexPad/backend/internal/agent"
)

const paperclawUserPrompt = `你是论文协作助手。请在本 LaTeX 项目中：1) 用 workspace_list / file_read 了解主 .tex、.bib 与 workspace/；2) 用 task_plan 记录改进计划；3) 用 file_write 直接修改 .tex、.bib 或 workspace/ 下文件（本任务为异步模式，流水线结束时会自动将待确认修改写入对象存储）；4) 如需验证可调用 latex_compile_run 与 latex_compile_job。全程使用中文简述；以项目现有内容与结构为准进行润色与学术表达优化。`

// RunPaperclawJob 由 paperclaw.Manager 在后台调用，跑完整 Agent 流水线并更新 paperclaw_jobs。
func (s *Server) RunPaperclawJob(bg context.Context, jobID uuid.UUID) error {
	ctx := context.Background()

	var pid, uid uuid.UUID
	var status string
	err := s.pool.QueryRow(ctx, `SELECT project_id, user_id, status FROM paperclaw_jobs WHERE id=$1`, jobID).Scan(&pid, &uid, &status)
	if err != nil {
		return err
	}
	if status != "queued" {
		return nil
	}

	role, err := s.projectRole(ctx, uid, pid)
	if err != nil || role == "viewer" {
		_, _ = s.pool.Exec(ctx, `UPDATE paperclaw_jobs SET status=$1, message=$2, updated_at=now() WHERE id=$3`,
			"failed", "无权在此项目运行 Paperclaw", jobID)
		return nil
	}

	_, _ = s.pool.Exec(ctx, `UPDATE paperclaw_jobs SET status=$1, step=$2, progress=$3, message=$4, updated_at=now() WHERE id=$5`,
		"running", 1, 5, "准备智能体环境…", jobID)

	if err := s.EnsureAgentWorkspace(ctx, pid); err != nil {
		s.log.Warn("paperclaw ensure workspace", "job", jobID, "err", err)
	}

	runCtx, cancelRun := context.WithCancel(ctx)
	defer cancelRun()

	pollCtx, stopPoll := context.WithCancel(context.Background())
	defer stopPoll()
	go func() {
		t := time.NewTicker(900 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-pollCtx.Done():
				return
			case <-runCtx.Done():
				return
			case <-t.C:
				var cr bool
				qerr := s.pool.QueryRow(context.Background(), `SELECT cancel_requested FROM paperclaw_jobs WHERE id=$1`, jobID).Scan(&cr)
				if qerr == nil && cr {
					cancelRun()
					return
				}
			}
		}
	}()

	var mainTexRaw string
	_ = s.pool.QueryRow(ctx, `SELECT main_tex_path FROM projects WHERE id=$1`, pid).Scan(&mainTexRaw)
	mainTexSan, _ := sanitizeRelPath(mainTexRaw)

	var plan, sum strings.Builder
	pendingNew := map[string][]byte{}
	pendingOld := map[string][]byte{}
	const maxAgentProposalBytes = 512 * 1024

	readFromStore := func(c context.Context, p string) ([]byte, error) {
		obj, err := s.store.GetFile(c, pid, p)
		if err != nil {
			return nil, err
		}
		defer obj.Close()
		return io.ReadAll(obj)
	}

	stepN := 1
	env := &agent.ToolEnv{
		Ctx:       runCtx,
		ProjectID: pid.String(),
		PlanBuf:   &plan,
		SumBuf:    &sum,
		Progress: func(pct int, msg string) {
			stepN++
			p := pct
			if p < 0 {
				p = 0
			}
			if p > 100 {
				p = 100
			}
			_, _ = s.pool.Exec(context.Background(), `UPDATE paperclaw_jobs SET step=$1, progress=$2, message=$3, updated_at=now() WHERE id=$4`,
				stepN, p, truncateRunes(msg, 500), jobID)
		},
		BeforeStreamDone: func() {
			if len(pendingNew) == 0 {
				return
			}
			paths := make([]string, 0, len(pendingNew))
			for p := range pendingNew {
				paths = append(paths, p)
			}
			sort.Strings(paths)
			for _, p := range paths {
				newB := pendingNew[p]
				if err := s.putBytesFile(ctx, pid, p, newB); err != nil {
					s.log.Warn("paperclaw apply file", "path", p, "err", err)
				}
			}
		},
		ListWorkspace: func(c context.Context) (string, error) {
			prefix := AgentWorkspacePrefix + "/%"
			rows, err := s.pool.Query(c, `SELECT path, size_bytes FROM project_files WHERE project_id=$1 AND path LIKE $2 ORDER BY path`, pid, prefix)
			if err != nil {
				return "", err
			}
			defer rows.Close()
			var b strings.Builder
			for rows.Next() {
				var p string
				var sz int64
				if err := rows.Scan(&p, &sz); err != nil {
					return "", err
				}
				b.WriteString(p)
				b.WriteByte('\t')
				b.WriteString(fmt.Sprintf("%d", sz))
				b.WriteByte('\n')
			}
			if b.Len() == 0 {
				return fmt.Sprintf("(沙箱 %s/ 下尚无文件)", AgentWorkspacePrefix), nil
			}
			return strings.TrimSuffix(b.String(), "\n"), nil
		},
		ReadFile: func(c context.Context, rel string) ([]byte, error) {
			p, ok := sanitizeRelPath(rel)
			if !ok {
				return nil, fmt.Errorf("invalid path")
			}
			if err := agentSandboxReadPath(p, mainTexSan); err != nil {
				return nil, err
			}
			if b, ok := pendingNew[p]; ok {
				out := make([]byte, len(b))
				copy(out, b)
				return out, nil
			}
			return readFromStore(c, p)
		},
		WriteFile: func(c context.Context, rel string, data []byte) error {
			if role == "viewer" {
				return fmt.Errorf("read only")
			}
			p, ok := sanitizeRelPath(rel)
			if !ok {
				return fmt.Errorf("invalid path")
			}
			if err := agentSandboxWritePath(p); err != nil {
				return err
			}
			if len(data) > maxAgentProposalBytes {
				return s.putBytesFile(c, pid, p, data)
			}
			if _, exists := pendingNew[p]; !exists {
				oldB, err := readFromStore(c, p)
				if err != nil {
					oldB = nil
				}
				pendingOld[p] = append([]byte(nil), oldB...)
			}
			pendingNew[p] = append([]byte(nil), data...)
			return nil
		},
		ReadBib: func(c context.Context) ([]byte, error) {
			rows, err := s.pool.Query(c, `SELECT path FROM project_files WHERE project_id=$1 AND lower(path) LIKE '%.bib' ORDER BY path LIMIT 4`, pid)
			if err != nil {
				return nil, err
			}
			defer rows.Close()
			var merged strings.Builder
			for rows.Next() {
				var p string
				if rows.Scan(&p) != nil {
					continue
				}
				obj, err := s.store.GetFile(c, pid, p)
				if err != nil {
					continue
				}
				b, err := io.ReadAll(obj)
				_ = obj.Close()
				if err != nil {
					continue
				}
				merged.WriteString("\n% --- ")
				merged.WriteString(p)
				merged.WriteString("\n")
				merged.Write(b)
			}
			return []byte(merged.String()), nil
		},
		LatexCompileRun: func(argsJSON string) (string, error) {
			return s.agentCompileRunForTool(ctx, pid, uid, role, argsJSON)
		},
		LatexCompileJob: func(jid string) (string, error) {
			return s.agentCompileJobForTool(ctx, pid, jid)
		},
	}

	history := []map[string]string{{"role": "user", "content": paperclawUserPrompt}}
	maxSteps := 24
	ov := &agent.LLMOverrides{MaxToolSteps: &maxSteps}

	pipeErr := s.agent.RunAgentPipeline(runCtx, uid, pid, history, nil, env, agent.SilentHTTPResponseWriter(), ov)

	stopPoll()

	if errors.Is(pipeErr, context.Canceled) || errors.Is(runCtx.Err(), context.Canceled) {
		_, _ = s.pool.Exec(ctx, `UPDATE paperclaw_jobs SET status=$1, message=$2, progress=$3, updated_at=now() WHERE id=$4`,
			"cancelled", "任务已取消", 0, jobID)
		return nil
	}
	if errors.Is(pipeErr, agent.ErrLLMNotConfigured) {
		_, _ = s.pool.Exec(ctx, `UPDATE paperclaw_jobs SET status=$1, message=$2, updated_at=now() WHERE id=$3`,
			"failed", "LLM 未配置：请在服务器设置 TEXPAD_LLM_BASE_URL 与 TEXPAD_LLM_API_KEY（Paperclaw 仅使用服务端配置）。", jobID)
		return nil
	}
	if pipeErr != nil {
		_, _ = s.pool.Exec(ctx, `UPDATE paperclaw_jobs SET status=$1, message=$2, updated_at=now() WHERE id=$3`,
			"failed", truncateRunes("智能体错误："+pipeErr.Error(), 900), jobID)
		return pipeErr
	}

	_, _ = s.pool.Exec(ctx, `UPDATE paperclaw_jobs SET status=$1, step=$2, progress=$3, message=$4, updated_at=now() WHERE id=$5`,
		"success", stepN+1, 100, "Paperclaw 流水线已完成；修改已写入项目（若有 file_write）。", jobID)
	return nil
}

func truncateRunes(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}
