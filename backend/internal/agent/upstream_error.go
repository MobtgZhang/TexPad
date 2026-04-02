package agent

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

var llmHTTPStatusRe = regexp.MustCompile(`(?:llm http|stream)\s+(\d{3})\b`)

// UserFacingUpstreamError maps LLM client errors to short Chinese messages for the UI.
func UserFacingUpstreamError(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	low := strings.ToLower(msg)

	if strings.Contains(msg, "llm not configured") {
		return msg
	}

	code := 0
	if m := llmHTTPStatusRe.FindStringSubmatch(msg); len(m) == 2 {
		code, _ = strconv.Atoi(m[1])
	}

	switch code {
	case http.StatusNotFound:
		return "无法使用 API（远端返回 404）。请检查「设置 → 智能体」中的 Base URL（避免重复 /v1）、模型名与端点路径。"
	case http.StatusUnauthorized, http.StatusForbidden, http.StatusProxyAuthRequired:
		return "无法使用 API（鉴权失败）。请检查 API 密钥是否有效。"
	case http.StatusTooManyRequests:
		return "无法使用 API（请求过于频繁）。请稍后再试或检查配额。"
	case http.StatusBadRequest, http.StatusUnprocessableEntity:
		return "无法使用 API（请求被拒绝）。请检查模型名、参数是否与上游兼容。"
	}
	if code >= 500 {
		return "无法使用 API（上游服务暂不可用）。请稍后再试。"
	}
	if code >= 400 {
		return "无法使用 API（上游返回错误）。请在「设置 → 智能体」中检查配置。"
	}

	switch {
	case strings.Contains(low, "timeout"), strings.Contains(low, "context deadline"):
		return "无法使用 API（请求超时）。请检查网络或稍后再试。"
	case strings.Contains(low, "connection refused"), strings.Contains(low, "no such host"),
		strings.Contains(low, "failed to resolve"), strings.Contains(low, "name or service not known"):
		return "无法使用 API（无法连接上游地址）。请检查 Base URL 与网络。"
	case strings.Contains(msg, "bad llm response"):
		return "无法使用 API（响应格式异常）。请尝试其他兼容 OpenAI Chat Completions 的端点或模型。"
	}

	return "无法使用 API。请在「设置 → 智能体」中检查 Base URL、密钥与模型。"
}
