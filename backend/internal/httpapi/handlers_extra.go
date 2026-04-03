package httpapi

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/mobtgzhang/TexPad/backend/internal/agent"
	"github.com/mobtgzhang/TexPad/backend/internal/parse"
	"github.com/mobtgzhang/TexPad/backend/internal/storage"
)

type createShareReq struct {
	Role           string `json:"role"`
	ExpiresInHours *int   `json:"expires_in_hours"`
}

func (s *Server) handleCreateShare(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) != "owner" {
		writeError(w, http.StatusForbidden, "owner only")
		return
	}
	pid := projectIDFrom(ctx)
	var req createShareReq
	_ = json.NewDecoder(r.Body).Decode(&req)
	role := strings.TrimSpace(req.Role)
	if role == "" {
		role = "viewer"
	}
	if role != "viewer" && role != "editor" {
		role = "viewer"
	}
	tok := uuid.NewString()
	var exp any
	if req.ExpiresInHours != nil && *req.ExpiresInHours > 0 && *req.ExpiresInHours <= 24*365 {
		t := time.Now().Add(time.Duration(*req.ExpiresInHours) * time.Hour)
		exp = t
	}
	if exp != nil {
		_, err := s.pool.Exec(ctx, `INSERT INTO project_shares (token, project_id, role, expires_at) VALUES ($1,$2,$3,$4)`, tok, pid, role, exp)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "db error")
			return
		}
	} else {
		_, err := s.pool.Exec(ctx, `INSERT INTO project_shares (token, project_id, role) VALUES ($1,$2,$3)`, tok, pid, role)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "db error")
			return
		}
	}
	writeJSON(w, http.StatusCreated, map[string]string{"token": tok, "role": role})
}

func (s *Server) handleListShares(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) != "owner" {
		writeError(w, http.StatusForbidden, "owner only")
		return
	}
	pid := projectIDFrom(ctx)
	rows, err := s.pool.Query(ctx, `SELECT token, role, created_at, expires_at FROM project_shares WHERE project_id=$1 ORDER BY created_at DESC`, pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var tok, role string
		var created time.Time
		var exp *time.Time
		if err := rows.Scan(&tok, &role, &created, &exp); err != nil {
			writeError(w, http.StatusInternalServerError, "scan")
			return
		}
		item := map[string]any{"token": tok, "role": role, "created_at": created}
		if exp != nil {
			item["expires_at"] = *exp
		}
		list = append(list, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"shares": list})
}

func (s *Server) handleRevokeShare(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) != "owner" {
		writeError(w, http.StatusForbidden, "owner only")
		return
	}
	pid := projectIDFrom(ctx)
	tok := strings.TrimSpace(chi.URLParam(r, "token"))
	if tok == "" {
		writeError(w, http.StatusBadRequest, "missing token")
		return
	}
	var deleted string
	err := s.pool.QueryRow(ctx, `DELETE FROM project_shares WHERE project_id=$1 AND token=$2 RETURNING token`, pid, tok).Scan(&deleted)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type snapshotReq struct {
	Label string `json:"label"`
}

func (s *Server) handleCreateSnapshot(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	pid := projectIDFrom(ctx)
	var req snapshotReq
	_ = json.NewDecoder(r.Body).Decode(&req)
	rows, err := s.pool.Query(ctx, `SELECT path, size_bytes FROM project_files WHERE project_id=$1`, pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	type ent struct {
		Path string `json:"path"`
		Size int64  `json:"size"`
	}
	var manifest []ent
	for rows.Next() {
		var e ent
		if err := rows.Scan(&e.Path, &e.Size); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "scan")
			return
		}
		manifest = append(manifest, e)
	}
	rows.Close()
	mb, _ := json.Marshal(manifest)
	var sid uuid.UUID
	err = s.pool.QueryRow(ctx, `INSERT INTO project_snapshots (project_id, label, manifest) VALUES ($1,$2,$3) RETURNING id`,
		pid, strings.TrimSpace(req.Label), mb).Scan(&sid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "insert")
		return
	}
	for _, e := range manifest {
		src := storage.ProjectFileKey(pid, e.Path)
		dst := storage.SnapshotObjectKey(pid, sid, e.Path)
		if err := s.store.CopyObject(ctx, src, dst); err != nil {
			s.log.Warn("snapshot copy", "path", e.Path, "err", err)
		}
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": sid.String()})
}

func (s *Server) handleListSnapshots(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	rows, err := s.pool.Query(ctx, `SELECT id, label, created_at FROM project_snapshots WHERE project_id=$1 ORDER BY created_at DESC`, pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var label *string
		var ts any
		if err := rows.Scan(&id, &label, &ts); err != nil {
			writeError(w, http.StatusInternalServerError, "scan")
			return
		}
		l := ""
		if label != nil {
			l = *label
		}
		list = append(list, map[string]any{"id": id.String(), "label": l, "created_at": ts})
	}
	writeJSON(w, http.StatusOK, map[string]any{"snapshots": list})
}

