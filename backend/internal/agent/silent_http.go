package agent

import "net/http"

// silentHTTPResponse 丢弃 SSE 正文，仍实现 Flusher，供后台任务复用 RunAgentPipeline。
type silentHTTPResponse struct{}

func (silentHTTPResponse) Header() http.Header         { return http.Header{} }
func (silentHTTPResponse) Write(p []byte) (int, error) { return len(p), nil }
func (silentHTTPResponse) WriteHeader(int)               {}
func (silentHTTPResponse) Flush()                      {}

var _ http.Flusher = silentHTTPResponse{}

// SilentHTTPResponseWriter 用于 Paperclaw 等非 HTTP 场景调用 RunAgentPipeline。
func SilentHTTPResponseWriter() http.ResponseWriter {
	return silentHTTPResponse{}
}
