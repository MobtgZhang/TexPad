# 工具使用说明（嵌入，不对最终用户展示）

模型应通过 **OpenAI 兼容 API 的 function calling** 发起工具调用。可用工具名称：

| 工具 | 用途 |
|------|------|
| `web_fetch` | GET 公开 URL，返回正文截断（HTML 会剥离标签摘要） |
| `web_download` | 下载 URL 到服务端临时区，返回大小与类型摘要 |
| `shell_exec` | 白名单命令（如 `kpsewhich`、`latexmk -version`） |
| `file_read` | 读取项目内相对路径文件 |
| `file_write` | 写入/覆盖项目内文本文件 |
| `task_plan` | 记录任务计划步骤（进入 L0/L2 摘要链） |
| `task_summary` | 记录阶段小结 |

完成工具链后，用自然语言向用户作答，并使用 Markdown 排版。
