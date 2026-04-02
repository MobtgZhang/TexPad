# 仅复制 docker 客户端，供容器内 `docker run … texpad-texlive` 调用宿主引擎（compose 挂载 /var/run/docker.sock）
FROM docker:27-cli AS dockercli

FROM golang:1.22-bookworm AS build
WORKDIR /src
# 默认走公共镜像，避免 Docker 构建内访问 proxy.golang.org（Google）超时；可用 --build-arg 覆盖
ARG GOPROXY=https://goproxy.io,https://goproxy.cn,https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.google.cn
ENV GOPROXY=${GOPROXY}
ENV GOSUMDB=${GOSUMDB}
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -o /out/texpad-server ./cmd/server/ \
  && CGO_ENABLED=0 go build -o /out/texpad-migrate ./cmd/migrate/

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
# 部分运行时 PATH 不含 /usr/local/bin；/usr/bin 几乎总在 PATH 中
RUN cp /usr/local/bin/docker /usr/bin/docker && chmod +x /usr/bin/docker /usr/local/bin/docker
COPY --from=build /out/texpad-server /usr/local/bin/texpad-server
COPY --from=build /out/texpad-migrate /usr/local/bin/texpad-migrate
COPY deploy/backend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENV TEXPAD_HTTP_ADDR=:8080
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=12 \
  CMD wget -qO- http://127.0.0.1:8080/healthz | grep -q ok
ENTRYPOINT ["/docker-entrypoint.sh"]
