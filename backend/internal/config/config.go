package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	HTTPAddr      string
	DatabaseURL   string
	RedisAddr     string
	MinioEndpoint string
	MinioAccess   string
	MinioSecret   string
	MinioBucket   string
	MinioUseSSL   bool
	JWTSecret     string
	CORSOrigins   []string
	LLMBaseURL    string
	LLMAPIKey     string
	LLMModel      string
	DockerBin          string
	TexliveImage       string
	TexliveImage2024   string
	TexliveImage2025   string
	CompileNative       bool
	CompileDailyLimit   int // 0 = unlimited; max compile jobs per user per 24h window
	CompileTimeoutSec   int    // latexmk / docker run 超时（秒），0 表示用默认 600
	CompileDockerMemory string // docker run --memory，如 2048m、4g
	// 后端在容器内、通过宿主 docker.sock 执行 docker run 时：宿主解析的 bind 路径是「宿主机路径」，与容器内 os.MkdirTemp("",…) 不一致会导致读不到 build.log。
	// 设置「命名卷名 + 后端内挂载目录」后，编译任务在共享卷子目录执行，与读日志路径一致。
	CompileDockerVolume  string
	CompileWorkspaceDir string
}

func Load() Config {
	return Config{
		HTTPAddr:      getenv("TEXPAD_HTTP_ADDR", ":18473"),
		DatabaseURL:   getenv("TEXPAD_DATABASE_URL", "postgres://texpad:texpad@localhost:25432/texpad?sslmode=disable"),
		RedisAddr:     getenv("TEXPAD_REDIS_ADDR", "localhost:26379"),
		MinioEndpoint: getenv("TEXPAD_MINIO_ENDPOINT", "localhost:19000"),
		MinioAccess:   getenv("TEXPAD_MINIO_ACCESS_KEY", "minio"),
		MinioSecret:   getenv("TEXPAD_MINIO_SECRET_KEY", "minio_secret_change_me"),
		MinioBucket:   getenv("TEXPAD_MINIO_BUCKET", "texpad"),
		MinioUseSSL:   getenvBool("TEXPAD_MINIO_USE_SSL", false),
		JWTSecret:     getenv("TEXPAD_JWT_SECRET", "dev-insecure-change-me"),
		CORSOrigins:   splitCSV(getenv("TEXPAD_CORS_ORIGINS", "http://localhost:18474")),
		LLMBaseURL:    os.Getenv("TEXPAD_LLM_BASE_URL"),
		LLMAPIKey:     os.Getenv("TEXPAD_LLM_API_KEY"),
		LLMModel:      getenv("TEXPAD_LLM_MODEL", "gpt-4o-mini"),
		DockerBin:        getenv("TEXPAD_DOCKER_BIN", "docker"),
		TexliveImage:     getenv("TEXPAD_TEXLIVE_IMAGE", "texpad-texlive:2025"),
		TexliveImage2024: getenv("TEXPAD_TEXLIVE_IMAGE_2024", ""),
		TexliveImage2025: getenv("TEXPAD_TEXLIVE_IMAGE_2025", ""),
		CompileNative:       getenvBool("TEXPAD_COMPILE_NATIVE", false),
		CompileDailyLimit:   getenvInt("TEXPAD_COMPILE_DAILY_LIMIT", 0),
		CompileTimeoutSec:   getenvInt("TEXPAD_COMPILE_TIMEOUT_SEC", 600),
		CompileDockerMemory: getenv("TEXPAD_COMPILE_DOCKER_MEMORY", "2048m"),
		CompileDockerVolume: strings.TrimSpace(os.Getenv("TEXPAD_COMPILE_DOCKER_VOLUME")),
		CompileWorkspaceDir: strings.TrimSpace(os.Getenv("TEXPAD_COMPILE_WORKSPACE_DIR")),
	}
}

func getenvInt(k string, def int) int {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getenvBool(k string, def bool) bool {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
