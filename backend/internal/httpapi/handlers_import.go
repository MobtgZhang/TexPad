package httpapi

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	maxImportZipBytes       = 64 << 20
	maxUncompressedPerEntry = 25 << 20
	maxImportZipEntries     = 800
	githubImportTimeout     = 120 * time.Second
)

type importGitHubReq struct {
	Name  string `json:"name"`
	Owner string `json:"owner"`
	Repo  string `json:"repo"`
	Ref   string `json:"ref"`
}

func contentTypeForImport(rel string) string {
	switch strings.ToLower(path.Ext(rel)) {
	case ".tex", ".bib", ".cls", ".sty", ".bst", ".clo", ".cfg", ".def":
		return "text/plain; charset=utf-8"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".pdf":
		return "application/pdf"
	case ".svg":
		return "image/svg+xml"
	case ".eps":
		return "application/postscript"
	default:
		return "application/octet-stream"
	}
}

func (s *Server) saveProjectBytes(ctx context.Context, pid uuid.UUID, rel string, data []byte) error {
	if !allowedFile(rel) {
		return fmt.Errorf("extension not allowed")
	}
	r := bytes.NewReader(data)
	ct := contentTypeForImport(rel)
	if err := s.store.PutFile(ctx, pid, rel, r, int64(len(data)), ct); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `
INSERT INTO project_files (project_id, path, content_type, size_bytes, updated_at)
VALUES ($1,$2,$3,$4, now())
ON CONFLICT (project_id, path) DO UPDATE SET content_type=EXCLUDED.content_type, size_bytes=EXCLUDED.size_bytes, updated_at=now()`,
		pid, rel, ct, len(data))
	return err
}

func commonZipRoot(names []string) string {
	if len(names) == 0 {
		return ""
	}
	first := names[0]
	i := strings.IndexByte(first, '/')
	if i < 0 {
		return ""
	}
	root := first[:i+1]
	for _, n := range names {
		if !strings.HasPrefix(n, root) {
			return ""
		}
	}
	return root
}

func hasTexFile(paths []string) bool {
	for _, p := range paths {
		if strings.EqualFold(path.Ext(p), ".tex") {
			return true
		}
	}
	return false
}

func pickMainTexPath(paths []string) string {
	var tex []string
	for _, p := range paths {
		if strings.EqualFold(path.Ext(p), ".tex") {
			tex = append(tex, p)
		}
	}
	sort.Strings(tex)
	for _, p := range tex {
		if strings.EqualFold(path.Base(p), "main.tex") {
			return p
		}
	}
	if len(tex) > 0 {
		return tex[0]
	}
	return "main.tex"
}

func parseZipToFiles(z *zip.Reader) (map[string][]byte, error) {
	var rawNames []string
	for _, f := range z.File {
		if f.FileInfo().IsDir() || strings.HasSuffix(f.Name, "/") {
			continue
		}
		rawNames = append(rawNames, f.Name)
	}
	if len(rawNames) == 0 {
		return nil, fmt.Errorf("empty archive")
	}
	prefix := commonZipRoot(rawNames)
	out := make(map[string][]byte)
	var total int64
	for _, f := range z.File {
		if f.FileInfo().IsDir() || strings.HasSuffix(f.Name, "/") {
			continue
		}
		rel := strings.TrimPrefix(f.Name, prefix)
		rel = strings.TrimPrefix(rel, "/")
		rel, ok := sanitizeRelPath(rel)
		if !ok || !allowedFile(rel) {
			continue
		}
		if f.UncompressedSize64 > maxUncompressedPerEntry {
			return nil, fmt.Errorf("file too large: %s", rel)
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(io.LimitReader(rc, maxUncompressedPerEntry+1))
		_ = rc.Close()
		if err != nil {
			return nil, err
		}
		if int64(len(data)) > maxUncompressedPerEntry {
			return nil, fmt.Errorf("file too large: %s", rel)
		}
		total += int64(len(data))
		if total > maxImportZipBytes {
			return nil, fmt.Errorf("archive uncompressed size too large")
		}
		out[rel] = data
		if len(out) > maxImportZipEntries {
			return nil, fmt.Errorf("too many files")
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no allowed files in archive")
	}
	return out, nil
}

func (s *Server) importFilesIntoNewProject(ctx context.Context, uid uuid.UUID, name string, files map[string][]byte) (uuid.UUID, error) {
	paths := make([]string, 0, len(files))
	for p := range files {
		paths = append(paths, p)
	}
	if !hasTexFile(paths) {
		return uuid.Nil, fmt.Errorf("archive must contain at least one .tex file")
	}
	mainPath := pickMainTexPath(paths)
	id, err := s.newProject(ctx, uid, name, mainPath)
	if err != nil {
		return uuid.Nil, err
	}
	for rel, data := range files {
		if err := s.saveProjectBytes(ctx, id, rel, data); err != nil {
			_, _ = s.pool.Exec(ctx, `DELETE FROM projects WHERE id=$1`, id)
			return uuid.Nil, err
		}
	}
	if err := s.EnsureAgentWorkspace(ctx, id); err != nil {
		s.log.Warn("ensure agent workspace", "project", id, "err", err)
	}
	return id, nil
}

func (s *Server) handleImportProjectZip(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid, _ := UserID(ctx)
	if err := r.ParseMultipartForm(maxImportZipBytes); err != nil {
		writeError(w, http.StatusBadRequest, "multipart")
		return
	}
	name := strings.TrimSpace(r.FormValue("name"))
	if name == "" {
		name = "Imported"
	}
	file, _, err := r.FormFile("archive")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing archive")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxImportZipBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "read error")
		return
	}
	if int64(len(data)) > maxImportZipBytes {
		writeError(w, http.StatusBadRequest, "archive too large")
		return
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid zip")
		return
	}
	files, err := parseZipToFiles(zr)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	id, err := s.importFilesIntoNewProject(ctx, uid, name, files)
	if err != nil {
		st := http.StatusInternalServerError
		msg := "import failed"
		es := err.Error()
		if strings.Contains(es, ".tex") || strings.Contains(es, "no allowed") || strings.Contains(es, "empty") || strings.Contains(es, "too large") || strings.Contains(es, "too many") {
			st = http.StatusBadRequest
			msg = es
		}
		writeError(w, st, msg)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id.String(), "main_tex_path": pickMainTexPath(keysOf(files))})
}

