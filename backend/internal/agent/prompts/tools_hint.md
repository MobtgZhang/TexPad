# 工具使用说明（嵌入，不对最终用户展示）

**单一事实来源**：工具名与 JSON Schema 定义在 `agent/tool_manifest.go` 的 `OpenAIToolDefinitions`；增删工具或改参数时请同步更新本文件表格。

模型应通过 **OpenAI 兼容 API 的 function calling** 发起工具调用。可用工具名称：

| 工具 | 用途 |
|------|------|
| `workspace_list` | 列出 `workspace/` 沙箱内文件（论文 PDF 等）；查找附件时**优先**调用 |
| `web_fetch` | GET 公开 URL，返回正文截断（HTML 会剥离标签摘要） |
| `web_download` | 下载 URL 到服务端临时区，返回大小与类型摘要 |
| `shell_exec` | 白名单命令（如 `kpsewhich`、`latexmk -version`） |
| `file_read` | 读取相对路径：`workspace/` 下任意类型；其它路径仅限 LaTeX 相关扩展（如 `.tex`、`.bib`、常见插图格式） |
| `file_write` | 暂存修改草稿（`workspace/` 或 `.tex`/`.bib`）；编辑器内 Agent 须用户「接受」后落盘；**Paperclaw 异步任务**在流水线结束时由 `BeforeStreamDone` 自动写入对象存储 |
| `latex_compile_run` | 为本项目**入队**一次 LaTeX 编译（与编辑器编译一致），返回 `job_id`；受每日编译额度限制 |
| `latex_compile_job` | 查询编译任务：`job_id` 为空则取**最近一条**；返回 `status`、`pdf_ready` 与截断后的 `log`/`error` |
| `task_plan` | 记录任务计划步骤（进入 L0/L2 摘要链） |
| `task_summary` | 记录阶段小结 |

完成工具链后，用自然语言向用户作答，并使用 Markdown 排版。
