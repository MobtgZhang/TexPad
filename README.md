# TexPad

[![CI](https://github.com/mobtgzhang/TexPad/actions/workflows/ci.yml/badge.svg)](https://github.com/mobtgzhang/TexPad/actions/workflows/ci.yml)

开源在线 LaTeX 编辑器：Go 后端、Vite 前端、MinIO 存储、Docker TeX Live 编译、PDF 预览、可选 Yjs 协作，以及基于 OpenAI 兼容 API 的 **Agent** 与异步 **Paperclaw** 论文辅助流水线。

**English summary:** TexPad is an open-source LaTeX web editor with a Go API, object storage, sandboxed compiles (Docker or native TeX Live), and an optional LLM agent plus async “Paperclaw” jobs. Docker Compose no longer commits real secrets: copy `.env.docker.example` to `.env.docker` and pass it to Compose (the Makefile does this).

---

## 目录

1. [安全与威胁模型](#安全与威胁模型)
2. [默认端口与服务](#默认端口与服务)
3. [快速开始（本机）](#快速开始本机)
4. [Docker Compose 全栈](#docker-compose-全栈)
5. [Makefile 常用命令](#makefile-常用命令)
6. [编译与 TeX Live 镜像](#编译与-tex-live-镜像)
7. [Agent 与 Paperclaw](#agent-与-paperclaw)
8. [API 摘要](#api-摘要)
9. [Roadmap：独立编译执行面](#roadmap独立编译执行面)
10. [License](#license)

---

## 安全与威胁模型

- **密钥**：`docker-compose.yml` 不再内联生产级密码。请使用根目录 **`.env.docker`**（由 `make env-docker` 从 [`.env.docker.example`](.env.docker.example) 生成），为 `POSTGRES_PASSWORD`、`MINIO_ROOT_PASSWORD`、`TEXPAD_JWT_SECRET` 等设置强随机值。**切勿**在未更换默认密钥的情况下将栈暴露到公网。
- **`/var/run/docker.sock`**：后端容器挂载宿主 Docker 套接字时，等价于授予后端（及潜在攻击者）在宿主机上创建容器的权力。仅适用于**本机或完全信任**的环境。中长期应改为 **独立 compile-worker / 远程编译 API**，使 API 进程不再持有宿主 Docker（见下文 Roadmap）。
- **CORS**：Compose 中通过 `TEXPAD_CORS_ORIGINS` 注入（见 `.env.docker`），便于区分开发/预发/生产。

---

## 默认端口与服务

| 服务 | 宿主机端口 | 说明 |
|------|------------|------|
| 前端（`make run` / Vite） | 18474 | `frontend/.env` 中 `VITE_API_BASE` 指向后端 |
| 后端 HTTP | 18473 | `.env` 中 `TEXPAD_HTTP_ADDR` |
| Nginx 前端（Compose `web`） | 18472 | `make run-docker` 浏览器入口 |
| PostgreSQL | 25432 → 5432 | 与 `.env.example` 中 `TEXPAD_DATABASE_URL` 一致 |
| Redis | 26379 → 6379 | |
| MinIO API / 控制台 | 19000 / 19001 | |
| 协作 y-websocket（可选） | 18475 | `docker compose --profile collab` |

生产环境可全部改为标准端口，只要 **`.env` / `.env.docker` / 前端环境变量** 一致即可。

---

## 快速开始（本机）

1. 复制环境：`cp .env.example .env`，按需改数据库与 MinIO 密码；若用 Compose 起依赖，**请让 `.env` 里数据库密码与 `.env.docker` 中 `POSTGRES_PASSWORD` 一致**。
2. 复制前端：`cp frontend/.env.example frontend/.env`。
3. 依赖：`make start-deps`（`docker compose --env-file .env.docker up -d postgres redis minio` + 迁移）或按 `.env.example` 自行安装本机 PG/Redis/MinIO。
4. 运行：`make run`（本机 `latexmk`，不启 Docker 编译）。

---

## Docker Compose 全栈

1. `make env-docker`：生成 `.env.docker`（若不存在），**编辑其中全部 `change-me` 字段**。
2. `make run-docker`：构建 TeX Live **full** 镜像并启动 `postgres` / `redis` / `minio` / `backend` / `web`。
3. 浏览器访问 **http://localhost:18472**。

后端在容器内通过 **命名卷** `texpad_compile_workspace` 与 `TEXPAD_COMPILE_WORKSPACE_DIR=/compile-work` 共享编译工作区；`TEXPAD_REQUIRE_COMPILE_VOLUME=true` 时，若未配置卷，**进程启动将失败**（见 `config.ValidateCompile`）。

**MinIO 启动失败 `Unknown xl meta version 3`**：说明 Docker 卷 `miniodata` 曾被**较新**的 MinIO 写入，当前 `docker-compose.yml` 里固定的镜像若过旧则无法读该卷。请 `git pull` 使用仓库已更新的 MinIO tag，或自行把 `minio` 服务的 `image` 调到与数据兼容的版本。若可清空对象存储，可执行 `docker compose ... down` 后 `docker volume rm texpad_miniodata`（**会删除桶内对象**）再启动。

**后端退出、`password authentication failed for user "texpad"`**：Postgres **首次启动时**会把 `.env.docker` 里的 `POSTGRES_PASSWORD` 写入命名卷 `pgdata`，之后**改密码不会自动同步**。若你换过 `.env.docker` 或新建了 `.env.docker` 但卷是旧的，后端 `TEXPAD_DATABASE_URL` 里的密码与库里不一致就会失败。**任选其一**：(1) 把 `.env.docker` 的 `POSTGRES_PASSWORD` 改回**当初创建该卷时**用的密码；或 (2) 停栈后删除 Postgres 数据卷再启动（**库内数据全部丢失**）：
`docker compose -f docker-compose.yml --env-file .env.docker down`  
`docker volume rm texpad_pgdata`  
再 `make run-docker`（`migrate` 会在 `docker-entrypoint` 里跑）。

---

## Makefile 常用命令

| 目标 | 说明 |
|------|------|
| `make env` / `make env-docker` | 生成本机 `.env` / Compose `.env.docker` |
| `make up` / `make down` | 仅基础设施（PG/Redis/MinIO） |
| `make run` | 本机后端 + 前端 |
| `make run-docker` | 一键 Docker 全栈（含 full TeX） |
| `make build-docker-slim` | 仅构建 `texpad-texlive:2025-slim`（scheme **medium**，体积小） |
| `make test` | 后端 `go test ./...` |

---

## 编译与 TeX Live 镜像

- **full**：`docker compose --profile compile build texlive2025 texlive2024`，镜像宏包全，构建慢、体积大。
- **slim**：`make build-docker-slim`，`Dockerfile.slim` 使用上游 `scheme=medium`，适合 CI 或快速试跑；复杂文档若缺包请改回 full。
- **排障**：若 Docker 模式下 `build.log` 为空，几乎都是**未挂载与宿主 `docker run` 共享的命名卷**；参阅下文与 `.env.example` 中「Docker 编译必填」。

---

## Agent 与 Paperclaw

- **Agent**：`POST /api/v1/projects/{id}/agent/stream`（SSE）；工具定义集中在 `backend/internal/agent/tool_manifest.go`（`OpenAIToolDefinitions`）。
- **Paperclaw**：异步任务 `POST /api/v1/projects/{id}/paperclaw/jobs`，服务端执行与编辑器相同的 Agent 流水线（静默 SSE），结束时将 `file_write` 待办写入存储。需要服务端配置 **`TEXPAD_LLM_BASE_URL` 与 `TEXPAD_LLM_API_KEY`**（不使用浏览器里填的临时密钥）。取消：`POST .../paperclaw/jobs/{jobID}/cancel`。
- **LLM 是否就绪**：`GET /api/v1/projects/{id}/agent/llm-configured` → `{ "configured": true/false }`。

---

## API 摘要

- 认证：`POST /api/v1/auth/register`、`POST /api/v1/auth/login`
- 项目与文件：`/api/v1/projects`、`/api/v1/projects/{id}/files/...`
- 编译：`POST /api/v1/projects/{id}/compile`、`GET /api/v1/compile/jobs/{id}`
- PDF：`GET /api/v1/projects/{id}/pdf/{jobId}/download`
- 分享只读：`GET /api/v1/share/{token}/...`

详见 `backend/internal/httpapi`。

---

## Roadmap：独立编译执行面

当前设计依赖「API 容器 + 宿主 `docker.sock`」触发 `docker run texpad-texlive`。后续可改为：

- 独立 **compile-worker** 服务（仅负责拉取工件、跑容器、回传日志/PDF），API 通过队列或 gRPC 下发任务；或
- 远程固定版本 **编译服务**，API 仅上传 zip / 下载 PDF。

这样生产环境可去掉对宿主 Docker 套接字的依赖，缩小攻击面。

扩展阅读（未实现）：[`ideas/mcp-extension.md`](ideas/mcp-extension.md)（MCP 插件化草案）。

---

## License

Apache-2.0（见 [LICENSE](LICENSE)）。