func (s *Server) handleDeleteSnapshot(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	pid := projectIDFrom(ctx)
	sid, err := uuid.Parse(chi.URLParam(r, "snapshotID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad id")
		return
	}
	tag, err := s.pool.Exec(ctx, `DELETE FROM project_snapshots WHERE id=$1 AND project_id=$2`, sid, pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if err := s.store.RemoveSnapshotTree(ctx, pid, sid); err != nil {
		s.log.Warn("snapshot storage cleanup", "err", err)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRestoreSnapshot(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	pid := projectIDFrom(ctx)
	sid, err := uuid.Parse(chi.URLParam(r, "snapshotID"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad id")
		return
	}
	var raw []byte
	err = s.pool.QueryRow(ctx, `SELECT manifest FROM project_snapshots WHERE id=$1 AND project_id=$2`, sid, pid).Scan(&raw)
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	var manifest []struct {
		Path string `json:"path"`
	}
	if json.Unmarshal(raw, &manifest) != nil {
		writeError(w, http.StatusInternalServerError, "bad manifest")
		return
	}
	for _, m := range manifest {
		src := storage.SnapshotObjectKey(pid, sid, m.Path)
		dst := storage.ProjectFileKey(pid, m.Path)
		if err := s.store.CopyObject(ctx, src, dst); err != nil {
			s.log.Warn("restore copy", "path", m.Path, "err", err)
			continue
		}
		obj, err := s.store.GetFile(ctx, pid, m.Path)
		if err != nil {
			continue
		}
		st, err := obj.Stat()
		_ = obj.Close()
		sz := int64(0)
		ct := "application/octet-stream"
		if err == nil {
			sz = st.Size
			if st.ContentType != "" {
				ct = st.ContentType
			}
		}
		_, _ = s.pool.Exec(ctx, `
INSERT INTO project_files (project_id, path, content_type, size_bytes, updated_at)
VALUES ($1,$2,$3,$4, now())
ON CONFLICT (project_id, path) DO UPDATE SET content_type=EXCLUDED.content_type, size_bytes=EXCLUDED.size_bytes, updated_at=now()`,
			pid, m.Path, ct, sz)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "restored"})
}

func (s *Server) putBytesFile(ctx context.Context, projectID uuid.UUID, path string, data []byte) error {
	ct := "application/octet-stream"
	if strings.HasSuffix(strings.ToLower(path), ".tex") {
		ct = "text/plain"
	}
	if err := s.store.PutFile(ctx, projectID, path, bytes.NewReader(data), int64(len(data)), ct); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `
INSERT INTO project_files (project_id, path, content_type, size_bytes, updated_at)
VALUES ($1,$2,$3,$4, now())
ON CONFLICT (project_id, path) DO UPDATE SET content_type=EXCLUDED.content_type, size_bytes=EXCLUDED.size_bytes, updated_at=now()`,
		projectID, path, ct, len(data))
	return err
}

func (s *Server) handleExportZip(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pid := projectIDFrom(ctx)
	rows, err := s.pool.Query(ctx, `SELECT path FROM project_files WHERE project_id=$1`, pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	var paths []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			writeError(w, http.StatusInternalServerError, "scan")
			return
		}
		paths = append(paths, p)
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="project.zip"`)
	zw := zip.NewWriter(w)
	defer zw.Close()
	for _, p := range paths {
		obj, err := s.store.GetFile(ctx, pid, p)
		if err != nil {
			continue
		}
		data, _ := io.ReadAll(obj)
		_ = obj.Close()
		f, err := zw.Create(p)
		if err != nil {
			continue
		}
		_, _ = f.Write(data)
	}
}

func (s *Server) handleImportZip(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	pid := projectIDFrom(ctx)
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "multipart")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, "read")
		return
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		writeError(w, http.StatusBadRequest, "not zip")
		return
	}
	n := 0
	for _, zf := range zr.File {
		if zf.FileInfo().IsDir() {
			continue
		}
		rel, ok := sanitizeRelPath(zf.Name)
		if !ok || !allowedFile(rel) {
			continue
		}
		rc, err := zf.Open()
		if err != nil {
			continue
		}
		b, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			continue
		}
		if err := s.putBytesFile(ctx, pid, rel, b); err != nil {
			continue
		}
		n++
	}
	writeJSON(w, http.StatusOK, map[string]int{"imported": n})
}

type agentStreamReq struct {
	Messages     []map[string]string `json:"messages"`
	Images       []agent.ImagePart   `json:"images"`
	LLMBaseURL   string              `json:"llm_base_url"`
	LLMAPIKey    string              `json:"llm_api_key"`
	Model        string              `json:"model"`
	Temperature  *float64            `json:"temperature"`
	TopP         *float64            `json:"top_p"`
	TopK         *float64            `json:"top_k"`
	MaxToolSteps *int                `json:"max_tool_steps"`
}

func (s *Server) handleAgentStream(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid, _ := UserID(ctx)
	pid := projectIDFrom(ctx)
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	var req agentStreamReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	fl, ok := w.(http.Flusher)
	if ok {
		fl.Flush()
	}

	if err := s.EnsureAgentWorkspace(ctx, pid); err != nil {
		s.log.Warn("ensure agent workspace", "project", pid, "err", err)
	}
	var mainTexRaw string
	_ = s.pool.QueryRow(ctx, `SELECT main_tex_path FROM projects WHERE id=$1`, pid).Scan(&mainTexRaw)
	mainTexSan, _ := sanitizeRelPath(mainTexRaw)
	projRole := projectRoleFrom(ctx)

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

	env := &agent.ToolEnv{
		Ctx:       ctx,
		ProjectID: pid.String(),
		PlanBuf:   &plan,
		SumBuf:    &sum,
		BeforeStreamDone: func() {
			if len(pendingNew) == 0 {
				return
			}
			type fileEnc struct {
				Path      string `json:"path"`
				BeforeB64 string `json:"before_b64"`
				AfterB64  string `json:"after_b64"`
			}
			paths := make([]string, 0, len(pendingNew))
			for p := range pendingNew {
				paths = append(paths, p)
			}
			sort.Strings(paths)
			list := make([]fileEnc, 0, len(paths))
			for _, p := range paths {
				newB := pendingNew[p]
				oldB := pendingOld[p]
				list = append(list, fileEnc{
					Path:      p,
					BeforeB64: base64.StdEncoding.EncodeToString(oldB),
					AfterB64:  base64.StdEncoding.EncodeToString(newB),
				})
			}
			agent.WriteSSEJSON(w, fl, map[string]any{"type": "proposals", "files": list})
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
				return fmt.Sprintf("(沙箱 %s/ 下尚无文件；请在文件树中向该目录上传 PDF 等附件)", AgentWorkspacePrefix), nil
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
			if projectRoleFrom(c) == "viewer" {
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
			return s.agentCompileRunForTool(ctx, pid, uid, projRole, argsJSON)
		},
		LatexCompileJob: func(jobID string) (string, error) {
			return s.agentCompileJobForTool(ctx, pid, jobID)
		},
	}
	ov := &agent.LLMOverrides{
		BaseURL:      req.LLMBaseURL,
		APIKey:       req.LLMAPIKey,
		Model:        req.Model,
		Temperature:  req.Temperature,
		TopP:         req.TopP,
		TopK:         req.TopK,
		MaxToolSteps: req.MaxToolSteps,
	}
	_ = s.agent.RunAgentPipeline(ctx, uid, pid, req.Messages, req.Images, env, w, ov)
}

type agentModelsReq struct {
	LLMBaseURL string `json:"llm_base_url"`
	LLMAPIKey  string `json:"llm_api_key"`
}

// openAICompatibleModelsURL 避免 base 已含 /v1 时再拼成 /v1/v1/models（会 404）。
func openAICompatibleModelsURL(base string) string {
	b := strings.TrimRight(strings.TrimSpace(base), "/")
	if b == "" {
		return ""
	}
	if strings.HasSuffix(b, "/v1") {
		return b + "/models"
	}
	return b + "/v1/models"
}

// ollamaTagsURL 将服务根与 Ollama 的 GET /api/tags 对齐（去掉末尾的 /v1）。
func ollamaTagsURL(base string) string {
	b := strings.TrimRight(strings.TrimSpace(base), "/")
	if b == "" {
		return ""
	}
	b = strings.TrimSuffix(b, "/v1")
	return b + "/api/tags"
}

func parseOpenAIModelsJSON(raw []byte) []string {
	var parsed struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &parsed) != nil || len(parsed.Data) == 0 {
		return nil
	}
	out := make([]string, 0, len(parsed.Data))
	for _, d := range parsed.Data {
		if t := strings.TrimSpace(d.ID); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func parseOllamaTagsJSON(raw []byte) []string {
	var parsed struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if json.Unmarshal(raw, &parsed) != nil {
		return nil
	}
	out := make([]string, 0, len(parsed.Models))
	for _, m := range parsed.Models {
		if t := strings.TrimSpace(m.Name); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func (s *Server) handleAgentListModels(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if projectRoleFrom(ctx) == "viewer" {
		writeError(w, http.StatusForbidden, "read only")
		return
	}
	var req agentModelsReq
	_ = readJSON(r, &req)
	base := strings.TrimRight(strings.TrimSpace(req.LLMBaseURL), "/")
	key := strings.TrimSpace(req.LLMAPIKey)
	if base == "" {
		base = strings.TrimRight(strings.TrimSpace(s.cfg.LLMBaseURL), "/")
	}
	if key == "" {
		key = strings.TrimSpace(s.cfg.LLMAPIKey)
	}
	if base == "" {
		writeJSON(w, http.StatusOK, map[string]any{"models": []string{}})
		return
	}

	client := &http.Client{Timeout: 25 * time.Second}
	openURL := openAICompatibleModelsURL(base)
	ollamaURL := ollamaTagsURL(base)

	tryOllama := false
	openHint := ""

	if key != "" && openURL != "" {
		hreq, err := http.NewRequestWithContext(ctx, http.MethodGet, openURL, nil)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad request")
			return
		}
		hreq.Header.Set("Authorization", "Bearer "+key)
		resp, err := client.Do(hreq)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"models": []string{}, "error": err.Error()})
			return
		}
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
		resp.Body.Close()
		switch resp.StatusCode {
		case http.StatusOK:
			if models := parseOpenAIModelsJSON(raw); len(models) > 0 {
				writeJSON(w, http.StatusOK, map[string]any{"models": models})
				return
			}
			tryOllama = true
			openHint = fmt.Sprintf("%s 返回空列表", openURL)
		case http.StatusNotFound:
			tryOllama = true
			openHint = fmt.Sprintf("%s 返回 404（可检查 Base URL 是否多写了 /v1）", openURL)
		default:
			writeJSON(w, http.StatusOK, map[string]any{
				"models": []string{},
				"error":  fmt.Sprintf("%s 返回 HTTP %d", openURL, resp.StatusCode),
			})
			return
		}
	} else {
		// 未配置 API Key 时仍尝试 Ollama（本地常见无需密钥）
		tryOllama = true
	}

	if tryOllama && ollamaURL != "" {
		hreq2, err := http.NewRequestWithContext(ctx, http.MethodGet, ollamaURL, nil)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad request")
			return
		}
		if key != "" {
			hreq2.Header.Set("Authorization", "Bearer "+key)
		}
		resp2, err := client.Do(hreq2)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"models": []string{}, "error": err.Error()})
			return
		}
		raw2, _ := io.ReadAll(io.LimitReader(resp2.Body, 2<<20))
		resp2.Body.Close()
		if resp2.StatusCode == http.StatusOK {
			if models := parseOllamaTagsJSON(raw2); len(models) > 0 {
				writeJSON(w, http.StatusOK, map[string]any{"models": models})
				return
			}
		}
		msg := fmt.Sprintf("%s 返回 HTTP %d", ollamaURL, resp2.StatusCode)
		if openHint != "" {
			msg = openHint + "；" + msg
		}
		writeJSON(w, http.StatusOK, map[string]any{"models": []string{}, "error": msg})
		return
	}

	if openHint != "" {
		writeJSON(w, http.StatusOK, map[string]any{"models": []string{}, "error": openHint})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": []string{}})
}

func (s *Server) handleAgentSuggest(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("log")
	issues := parse.LaTeXIssues(q)
	msg := agent.SuggestFix(q)
	writeJSON(w, http.StatusOK, map[string]any{"suggestion": msg, "issues": issues})
}

func (s *Server) handleAgentPapers(w http.ResponseWriter, r *http.Request) {
	topic := r.URL.Query().Get("topic")
	writeJSON(w, http.StatusOK, map[string]any{"items": agent.PaperRecommendations(topic)})
}

func (s *Server) handleAgentMemories(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid, _ := UserID(ctx)
	var pid uuid.UUID
	if s := r.URL.Query().Get("project_id"); s != "" {
		var err error
		pid, err = uuid.Parse(s)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad project id")
			return
		}
	}
	list, err := s.agent.ListMemories(ctx, uid, pid, 30)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"memories": list})
}

type feedbackReq struct {
	ProjectID string `json:"project_id"`
	Helpful   bool   `json:"helpful"`
	Note      string `json:"note"`
}

func (s *Server) handleAgentFeedback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid, _ := UserID(ctx)
	var req feedbackReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	var pid uuid.UUID
	if req.ProjectID != "" {
		var err error
		pid, err = uuid.Parse(req.ProjectID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad project id")
			return
		}
	}
	if err := s.agent.RecordFeedback(ctx, uid, pid, req.Helpful, req.Note); err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
