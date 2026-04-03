package agent

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

func writeSSEDone(w http.ResponseWriter, env *ToolEnv) {
	fl, _ := w.(http.Flusher)
	if env != nil && env.BeforeStreamDone != nil {
		env.BeforeStreamDone()
	}
	writeSSE(w, fl, map[string]string{"type": "done"})
}

// ImagePart is a base64 image attached to the latest user turn.
type ImagePart struct {
	Mime string `json:"mime"`
	Data string `json:"data"`
}

// RunAgentPipeline runs thinking stream, tool loop, token emission, memory + citation checks.
// o may be nil; per-request LLM fields override server configuration when non-empty.
func (s *Service) RunAgentPipeline(ctx context.Context, userID, projectID uuid.UUID, history []map[string]string, images []ImagePart, env *ToolEnv, w http.ResponseWriter, o *LLMOverrides) error {
	fl, _ := w.(http.Flusher)

	rt, ok := s.resolveLLM(o)
	if !ok {
		writeSSE(w, fl, map[string]string{"type": "note", "content": "LLM 未配置：请在服务器环境变量中设置 TEXPAD_LLM_BASE_URL / TEXPAD_LLM_API_KEY，或在编辑器「设置 → Agent」中填写。"})
		writeSSEDone(w, env)
		return nil
	}

	maxSteps := 10
	chatOnly := false
	if o != nil && o.MaxToolSteps != nil {
		switch {
		case *o.MaxToolSteps == 0:
			chatOnly = true
		case *o.MaxToolSteps < 0:
			maxSteps = 50
		default:
			maxSteps = *o.MaxToolSteps
			if maxSteps > 50 {
				maxSteps = 50
			}
			if maxSteps < 1 {
				maxSteps = 1
			}
		}
	}

	mem := s.loadMemoryBlock(ctx, userID, projectID)
	sys := strings.TrimSpace(loadPrompt("system.md") + "\n\n" + loadPrompt("tools_hint.md"))
	if mem != "" {
		sys += "\n\n## Memory 注入\n" + mem
	}

	lastUser := ""
	lastUserIdx := -1
	for i, h := range history {
		if h["role"] == "user" {
			lastUserIdx = i
			lastUser = h["content"]
		}
	}

	msgs := []map[string]any{{"role": "system", "content": sys}}
	for i, h := range history {
		role := h["role"]
		txt := h["content"]
		if role != "user" && role != "assistant" {
			continue
		}
		if role == "user" && i == lastUserIdx {
			msgs = append(msgs, map[string]any{"role": "user", "content": userMessageContent(txt, images)})
			continue
		}
		msgs = append(msgs, map[string]any{"role": role, "content": txt})
	}

	var fullAnswer strings.Builder

	if chatOnly {
		content, _, err := s.chatCompleteTools(ctx, rt, msgs, nil)
		if err != nil {
			writeSSE(w, fl, map[string]string{"type": "error", "content": UserFacingUpstreamError(err)})
			writeSSEDone(w, env)
			return nil
		}
		chunkEmitTokens(w, fl, content)
		fullAnswer.WriteString(content)
	} else {
		thinkMsgs := []map[string]any{
			{"role": "system", "content": "你是助手。请用简短中文输出对当前任务的推理要点（不超过约 500 字）。不要提及内部工具名。不要使用 Markdown 代码块。"},
			{"role": "user", "content": userMessageContent(lastUser, images)},
		}
		_, _ = s.chatStream(ctx, rt, thinkMsgs, w, fl, "thinking")

		tools := openAIToolDefs()
		for step := 0; step < maxSteps; step++ {
			content, calls, err := s.chatCompleteTools(ctx, rt, msgs, tools)
			if err != nil {
				writeSSE(w, fl, map[string]string{"type": "error", "content": UserFacingUpstreamError(err)})
				writeSSEDone(w, env)
				return nil
			}
			if len(calls) == 0 {
				if strings.TrimSpace(content) == "" {
					content2, _, err2 := s.chatCompleteTools(ctx, rt, msgs, nil)
					if err2 == nil {
						content = content2
					}
				}
				chunkEmitTokens(w, fl, content)
				fullAnswer.WriteString(content)
				break
			}

			toolObjs := make([]map[string]any, 0, len(calls))
			for _, c := range calls {
				toolObjs = append(toolObjs, map[string]any{
					"id":   c.ID,
					"type": "function",
					"function": map[string]any{
						"name":      c.Name,
						"arguments": normalizeJSONArgs(c.Arguments),
					},
				})
			}
			msgs = append(msgs, map[string]any{
				"role":       "assistant",
				"content":    "",
				"tool_calls": toolObjs,
			})

			for _, c := range calls {
				argsShow := truncate(c.Arguments, 4000)
				writeSSE(w, fl, map[string]string{"type": "tool_start", "name": c.Name, "args": argsShow})
				out, err := ExecuteTool(env, c.Name, c.Arguments)
				if err != nil {
					out = "error: " + err.Error()
				}
				resShow := truncate(out, 12000)
				writeSSE(w, fl, map[string]string{"type": "tool_end", "name": c.Name, "result": resShow})
				msgs = append(msgs, map[string]any{
					"role":         "tool",
					"tool_call_id": c.ID,
					"content":      out,
				})
			}
		}
	}

	ans := fullAnswer.String()
	if strings.TrimSpace(ans) != "" {
		warn := CitationSanityCheck(ctx, ans, env.ReadBib)
		if warn != "" {
			writeSSE(w, fl, map[string]string{"type": "check", "content": warn})
		}
	}

	summary := truncate(strings.TrimSpace(ans), 4000)
	if env.PlanBuf != nil && env.PlanBuf.Len() > 0 {
		summary += "\n\n[plan]\n" + truncate(env.PlanBuf.String(), 2000)
	}
	if env.SumBuf != nil && env.SumBuf.Len() > 0 {
		summary += "\n\n[sum]\n" + truncate(env.SumBuf.String(), 2000)
	}
	s.saveL1Session(ctx, userID, projectID, summary)
	pid := projectID
	_ = s.saveTierMemory(ctx, userID, &pid, 2, "session_digest", summary)
	if len(ans) > 200 {
		_ = s.saveTierMemory(ctx, userID, &pid, 4, "distill", compressForTier(ans, 900))
	}

	_ = s.saveMemory(ctx, userID, projectID, "session", truncate(ans, 8000))
	writeSSEDone(w, env)
	return nil
}

func userMessageContent(text string, images []ImagePart) any {
	if len(images) == 0 {
		return text
	}
	parts := []map[string]any{{"type": "text", "text": text}}
	for _, im := range images {
		mime := im.Mime
		if mime == "" {
			mime = "image/png"
		}
		parts = append(parts, map[string]any{
			"type": "image_url",
			"image_url": map[string]any{
				"url": fmt.Sprintf("data:%s;base64,%s", mime, im.Data),
			},
		})
	}
	return parts
}

func normalizeJSONArgs(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "{}"
	}
	return s
}
