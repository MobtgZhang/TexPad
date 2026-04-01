# TexPad — 本地开发常用命令（需要 bash）
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

ROOT := $(abspath .)
BACKEND := $(ROOT)/backend
FRONTEND := $(ROOT)/frontend
BIN := $(ROOT)/bin

export PATH := $(PATH)

.PHONY: help env up down migrate start-deps \
	build build-backend build-frontend build-docker \
	run run-backend run-backend-docker run-frontend \
	clean test lint

help:
	@echo "TexPad Makefile"
	@echo ""
	@echo "  make env              若无 .env 则从 .env.example 复制"
	@echo "  make up               启动 Postgres / Redis / MinIO（Docker）"
	@echo "  make down             停止 compose 服务"
	@echo "  make migrate          执行数据库迁移"
	@echo "  make start-deps       等价于 up + migrate（可选，与 make run 分离）"
	@echo ""
	@echo "  make build            编译后端二进制 + 前端静态资源"
	@echo "  make build-backend    输出 $(BIN)/texpad-server 与 texpad-migrate"
	@echo "  make build-frontend   npm run build（frontend）"
	@echo "  make build-docker     构建 compose 中的自定义镜像（texlive、collab）"
	@echo ""
	@echo "  make run              仅本机后端 + 前端（不调用 Docker；需 .env 里已配置 PG/Redis/MinIO 等）"
	@echo "  make run-backend      仅后端（TEXPAD_COMPILE_NATIVE=true + 本机 latexmk）"
	@echo "  make run-backend-docker  仅后端（Docker TeX 镜像编译；需先 make build-docker）"
	@echo "  make run-frontend     仅前端 vite dev"
	@echo ""
	@echo "  make test             go test ./...（backend）"
	@echo "  make clean            删除 $(BIN) 与 frontend/dist"

# -----------------------------------------------------------------------------
# 环境
# -----------------------------------------------------------------------------

env:
	@if [ ! -f "$(ROOT)/.env" ]; then cp "$(ROOT)/.env.example" "$(ROOT)/.env" && echo "Created .env from .env.example"; else echo ".env already exists"; fi
	@if [ ! -f "$(FRONTEND)/.env" ] && [ -f "$(FRONTEND)/.env.example" ]; then cp "$(FRONTEND)/.env.example" "$(FRONTEND)/.env" && echo "Created frontend/.env"; fi

up: env
	docker compose -f "$(ROOT)/docker-compose.yml" up -d postgres redis minio

down:
	docker compose -f "$(ROOT)/docker-compose.yml" down

migrate:
	cd "$(BACKEND)" && go run ./cmd/migrate

start-deps: up migrate

# -----------------------------------------------------------------------------
# 构建
# -----------------------------------------------------------------------------

build: build-backend build-frontend

build-backend:
	mkdir -p "$(BIN)"
	cd "$(BACKEND)" && go build -o "$(BIN)/texpad-server" ./cmd/server/
	cd "$(BACKEND)" && go build -o "$(BIN)/texpad-migrate" ./cmd/migrate/

build-frontend:
	cd "$(FRONTEND)" && npm ci && npm run build

build-docker:
	docker compose -f "$(ROOT)/docker-compose.yml" --profile compile --profile collab build texlive collab

# -----------------------------------------------------------------------------
# 运行（本机 TeX：需已安装 TeX Live / latexmk 在 PATH 中）
# -----------------------------------------------------------------------------

run-backend:
	cd "$(BACKEND)" && TEXPAD_COMPILE_NATIVE=true go run ./cmd/server

run-backend-docker:
	cd "$(BACKEND)" && TEXPAD_COMPILE_NATIVE=false go run ./cmd/server

run-frontend:
	cd "$(FRONTEND)" && ([ -d node_modules ] || npm install) && npm run dev

# 后台起后端，前台起前端；不启动 Docker（数据库/Redis/MinIO 由本机或其它方式提供）
run:
	@set -euo pipefail; \
	cd "$(BACKEND)" && TEXPAD_COMPILE_NATIVE=true go run ./cmd/server & \
	pid=$$!; \
	trap 'kill $$pid 2>/dev/null || true' EXIT INT TERM; \
	sleep 2; \
	cd "$(FRONTEND)" && ([ -d node_modules ] || npm install) && npm run dev

# -----------------------------------------------------------------------------
# 其它
# -----------------------------------------------------------------------------

test:
	cd "$(BACKEND)" && go test ./...

lint:
	cd "$(BACKEND)" && go vet ./...

clean:
	rm -rf "$(BIN)" "$(FRONTEND)/dist"
