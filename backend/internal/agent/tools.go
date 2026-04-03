package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

const maxFetchBytes = 512 * 1024

// ToolEnv binds project file IO and optional scratch buffers for plan/summary.
type ToolEnv struct {
	Ctx           context.Context
	ProjectID     string
	ReadFile      func(ctx context.Context, rel string) ([]byte, error)
	WriteFile     func(ctx context.Context, rel string, data []byte) error
	ReadBib       func(ctx context.Context) ([]byte, error)
	ListWorkspace func(ctx context.Context) (string, error)
	PlanBuf       *strings.Builder
	SumBuf        *strings.Builder
	// BeforeStreamDone 在写出 type=done 之前调用（例如推送待审核的文件修改）。
	BeforeStreamDone func()
	// LaTeX 编译：入队一次编译（与编辑器「编译」一致）；返回人类可读摘要含 job_id。
	LatexCompileRun func(argsJSON string) (string, error)
	// LaTeX 编译任务查询：job_id 为空则取本项目最近一条；返回状态与截断日志。
	LatexCompileJob func(jobID string) (string, error)
	// Progress 可选：后台任务（如 Paperclaw）上报进度，pct 建议 0–100。
	Progress func(pct int, msg string)
}

func isBlockedHost(host string) bool {
	h := strings.ToLower(strings.TrimSpace(host))
	if h == "localhost" || h == "metadata.google.internal" {
		return true
	}
	if strings.HasSuffix(h, ".local") {
		return true
	}
	ips, err := net.LookupIP(host)
	if err != nil || len(ips) == 0 {
		return true
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
			return true
		}
	}
	return false
}

func sanitizeFetchURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, fmt.Errorf("invalid url")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("only http(s)")
	}
	if isBlockedHost(u.Hostname()) {
		return nil, fmt.Errorf("host not allowed")
	}
	return u, nil
}

var reHTMLTag = regexp.MustCompile(`(?s)<script.*?</script>|<style.*?</style>|<[^>]+>`)

func toolWebFetch(u string) (string, error) {
	parsed, err := sanitizeFetchURL(u)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "TexPadAgent/1.0")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return "", fmt.Errorf("http %d", resp.StatusCode)
	}
	slurp, err := io.ReadAll(io.LimitReader(resp.Body, maxFetchBytes))
	if err != nil {
		return "", err
	}
	ct := strings.ToLower(resp.Header.Get("Content-Type"))
	body := string(slurp)
	if strings.Contains(ct, "html") {
		body = reHTMLTag.ReplaceAllString(body, " ")
		body = strings.Join(strings.Fields(body), " ")
	}
	return compressForTier(body, 12000), nil
}

func toolWebDownload(u string) (string, error) {
	parsed, err := sanitizeFetchURL(u)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "TexPadAgent/1.0")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return "", fmt.Errorf("http %d", resp.StatusCode)
	}
	n, err := io.Copy(io.Discard, io.LimitReader(resp.Body, maxFetchBytes))
	if err != nil {
		return "", err
	}
	ct := resp.Header.Get("Content-Type")
	return fmt.Sprintf("downloaded %d bytes (truncated at cap), content-type=%s", n, ct), nil
}

var shellLineRe = regexp.MustCompile(`^[a-zA-Z0-9_/.+\-:\s]+$`)

func toolShellExec(cmdLine string) (string, error) {
	cmdLine = strings.TrimSpace(cmdLine)
	if cmdLine == "" || !shellLineRe.MatchString(cmdLine) {
		return "", fmt.Errorf("invalid command pattern")
	}
	parts := strings.Fields(cmdLine)
	if len(parts) == 0 {
		return "", fmt.Errorf("empty")
	}
	switch parts[0] {
	case "kpsewhich":
		if len(parts) != 2 {
			return "", fmt.Errorf("kpsewhich needs one arg")
		}
	case "latexmk":
		if len(parts) != 2 || parts[1] != "-version" {
			return "", fmt.Errorf("only latexmk -version allowed")
		}
	default:
		return "", fmt.Errorf("command %q not in allowlist", parts[0])
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, parts[0], parts[1:]...)
	cmd.Env = os.Environ()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out) + "\n" + err.Error(), nil
	}
	return string(out), nil
}

// ExecuteTool runs a tool by name; argsJSON is OpenAI function arguments object.
func ExecuteTool(env *ToolEnv, name, argsJSON string) (string, error) {
	var args map[string]any
	if strings.TrimSpace(argsJSON) != "" && argsJSON != "null" {
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			return "", fmt.Errorf("bad tool args: %w", err)
		}
	}
	if args == nil {
		args = map[string]any{}
	}
	switch name {
	case "web_fetch":
		u, _ := args["url"].(string)
		if u == "" {
			return "", fmt.Errorf("missing url")
		}
		return toolWebFetch(u)
	case "web_download":
		u, _ := args["url"].(string)
		if u == "" {
			return "", fmt.Errorf("missing url")
		}
		return toolWebDownload(u)
	case "shell_exec":
		cmd, _ := args["command"].(string)
		return toolShellExec(cmd)
	case "file_read":
		p, _ := args["path"].(string)
		if p == "" {
			return "", fmt.Errorf("missing path")
		}
		if env.ReadFile == nil {
			return "", fmt.Errorf("file_read unavailable")
		}
		b, err := env.ReadFile(env.Ctx, p)
		if err != nil {
			return "", err
		}
		return compressForTier(string(b), 24000), nil
	case "file_write":
		p, _ := args["path"].(string)
		c, _ := args["content"].(string)
		if p == "" {
			return "", fmt.Errorf("missing path")
		}
		if env.WriteFile == nil {
			return "", fmt.Errorf("file_write unavailable")
		}
		if err := env.WriteFile(env.Ctx, p, []byte(c)); err != nil {
			return "", err
		}
		return fmt.Sprintf("wrote %d bytes to %s", len(c), p), nil
	case "workspace_list":
		if env.ListWorkspace == nil {
			return "", fmt.Errorf("workspace_list unavailable")
		}
		return env.ListWorkspace(env.Ctx)
	case "latex_compile_run":
		if env.LatexCompileRun == nil {
			return "", fmt.Errorf("latex_compile_run unavailable")
		}
		return env.LatexCompileRun(argsJSON)
	case "latex_compile_job":
		id, _ := args["job_id"].(string)
		if env.LatexCompileJob == nil {
			return "", fmt.Errorf("latex_compile_job unavailable")
		}
		return env.LatexCompileJob(id)
	case "task_plan":
		step, _ := args["step"].(string)
		if env.PlanBuf != nil && step != "" {
			env.PlanBuf.WriteString("- ")
			env.PlanBuf.WriteString(step)
			env.PlanBuf.WriteString("\n")
		}
		return "plan recorded", nil
	case "task_summary":
		t, _ := args["text"].(string)
		if env.SumBuf != nil && t != "" {
			env.SumBuf.WriteString(t)
			env.SumBuf.WriteString("\n")
		}
		return "summary recorded", nil
	default:
		return "", fmt.Errorf("unknown tool %q", name)
	}
}
