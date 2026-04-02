# TeX Live「full」方案：与 Island of TeX 上游一致，含几乎全部 CTAN 宏包（含 algorithms / algorithmic、会议稿模板等）。
# 上游说明：https://gitlab.com/islandoftex/images/texlive（scheme `full` ≈ 完整安装，无文档树以减小体积）
# 构建参数 TEX_SCHEME：
#   - latest-full：当前 TeX Live 周构建（推荐本地开发）
#   - TL2024-historic 等：锁定历史发行版（见上游 Registry）
ARG TEX_SCHEME=latest-full
FROM registry.gitlab.com/islandoftex/images/texlive:${TEX_SCHEME}

WORKDIR /work
ENV PATH="/usr/local/bin:/usr/bin:${PATH}"

RUN latexmk -v