func keysOf(m map[string][]byte) []string {
	k := make([]string, 0, len(m))
	for x := range m {
		k = append(k, x)
	}
	return k
}

func (s *Server) handleImportProjectGitHub(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	uid, _ := UserID(ctx)
	var req importGitHubReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		req.Name = "GitHub import"
	}
	req.Owner = strings.TrimSpace(req.Owner)
	req.Repo = strings.TrimSpace(strings.TrimSuffix(req.Repo, ".git"))
	req.Ref = strings.TrimSpace(req.Ref)
	if req.Ref == "" {
		req.Ref = "main"
	}
	if req.Owner == "" || req.Repo == "" || strings.Contains(req.Owner, "/") || strings.Contains(req.Repo, "/") {
		writeError(w, http.StatusBadRequest, "invalid owner or repo")
		return
	}
	url := fmt.Sprintf("https://codeload.github.com/%s/%s/zip/refs/heads/%s", req.Owner, req.Repo, req.Ref)
	client := &http.Client{Timeout: githubImportTimeout}
	hreq, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "request error")
		return
	}
	hreq.Header.Set("User-Agent", "TexPad-Import/1.0")
	resp, err := client.Do(hreq)
	if err != nil {
		writeError(w, http.StatusBadGateway, "download failed")
		return
	}
	if resp.StatusCode == http.StatusNotFound && req.Ref == "main" {
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		req.Ref = "master"
		url = fmt.Sprintf("https://codeload.github.com/%s/%s/zip/refs/heads/%s", req.Owner, req.Repo, req.Ref)
		hreq2, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		hreq2.Header.Set("User-Agent", "TexPad-Import/1.0")
		resp2, err2 := client.Do(hreq2)
		if err2 != nil {
			writeError(w, http.StatusBadGateway, "download failed")
			return
		}
		defer resp2.Body.Close()
		resp = resp2
	} else {
		defer resp.Body.Close()
	}
	if resp.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadRequest, "github archive not found")
		return
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxImportZipBytes+1))
	if err != nil {
		writeError(w, http.StatusBadGateway, "read error")
		return
	}
	if int64(len(data)) > maxImportZipBytes {
		writeError(w, http.StatusBadRequest, "archive too large")
		return
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid zip")
		return
	}
	files, err := parseZipToFiles(zr)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	id, err := s.importFilesIntoNewProject(ctx, uid, req.Name, files)
	if err != nil {
		st := http.StatusInternalServerError
		msg := "import failed"
		es := err.Error()
		if strings.Contains(es, ".tex") || strings.Contains(es, "no allowed") || strings.Contains(es, "empty") || strings.Contains(es, "too large") || strings.Contains(es, "too many") {
			st = http.StatusBadRequest
			msg = es
		}
		writeError(w, st, msg)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id.String(), "main_tex_path": pickMainTexPath(keysOf(files))})
}
