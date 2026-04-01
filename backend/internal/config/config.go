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
	DockerBin     string
	TexliveImage  string
	CompileNative bool
}

func Load() Config {
	return Config{
		HTTPAddr:      getenv("TEXPAD_HTTP_ADDR", ":8080"),
		DatabaseURL:   getenv("TEXPAD_DATABASE_URL", "postgres://texpad:texpad@localhost:5432/texpad?sslmode=disable"),
		RedisAddr:     getenv("TEXPAD_REDIS_ADDR", "localhost:6379"),
		MinioEndpoint: getenv("TEXPAD_MINIO_ENDPOINT", "localhost:9000"),
		MinioAccess:   getenv("TEXPAD_MINIO_ACCESS_KEY", "minio"),
		MinioSecret:   getenv("TEXPAD_MINIO_SECRET_KEY", "minio_secret_change_me"),
		MinioBucket:   getenv("TEXPAD_MINIO_BUCKET", "texpad"),
		MinioUseSSL:   getenvBool("TEXPAD_MINIO_USE_SSL", false),
		JWTSecret:     getenv("TEXPAD_JWT_SECRET", "dev-insecure-change-me"),
		CORSOrigins:   splitCSV(getenv("TEXPAD_CORS_ORIGINS", "http://localhost:5173")),
		LLMBaseURL:    os.Getenv("TEXPAD_LLM_BASE_URL"),
		LLMAPIKey:     os.Getenv("TEXPAD_LLM_API_KEY"),
		LLMModel:      getenv("TEXPAD_LLM_MODEL", "gpt-4o-mini"),
		DockerBin:     getenv("TEXPAD_DOCKER_BIN", "docker"),
		TexliveImage:  getenv("TEXPAD_TEXLIVE_IMAGE", "texpad-texlive:local"),
		CompileNative: getenvBool("TEXPAD_COMPILE_NATIVE", false),
	}
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
