package compile

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/mobtgzhang/TexPad/backend/internal/parse"
	"github.com/mobtgzhang/TexPad/backend/internal/storage"
)

// RuntimeOpts 编译运行时参数（超时、Docker 资源）。
type RuntimeOpts struct {
	CompileTimeout time.Duration
	DockerMemory   string
	// 非空时：在 CompileWorkspaceDir 下 MkdirTemp，且 docker run 使用 -v CompileDockerVolume:/_texpad_w -w /_texpad_w/子目录（与后端读同一命名卷）。
	CompileDockerVolume string
	CompileWorkspaceDir string
}

type Manager struct {
	pool           *pgxpool.Pool
	store          *storage.Client
	dockerBin      string
	texImage       string
	texImage2024   string
	texImage2025   string
	compileTimeout time.Duration
	dockerMemory   string
	workers        int
	jobs           chan uuid.UUID
	rdb            *redis.Client
	logger         *slog.Logger
	cacheEnabled   bool
	native         bool
	compileDockerVolume string
	compileWorkspaceDir string
	OnFinish       func(projectID, jobID uuid.UUID)
}

// resolveDockerBin returns an absolute path or a name that exec.LookPath can find.
// 容器内常见 PATH 不含 /usr/local/bin，仅配置 "docker" 会报 executable file not found。
func resolveDockerBin(cfg string) string {
	s := strings.TrimSpace(cfg)
	if s == "" {
		s = "docker"
	}
	if filepath.IsAbs(s) {
		return s
	}
	if p, err := exec.LookPath(s); err == nil && p != "" {
		return p
	}
	for _, cand := range []string{"/usr/local/bin/docker", "/usr/bin/docker"} {
		if fi, err := os.Stat(cand); err == nil && fi.Mode().IsRegular() {
			return cand
		}
	}
	return s
}

func NewManager(pool *pgxpool.Pool, store *storage.Client, dockerBin, texImage, texImage2024, texImage2025 string, workers int, rdb *redis.Client, logger *slog.Logger, native bool, rt RuntimeOpts) *Manager {
	if workers < 1 {
		workers = 2
	}
	if texImage2024 == "" {
		texImage2024 = texImage
	}
	if texImage2025 == "" {
		texImage2025 = texImage
	}
	to := rt.CompileTimeout
	if to <= 0 {
		to = 10 * time.Minute
	}
	dmem := strings.TrimSpace(rt.DockerMemory)
	if dmem == "" {
		dmem = "2048m"
	}
	dbin := strings.TrimSpace(dockerBin)
	if !native {
		dbin = resolveDockerBin(dbin)
	}
	vol := strings.TrimSpace(rt.CompileDockerVolume)
	ws := strings.TrimSpace(rt.CompileWorkspaceDir)
	if vol != "" && ws == "" {
		ws = "/compile-work"
	}
	if vol != "" && ws != "" {
		if fi, err := os.Stat(ws); err != nil || !fi.IsDir() {
			logger.Warn("compile docker volume configured but workspace dir missing; falling back to default tmp", "dir", ws, "err", err)
			vol, ws = "", ""
		}
	}
	return &Manager{
		pool:           pool,
		store:          store,
		dockerBin:      dbin,
		texImage:       texImage,
		texImage2024:   texImage2024,
		texImage2025:   texImage2025,
		compileTimeout: to,
		dockerMemory:   dmem,
		workers:        workers,
		jobs:           make(chan uuid.UUID, 256),
		rdb:            rdb,
		logger:         logger,
		cacheEnabled:   true,
		native:         native,
		compileDockerVolume: vol,
		compileWorkspaceDir: ws,
	}
}

func exitCodeOf(err error) int {
	if err == nil {
		return 0
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode()
	}
	return -1
}

func compileFailureSummary(logText string, wrapErr error, issues []parse.LogIssue) string {
	if msg := parse.PrimaryCompileError(logText, issues); msg != "" {
		return msg
	}
	ec := exitCodeOf(wrapErr)
	switch ec {
	case 11:
		return "latexmk 退出码 11：某条编译规则失败（多为 TeX 报错）。请在日志中查找以 \"!\" 开头的行或 \"Package … Error\"。"
	case 12:
		return "latexmk 退出码 12：未得到有效 PDF。请查看日志末尾 latexmk 汇总与 pdflatex 输出。"
	default:
		if ec > 0 {
			return fmt.Sprintf("编译失败（退出码 %d），未生成 PDF。请查看完整日志。", ec)
		}
	}
	return "PDF not produced"
}

