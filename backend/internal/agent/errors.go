package agent

import "errors"

// ErrLLMNotConfigured 表示未设置 OpenAI 兼容 API（服务端或请求内覆盖）。
var ErrLLMNotConfigured = errors.New("llm not configured")
