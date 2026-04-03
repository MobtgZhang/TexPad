package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// openAICompatibleChatCompletionsURL 与模型列表接口一致：base 可为根 URL 或已含 /v1 的 URL，避免拼成 /v1/v1/...。
func openAICompatibleChatCompletionsURL(base string) string {
	b := strings.TrimRight(strings.TrimSpace(base), "/")
	if b == "" {
		return ""
	}
	if strings.HasSuffix(b, "/v1") {
		return b + "/chat/completions"
	}
	return b + "/v1/chat/completions"
}

func (s *Service) postChatJSON(ctx context.Context, rt llmRuntime, body map[string]any) (json.RawMessage, error) {
	if rt.apiKey == "" || rt.baseURL == "" {
		return nil, fmt.Errorf("llm not configured")
	}
	if body["model"] == nil || body["model"] == "" {
		body["model"] = rt.model
	}
	url := openAICompatibleChatCompletionsURL(rt.baseURL)
	if url == "" {
		return nil, fmt.Errorf("llm not configured")
	}
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+rt.apiKey)
	resp, err := s.hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("llm http %d: %s", resp.StatusCode, truncate(string(raw), 800))
	}
	return raw, nil
}

type ToolCallOut struct {
	ID        string
	Name      string
	Arguments string
}

func (s *Service) chatCompleteTools(ctx context.Context, rt llmRuntime, messages []map[string]any, tools []map[string]any) (string, []ToolCallOut, error) {
	body := map[string]any{
		"model":       rt.model,
		"messages":    messages,
		"temperature": rt.tempChat,
	}
	applySampling(rt, body)
	if len(tools) > 0 {
		body["tools"] = tools
		body["tool_choice"] = "auto"
	}
	raw, err := s.postChatJSON(ctx, rt, body)
	if err != nil {
		return "", nil, err
	}
	var resp struct {
		Choices []struct {
			Message struct {
				Content   *string `json:"content"`
				ToolCalls []struct {
					ID       string `json:"id"`
					Type     string `json:"type"`
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(raw, &resp) != nil || len(resp.Choices) == 0 {
		return "", nil, fmt.Errorf("bad llm response")
	}
	msg := resp.Choices[0].Message
	content := ""
	if msg.Content != nil {
		content = *msg.Content
	}
	var calls []ToolCallOut
	for _, tc := range msg.ToolCalls {
		if tc.Type != "function" {
			continue
		}
		calls = append(calls, ToolCallOut{ID: tc.ID, Name: tc.Function.Name, Arguments: tc.Function.Arguments})
	}
	return content, calls, nil
}

func (s *Service) chatStream(ctx context.Context, rt llmRuntime, messages []map[string]any, w io.Writer, flusher http.Flusher, sseType string) (string, error) {
	if rt.apiKey == "" || rt.baseURL == "" {
		return "", fmt.Errorf("llm not configured")
	}
	url := openAICompatibleChatCompletionsURL(rt.baseURL)
	if url == "" {
		return "", fmt.Errorf("llm not configured")
	}
	body := map[string]any{
		"model":       rt.model,
		"messages":    messages,
		"stream":      true,
		"temperature": rt.tempThink,
	}
	applySampling(rt, body)
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+rt.apiKey)
	resp, err := s.hc.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		slurp, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("stream %d: %s", resp.StatusCode, string(slurp))
	}
	var acc strings.Builder
	buf := make([]byte, 0, 64*1024)
	chunk := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(chunk)
		if n > 0 {
			buf = append(buf, chunk[:n]...)
			for {
				line, rest, ok := bytes.Cut(buf, []byte("\n"))
				if !ok {
					break
				}
				buf = rest
				c := parseStreamDelta(line)
				if c != "" {
					acc.WriteString(c)
					writeSSE(w, flusher, map[string]string{"type": sseType, "content": c})
				}
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return acc.String(), err
		}
	}
	return acc.String(), nil
}

func parseStreamDelta(line []byte) string {
	line = bytes.TrimSpace(line)
	if !bytes.HasPrefix(line, []byte("data:")) {
		return ""
	}
	payload := bytes.TrimSpace(bytes.TrimPrefix(line, []byte("data:")))
	if string(payload) == "[DONE]" {
		return ""
	}
	var chunk struct {
		Choices []struct {
			Delta struct {
				Content string `json:"content"`
			} `json:"delta"`
		} `json:"choices"`
	}
	if json.Unmarshal(payload, &chunk) != nil || len(chunk.Choices) == 0 {
		return ""
	}
	return chunk.Choices[0].Delta.Content
}

func writeSSE(w io.Writer, flusher http.Flusher, m map[string]string) {
	b, _ := json.Marshal(m)
	_, _ = io.WriteString(w, "data: "+string(b)+"\n\n")
	if flusher != nil {
		flusher.Flush()
	}
}

// WriteSSEJSON 发送任意 JSON 对象事件（如 proposals），供前端解析。
func WriteSSEJSON(w io.Writer, flusher http.Flusher, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	_, _ = io.WriteString(w, "data: "+string(b)+"\n\n")
	if flusher != nil {
		flusher.Flush()
	}
}

func chunkEmitTokens(w io.Writer, flusher http.Flusher, text string) {
	const step = 28
	r := []rune(text)
	for i := 0; i < len(r); i += step {
		j := i + step
		if j > len(r) {
			j = len(r)
		}
		writeSSE(w, flusher, map[string]string{"type": "token", "content": string(r[i:j])})
	}
}
