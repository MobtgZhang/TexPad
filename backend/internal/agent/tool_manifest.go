package agent

// OpenAIToolDefinitions 是唯一工具清单（OpenAI tools 格式）；ExecuteTool 与 prompts 应与此保持一致。
func OpenAIToolDefinitions() []map[string]any {
	return []map[string]any{
		{"type": "function", "function": map[string]any{
			"name": "web_fetch", "description": "HTTP GET a public URL; returns text excerpt.",
			"parameters": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"url": map[string]any{"type": "string"},
				},
				"required": []string{"url"},
			},
		}},
		{"type": "function", "function": map[string]any{
			"name": "web_download", "description": "Download URL body (size-capped) for inspection.",
			"parameters": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"url": map[string]any{"type": "string"},
				},
				"required": []string{"url"},
			},
		}},
		{"type": "function", "function": map[string]any{
			"name": "shell_exec", "description": "Run allowlisted read-only shell commands (kpsewhich, latexmk -version).",
			"parameters": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"command": map[string]any{"type": "string"},
				},
				"required": []string{"command"},
			},
		}},
		{"type": "function", "function": map[string]any{
			"name": "workspace_list", "description": "List files under the project workspace/ sandbox (papers, PDFs, notes). Call this first when the user mentions attachments or papers.",
			"parameters": map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		}},
		{"type": "function", "function": map[string]any{
			"name": "file_read", "description": "Read a project file by relative path. PDFs and general attachments must live under workspace/; .tex/.bib and common image formats may be elsewhere.",
			"parameters": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{"type": "string"},
				},
				"required": []string{"path"},
			},
		}},
		{"type": "function", "function": map[string]any{
			"name": "file_write", "description": "Stage a new version of a text file for user review (workspace/ or .tex/.bib). The editor shows before/after; nothing is saved until the user accepts.",
			"parameters": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path":    map[string]any{"type": "string"},
					"content": map[string]any{"type": "string"},
				},
				"required": []string{"path", "content"},
			},
		}},
		{"type": "function", "function": map[string]any{
			"name": "latex_compile_run", "description": "Enqueue a LaTeX compile for this project (same as the editor compile button). Returns job_id; poll latex_compile_job until success or failed.",
			"parameters": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"engine":        map[string]any{"type": "string", "description": "pdflatex | xelatex | lualatex | context"},
					"draft_mode":    map[string]any{"type": "boolean"},
					"halt_on_error": map[string]any{"type": "boolean"},
					"clean_build":   map[string]any{"type": "boolean"},
					"syntax_check":  map[string]any{"type": "boolean"},
					"texlive_year":  map[string]any{"type": "string", "description": "2024 or 2025"},
				},
			},
		}},
		{"type": "function", "function": map[string]any{
			"name": "latex_compile_job", "description": "Get compile job status and log excerpt for this project. Omit job_id to use the latest job. Use after latex_compile_run to debug errors.",
			"parameters": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"job_id": map[string]any{"type": "string", "description": "UUID from latex_compile_run; empty = latest job"},
				},
			},
		}},
		{"type": "function", "function": map[string]any{
			"name": "task_plan", "description": "Record a planning step for the session.",
			"parameters": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"step": map[string]any{"type": "string"},
				},
				"required": []string{"step"},
			},
		}},
		{"type": "function", "function": map[string]any{
			"name": "task_summary", "description": "Record a short progress summary.",
			"parameters": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"text": map[string]any{"type": "string"},
				},
				"required": []string{"text"},
			},
		}},
	}
}

// KnownAgentToolNames 与 OpenAIToolDefinitions 中的 name 一致，供校验与文档生成。
func KnownAgentToolNames() []string {
	defs := OpenAIToolDefinitions()
	out := make([]string, 0, len(defs))
	for _, d := range defs {
		fn, _ := d["function"].(map[string]any)
		if fn == nil {
			continue
		}
		n, _ := fn["name"].(string)
		if n != "" {
			out = append(out, n)
		}
	}
	return out
}
