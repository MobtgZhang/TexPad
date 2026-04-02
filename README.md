# TexPad

Open-source online LaTeX editor with Go backend: projects, MinIO file storage, compile jobs (Docker TeX Live), PDF preview, optional Yjs collaboration, and an LLM agent hook.

## Makefile（推荐）

本机已安装 TeX Live 时，`make run` / `make run-backend` 会设置 `TEXPAD_COMPILE_NATIVE=true`，在宿主机直接调用 `latexmk`。

**`make run` 只启动前端 + 后端进程，不调用 Docker。** 需先在 `.env` 中配置可访问的 Postgres、Redis、MinIO（例如本机安装，或另开终端执行 `make start-deps` 用 compose 拉起）。

| 目标 | 说明 |
|------|------|
| `make run` | 本机 TeX 后端 + Vite 前端（同一终端；**不**含 Docker） |
| `make run-backend` | 仅后端（本机 `latexmk`） |
| `make run-backend-docker` | 仅后端（Docker `texpad-texlive` 编译；需先 `make build-docker`） |
| `make run-frontend` | 仅前端 |
| `make start-deps` | `make up` + `make migrate`（用 Docker 起 PG/Redis/MinIO 并迁移，可选） |
| `make build` | `build-backend` + `build-frontend` |
| `make build-docker` | 构建 `texlive2024` / `texlive2025` 与 `collab` 镜像（需 `--profile`） |
| `make up` / `make down` | 启停 Postgres、Redis、MinIO（Docker） |
| `make migrate` | 数据库迁移 |
| `make clean` | 删除 `bin/` 与 `frontend/dist` |

运行 `make help` 查看全部目标。

## PostgreSQL / Redis / MinIO 安装与配置

后端需要 **PostgreSQL**（业务数据）、**Redis**（限流与编译缓存，不可用时会降级）、**MinIO**（S3 兼容对象存储，存项目文件与 PDF）。`.env` 中的地址、账号需与实际部署一致，默认值见 [.env.example](.env.example)。

### 方式一：Docker Compose（推荐，与仓库配置一致）

已安装 Docker 时，在项目根目录执行：

```bash
make start-deps
# 等价于：docker compose up -d postgres redis minio && cd backend && go run ./cmd/migrate
```

默认映射：`5432`（Postgres）、`6379`（Redis）、`9000`（MinIO API）、`9001`（MinIO 控制台）。首次启动后，后端进程会自动创建 MinIO bucket `texpad`（若不存在）。

### 方式二：本机安装（无 Docker）

以下以 **Debian / Ubuntu** 为例；其它发行版请用对应包管理器安装同名或等价软件包。

**1. PostgreSQL**

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

创建与 `.env.example` 一致的用户与数据库（密码请按需修改，并同步改 `.env` 里的 `TEXPAD_DATABASE_URL`）：

```bash
sudo -u postgres psql -c "CREATE USER texpad WITH PASSWORD 'texpad';"
sudo -u postgres psql -c "CREATE DATABASE texpad OWNER texpad;"
```

连接串示例：`postgres://texpad:texpad@localhost:5432/texpad?sslmode=disable`

**2. Redis**

```bash
sudo apt install -y redis-server
sudo systemctl enable --now redis-server
```

默认监听 `127.0.0.1:6379`，与 `TEXPAD_REDIS_ADDR=localhost:6379` 一致。

**3. MinIO**