func appendWrapperLog(logText string, wrapOut []byte, wrapErr error, label string) string {
	trimmed := strings.TrimSpace(string(wrapOut))
	if wrapErr == nil && trimmed == "" {
		return logText
	}
	ec := exitCodeOf(wrapErr)
	var b strings.Builder
	b.WriteString(logText)
	b.WriteString(fmt.Sprintf("\n\n---\n%s（退出码 %d）:\n", label, ec))
	if trimmed != "" {
		b.WriteString(trimmed)
	} else if wrapErr != nil {
		b.WriteString(wrapErr.Error())
	}
	return b.String()
}

func (m *Manager) Start(ctx context.Context) {
	var wg sync.WaitGroup
	for i := 0; i < m.workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case id := <-m.jobs:
					m.runJob(context.Background(), id)
				}
			}
		}()
	}
	<-ctx.Done()
	wg.Wait()
}

func (m *Manager) dockerImageForYear(year string) string {
	switch year {
	case "2024":
		return m.texImage2024
	case "2025":
		return m.texImage2025
	default:
		return m.texImage2025
	}
}

func (m *Manager) Enqueue(jobID uuid.UUID) {
	select {
	case m.jobs <- jobID:
	default:
		go func() { m.jobs <- jobID }()
	}
}

func (m *Manager) runJob(ctx context.Context, jobID uuid.UUID) {
	var projectID uuid.UUID
	var engine, mainPath, texliveYear string
	var draftMode, haltOnError, cleanBuild, syntaxCheck bool
	err := m.pool.QueryRow(ctx, `SELECT project_id, engine, draft_mode, halt_on_error, clean_build, syntax_check, COALESCE(NULLIF(trim(texlive_year),''),'2025') FROM compile_jobs WHERE id=$1`, jobID).Scan(
		&projectID, &engine, &draftMode, &haltOnError, &cleanBuild, &syntaxCheck, &texliveYear)
	if err != nil {
		m.logger.Error("compile job lookup", "job", jobID, "err", err)
		msg := "无法读取编译任务（请确认已执行数据库迁移，且包含 compile_jobs.texlive_year 等列）: " + err.Error()
		_, _ = m.pool.Exec(context.Background(), `UPDATE compile_jobs SET status=$1, error_text=$2, log_text=$2, updated_at=now() WHERE id=$3`, "failed", msg, jobID)
		return
	}
	defer func() {
		if m.OnFinish != nil {
			m.OnFinish(projectID, jobID)
		}
	}()
	_, _ = m.pool.Exec(ctx, `UPDATE compile_jobs SET status=$1, updated_at=now() WHERE id=$2`, "running", jobID)
	_ = m.pool.QueryRow(ctx, `SELECT main_tex_path FROM projects WHERE id=$1`, projectID).Scan(&mainPath)
	if mainPath == "" {
		mainPath = "main.tex"
	}

	var tmp string
	if !m.native && m.compileDockerVolume != "" && m.compileWorkspaceDir != "" {
		tmp, err = os.MkdirTemp(m.compileWorkspaceDir, "texpad-compile-*")
	} else {
		tmp, err = os.MkdirTemp("", "texpad-compile-*")
	}
	if err != nil {
		m.fail(ctx, jobID, err.Error())
		return
	}
	defer os.RemoveAll(tmp)

	contentHash, err := m.materializeProject(ctx, projectID, tmp)
	if err != nil {
		m.fail(ctx, jobID, err.Error())
		return
	}

	cacheKey := ""
	if m.cacheEnabled && m.rdb != nil {
		h := sha256.Sum256([]byte(contentHash + "|" + engine + "|" + mainPath + "|" + fmt.Sprint(draftMode) + "|" + fmt.Sprint(haltOnError) + "|" + fmt.Sprint(syntaxCheck) + "|" + fmt.Sprint(cleanBuild) + "|" + texliveYear))
		cacheKey = "compile:cache:" + hex.EncodeToString(h[:])
		if s, err := m.rdb.Get(ctx, cacheKey).Result(); err == nil && s != "" {
			var cached struct {
				PDFKey     string `json:"pdf"`
				Log        string `json:"log"`
				SynctexKey string `json:"synctex"`
			}
			if json.Unmarshal([]byte(s), &cached) == nil && cached.PDFKey != "" {
				newKey := storage.ArtifactPDFKey(projectID, jobID)
				if err := m.store.CopyObject(ctx, cached.PDFKey, newKey); err == nil {
					var synCol any
					if cached.SynctexKey != "" {
						ns := storage.ArtifactSynctexKey(projectID, jobID)
						if m.store.CopyObject(ctx, cached.SynctexKey, ns) == nil {
							synCol = ns
						}
					}
					_, _ = m.pool.Exec(ctx, `UPDATE compile_jobs SET status=$1, pdf_object_key=$2, synctex_object_key=$3, log_text=$4, updated_at=now() WHERE id=$5`,
						"success", newKey, synCol, cached.Log, jobID)
					return
				}
			}
		}
	}

	latexArg := strings.ReplaceAll(mainPath, `\`, `/`)
	logPath := filepath.Join(tmp, "build.log")
	baseNoExt := strings.TrimSuffix(mainPath, path.Ext(mainPath))
	pdfHostPath := filepath.Join(tmp, filepath.FromSlash(baseNoExt)+".pdf")
	synctexPath := filepath.Join(tmp, filepath.FromSlash(baseNoExt)+".synctex.gz")

	if cleanBuild {
		var cleanScript string
		if engine == "context" {
			cleanScript = fmt.Sprintf("context --purgeall %q 2>/dev/null || true; rm -f *.tuc *.tua 2>/dev/null || true", latexArg)
		} else {
			cleanScript = "latexmk -C 2>/dev/null || true; rm -f *.aux *.bbl *.blg *.fdb_latexmk *.fls *.log *.out *.toc *.synctex.gz 2>/dev/null || true"
		}
		cleanCmd := exec.CommandContext(ctx, "sh", "-c", cleanScript)
		cleanCmd.Dir = tmp
		_ = cleanCmd.Run()
	}

	if syntaxCheck && engine != "context" {
		synCtx, synCancel := context.WithTimeout(ctx, 60*time.Second)
		defer synCancel()
		chkScript := fmt.Sprintf(`if ! command -v chktex >/dev/null 2>&1; then exit 0; fi; chktex -q %q; ec=$?; if [ "$ec" -ge 2 ]; then exit "$ec"; else exit 0; fi`, latexArg)
		chk := exec.CommandContext(synCtx, "sh", "-c", chkScript)
		chk.Dir = tmp
		chkOut, chkErr := chk.CombinedOutput()
		if chkErr != nil {
			_, _ = m.pool.Exec(ctx, `UPDATE compile_jobs SET status=$1, log_text=$2, error_text=$3, updated_at=now() WHERE id=$4`,
				"failed", string(chkOut), "chktex: syntax issues before compile", jobID)
			return
		}
	}

	haltFlag := ""
	if haltOnError {
		haltFlag = " -halt-on-error"
	}
	var latexmkLine string
	switch engine {
	case "xelatex":
		latexmkLine = fmt.Sprintf("latexmk -xelatex -synctex=1 -interaction=nonstopmode%s %q > build.log 2>&1", haltFlag, latexArg)
	case "lualatex":
		latexmkLine = fmt.Sprintf("latexmk -lualatex -synctex=1 -interaction=nonstopmode%s %q > build.log 2>&1", haltFlag, latexArg)
	case "context":
		// ConTeXt LMTX/MkIV：生成与主文件同基的 PDF；synctex 在多数发行版可用
		latexmkLine = fmt.Sprintf("context --nonstopmode --synctex=on %q > build.log 2>&1", latexArg)
	default:
		engine = "pdflatex"
		if draftMode {
			ho := ""
			if haltOnError {
				ho = "-halt-on-error "
			}
			latexmkLine = fmt.Sprintf("latexmk -pdf -synctex=1 -interaction=nonstopmode -pdflatex=\"pdflatex -synctex=1 -interaction=nonstopmode %s-draftmode %%O %%S\" %q > build.log 2>&1", ho, latexArg)
		} else {
			latexmkLine = fmt.Sprintf("latexmk -pdf -synctex=1 -interaction=nonstopmode%s %q > build.log 2>&1", haltFlag, latexArg)
		}
	}

	cctx, cancel := context.WithTimeout(ctx, m.compileTimeout)
	defer cancel()
	var wrapOut []byte
	var wrapErr error
	wrapLabel := "宿主 shell（编译命令外层）"
	if m.native {
		cmd := exec.CommandContext(cctx, "sh", "-c", latexmkLine)
		cmd.Dir = tmp
		cmd.Env = os.Environ()
		wrapOut, wrapErr = cmd.CombinedOutput()
	} else {
		img := m.dockerImageForYear(texliveYear)
		wrapLabel = "docker run"
		dockerArgs := []string{
			"run", "--rm",
			"--network=none",
			"--memory=" + m.dockerMemory, "--cpus=1",
		}
		if m.compileDockerVolume != "" && m.compileWorkspaceDir != "" {
			rel, relErr := filepath.Rel(m.compileWorkspaceDir, tmp)
			if relErr != nil || strings.HasPrefix(rel, "..") {
				m.fail(ctx, jobID, "compile temp dir not under shared workspace (check TEXPAD_COMPILE_WORKSPACE_DIR)")
				return
			}
			sub := filepath.ToSlash(rel)
			dockerArgs = append(dockerArgs, "-v", m.compileDockerVolume+":/_texpad_w", "-w", "/_texpad_w/"+sub)
		} else {
			dockerArgs = append(dockerArgs, "-v", tmp+":/work", "-w", "/work")
		}
		dockerArgs = append(dockerArgs, img, "sh", "-c", latexmkLine)
		cmd := exec.CommandContext(cctx, m.dockerBin, dockerArgs...)
		wrapOut, wrapErr = cmd.CombinedOutput()
		if len(wrapOut) > 0 || wrapErr != nil {
			m.logger.Warn("compile docker wrapper", "job", jobID, "image", img, "exit", exitCodeOf(wrapErr), "err", wrapErr)
		}
	}
	if m.native && (len(wrapOut) > 0 || wrapErr != nil) {
		m.logger.Warn("compile native wrapper", "job", jobID, "exit", exitCodeOf(wrapErr), "err", wrapErr)
	}

	logBytes, _ := os.ReadFile(logPath)
	logBody := string(logBytes)
	if !m.native && strings.TrimSpace(logBody) == "" && m.compileDockerVolume == "" {
		logBody += "（未读取到 build.log：后端若在容器内通过宿主 docker 编译，容器内 /tmp 与宿主 docker 挂载路径不一致。请配置 TEXPAD_COMPILE_DOCKER_VOLUME 与 TEXPAD_COMPILE_WORKSPACE_DIR，并挂载同名卷到后端容器，详见 README。）\n"
	}
	logText := appendWrapperLog(logBody, wrapOut, wrapErr, wrapLabel)
	issues := parse.LaTeXIssues(logText)

	pdfData, err := os.ReadFile(pdfHostPath)
	if err != nil || len(pdfData) < 100 {
		errMsg := compileFailureSummary(logText, wrapErr, issues)
		_, _ = m.pool.Exec(ctx, `UPDATE compile_jobs SET status=$1, log_text=$2, error_text=$3, updated_at=now() WHERE id=$4`,
			"failed", logText, errMsg, jobID)
		return
	}

	pdfKey := storage.ArtifactPDFKey(projectID, jobID)
	if err := m.store.PutArtifact(ctx, pdfKey, bytes.NewReader(pdfData), int64(len(pdfData))); err != nil {
		m.fail(ctx, jobID, err.Error())
		return
	}
	var synCol any
	synData, synErr := os.ReadFile(synctexPath)
	if synErr == nil && len(synData) > 0 {
		sk := storage.ArtifactSynctexKey(projectID, jobID)
		if err := m.store.PutArtifactTyped(ctx, sk, bytes.NewReader(synData), int64(len(synData)), "application/gzip"); err == nil {
			synCol = sk
		}
	}
	_, _ = m.pool.Exec(ctx, `UPDATE compile_jobs SET status=$1, pdf_object_key=$2, synctex_object_key=$3, log_text=$4, error_text=$5, updated_at=now() WHERE id=$6`,
		"success", pdfKey, synCol, logText, "", jobID)

	if cacheKey != "" && m.rdb != nil {
		synK := ""
		if synCol != nil {
			synK, _ = synCol.(string)
		}
		b, _ := json.Marshal(map[string]string{"pdf": pdfKey, "log": logText, "synctex": synK})
		_ = m.rdb.Set(ctx, cacheKey, b, 24*time.Hour).Err()
	}
}

func (m *Manager) materializeProject(ctx context.Context, projectID uuid.UUID, dir string) (fingerprint string, err error) {
	rows, err := m.pool.Query(ctx, `SELECT path FROM project_files WHERE project_id=$1`, projectID)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var paths []string
	h := sha256.New()
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return "", err
		}
		paths = append(paths, p)
	}
	for _, p := range paths {
		obj, err := m.store.GetFile(ctx, projectID, p)
		if err != nil {
			return "", err
		}
		full := filepath.Join(dir, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			obj.Close()
			return "", err
		}
		f, err := os.Create(full)
		if err != nil {
			obj.Close()
			return "", err
		}
		_, copyErr := io.Copy(f, obj)
		_ = f.Close()
		_ = obj.Close()
		if copyErr != nil {
			return "", copyErr
		}
		h.Write([]byte(p))
		b, _ := os.ReadFile(full)
		h.Write(b)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func (m *Manager) fail(ctx context.Context, jobID uuid.UUID, msg string) {
	hdr := "---\n编译管线错误（Go/存储）:\n"
	_, _ = m.pool.Exec(ctx, `UPDATE compile_jobs SET status=$1, error_text=$2, log_text=CASE WHEN COALESCE(TRIM(log_text), '') = '' THEN $3 || $2 ELSE TRIM(log_text) || E'\n\n' || $3 || $2 END, updated_at=now() WHERE id=$4`,
		"failed", msg, hdr, jobID)
}
