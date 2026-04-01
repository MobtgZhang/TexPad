package agent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mobtgzhang/TexPad/backend/internal/config"
)

type Service struct {
	cfg  config.Config
	pool *pgxpool.Pool
	hc   *http.Client
}

func New(cfg config.Config, pool *pgxpool.Pool) *Service {
	return &Service{
		cfg:  cfg,
		pool: pool,
		hc:   &http.Client{Timeout: 0},
	}
}

func (s *Service) StreamChat(ctx context.Context, userID, projectID uuid.UUID, messages []map[string]string, w io.Writer) error {
	flusher, _ := w.(http.Flusher)
	write := func(line string) {
		_, _ = io.WriteString(w, line+"\n")
		if flusher != nil {
			flusher.Flush()
		}
	}

	if s.cfg.LLMAPIKey == "" || s.cfg.LLMBaseURL == "" {
		write("data: " + `{"type":"note","content":"LLM not configured; set TEXPAD_LLM_BASE_URL and TEXPAD_LLM_API_KEY"}` + "\n\n")
		write("data: " + `{"type":"done"}` + "\n\n")
		_ = s.saveMemory(ctx, userID, projectID, "offline-note", "Agent ran without LLM keys.")
		return nil
	}

	base := strings.TrimRight(s.cfg.LLMBaseURL, "/")
	url := base + "/v1/chat/completions"
	body := map[string]any{
		"model":    s.cfg.LLMModel,
		"stream":   true,
		"messages": messages,
	}
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.cfg.LLMAPIKey)

	resp, err := s.hc.Do(req)
	if err != nil {
		write("data: " + mustJSON(map[string]string{"type": "error", "content": err.Error()}) + "\n\n")
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		slurp, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		write("data: " + mustJSON(map[string]string{"type": "error", "content": string(slurp)}) + "\n\n")
		return nil
	}

	sc := bufio.NewScanner(resp.Body)
	buf := make([]byte, 0, 64*1024)
	sc.Buffer(buf, 1024*1024)
	var full strings.Builder
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")
		if payload == "[DONE]" {
			break
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if json.Unmarshal([]byte(payload), &chunk) != nil {
			continue
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		c := chunk.Choices[0].Delta.Content
		if c == "" {
			continue
		}
		full.WriteString(c)
		write("data: " + mustJSON(map[string]string{"type": "token", "content": c}) + "\n\n")
	}
	write("data: " + mustJSON(map[string]string{"type": "done"}) + "\n\n")
	_ = s.saveMemory(ctx, userID, projectID, "session", truncate(full.String(), 8000))
	return sc.Err()
}

func (s *Service) saveMemory(ctx context.Context, userID, projectID uuid.UUID, kind, content string) error {
	meta := map[string]string{"kind": kind}
	mb, _ := json.Marshal(meta)
	_, err := s.pool.Exec(ctx, `INSERT INTO agent_memories (user_id, project_id, content, meta) VALUES ($1,$2,$3,$4)`,
		userID, projectID, content, mb)
	return err
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// SuggestFix returns a short suggestion from log issues (no LLM).
func SuggestFix(logExcerpt string) string {
	if strings.Contains(logExcerpt, "Undefined control sequence") {
		return "检查是否缺少宏包或命令拼写错误；尝试添加相应 \\usepackage。"
	}
	if strings.Contains(logExcerpt, "File ended while scanning") {
		return "检查未闭合的大括号 \\{ \\} 或环境 \\begin/\\end 是否配对。"
	}
	if strings.Contains(logExcerpt, "Missing $ inserted") {
		return "数学模式符号 $ 可能未配对，或应在数学环境中编写公式。"
	}
	return "请根据日志首条错误定位对应行并逐条修复。"
}

func (s *Service) RecordFeedback(ctx context.Context, userID, projectID uuid.UUID, helpful bool, note string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO agent_feedback (user_id, project_id, helpful, note) VALUES ($1,$2,$3,$4)`,
		userID, projectID, helpful, note)
	return err
}

func (s *Service) ListMemories(ctx context.Context, userID, projectID uuid.UUID, limit int) ([]string, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	var rows pgx.Rows
	var err error
	if projectID == uuid.Nil {
		rows, err = s.pool.Query(ctx, `SELECT content FROM agent_memories WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, userID, limit)
	} else {
		rows, err = s.pool.Query(ctx, `SELECT content FROM agent_memories WHERE user_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT $3`, userID, projectID, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

// PaperRecommendations is a stub semantic hook (no external API key required).
func PaperRecommendations(topic string) []map[string]string {
	t := strings.TrimSpace(topic)
	if t == "" {
		return nil
	}
	return []map[string]string{
		{"title": "Related work (stub)", "reason": "基于关键词 \"" + truncate(t, 80) + "\" 的占位推荐；可接入 arXiv/Semantic Scholar API。"},
	}
}