从 [MinIO 下载页](https://min.io/download) 获取 Linux 二进制，或使用包管理器（若可用）。示例（单机开发、数据目录自定义）：

```bash
# x86_64 示例；ARM 请从官网选择 linux-arm64 等对应包
wget -qO /tmp/minio https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x /tmp/minio
mkdir -p "$HOME/minio-data"
export MINIO_ROOT_USER=minio
export MINIO_ROOT_PASSWORD=minio_secret_change_me
/tmp/minio server "$HOME/minio-data" --console-address ":9001"
```

保持终端运行，或使用 `systemd`/进程管理器托管。API 默认 `http://localhost:9000`，控制台 `http://localhost:9001`。`.env` 中 `TEXPAD_MINIO_ACCESS_KEY` / `TEXPAD_MINIO_SECRET_KEY` 须与 `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` 一致。

**macOS（Homebrew）简要对应：**

```bash
brew install postgresql@16 redis minio
# 按 brew 提示启动服务；MinIO 可用 `minio server ...` 自行指定端口与数据目录
```

安装完成后：

1. 复制 `.env.example` → `.env`，按上面实际端口与密码修改。
2. 执行一次迁移：`make migrate`（或 `cd backend && go run ./cmd/migrate`）。
3. 再执行 `make run` 启动前后端。

## Quick start

依赖（Postgres / Redis / MinIO）的安装方式见上文 **「PostgreSQL / Redis / MinIO 安装与配置」**。

1. Copy environment files:

   ```bash
   cp .env.example .env
   cp frontend/.env.example frontend/.env
   ```

2. Start infrastructure:

   ```bash
   docker compose up -d postgres redis minio
   ```

3. Create MinIO bucket (first run): the backend creates `texpad` on startup if missing.

4. Run migrations and backend:

   ```bash
   cd backend && go run ./cmd/migrate && go run ./cmd/server
   ```

5. Frontend:

   ```bash
   cd frontend && npm install && npm run dev
   ```

6. Optional — TeX Live 编译镜像（Island of TeX **`full` 方案**，体积大但宏包齐全；`texlive2025` 默认 `latest-full`，`texlive2024` 为 `TL2024-historic`）：

   ```bash
   docker compose --profile compile build texlive2024 texlive2025
   ```

   后端需设置 `TEXPAD_TEXLIVE_IMAGE`、`TEXPAD_TEXLIVE_IMAGE_2024`、`TEXPAD_TEXLIVE_IMAGE_2025`（见 `.env.example`）。**`make run-docker` 会先构建上述镜像**。

7. **`make run-docker` 一键栈**：后端容器内通过挂载 **`/var/run/docker.sock`** 调用宿主 Docker 执行 `docker run … texpad-texlive:*` 编译（与 [Overleaf](https://github.com/overleaf/overleaf) 类似，完整 TeX 在独立镜像中）。仅适用于本机/信任环境；生产请评估安全性或改用独立编译服务。

8. Optional — Yjs collaboration server（`y-websocket` 独立服务；前端设置 `VITE_COLLAB_WS`）：

   ```bash
   docker compose --profile collab up -d collab
   ```

9. 内置 LaTeX 模板示例见 [deploy/templates/article.tex](deploy/templates/article.tex)，可复制到项目中使用。

## 编译失败排查

- 升级代码后执行 `make migrate`（或 `cd backend && go run ./cmd/migrate`），确保数据库已包含 `compile_jobs.texlive_year` 等迁移。
- **Docker 编译**（`TEXPAD_COMPILE_NATIVE=false`）：本机需可运行 `docker`，且 `TEXPAD_TEXLIVE_IMAGE` / `_2024` / `_2025` 与本地镜像名一致；**在 Docker Compose 里跑后端时**，还需把 **`/var/run/docker.sock`** 挂进后端容器，并为编译任务配置 **与宿主 `docker run` 共享的命名卷**（`TEXPAD_COMPILE_DOCKER_VOLUME` + `TEXPAD_COMPILE_WORKSPACE_DIR`，本仓库 `docker-compose.yml` 已写为 `texpad_compile_workspace` ↔ `/compile-work`）。若缺少该卷，后端在容器内创建的 `/tmp/...` 与宿主 Docker 挂载路径不一致，会导致 **`build.log` 为空**、界面只剩 `docker run 退出码 11` 与泛化摘要。编辑器底部 **「编译日志」** 面板可查看完整 `log_text`，并可 **「复制全文」**。
- 若曾出现 `algorithmic.sty not found` 等缺包错误，多半是用了宿主/容器内**精简 TeX**；请改用本仓库构建的 **`texpad-texlive`（`latest-full`）** 或本机安装 `texlive-full`。
- **大文档或冷启动**可适当提高 `TEXPAD_COMPILE_TIMEOUT_SEC`（默认 600 秒）与 `TEXPAD_COMPILE_DOCKER_MEMORY`（默认 `2048m`），见 [.env.example](.env.example)。

## API

- `POST /api/v1/auth/register`, `POST /api/v1/auth/login`
- `GET /api/v1/projects`, `POST /api/v1/projects`
- Project files under `/api/v1/projects/{id}/files/...`
- `POST /api/v1/projects/{id}/compile`, `GET /api/v1/compile/jobs/{id}`
- PDF（带鉴权，供前端 `fetch` 转 blob）：`GET /api/v1/projects/{id}/pdf/{jobId}/download`
- Agent: `POST /api/v1/projects/{id}/agent/stream` (SSE)
- 分享只读页：`GET /api/v1/share/{token}/project` 与 `GET /api/v1/share/{token}/files/...`

See `backend/internal/httpapi` for routes.

## License

Apache-2.0 (see [LICENSE](LICENSE)).
