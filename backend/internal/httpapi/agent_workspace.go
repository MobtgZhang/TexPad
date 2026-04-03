package httpapi

import (
	"context"
	"fmt"
	"path"
	"strings"

	"github.com/google/uuid"
)

// AgentWorkspacePrefix 是智能体沙箱根目录（项目内相对路径，无前后斜杠）。
const AgentWorkspacePrefix = "workspace"

const agentWorkspaceReadmeTex = `% 智能体工作区（TexPad）
% 请将论文 PDF、笔记、数据说明等文件放在本目录下；智能体可在此目录内读写。
% 主文稿仍在项目根目录（如 main.tex），智能体也可读取 .tex / .bib 以协助排版与引用。
`

// EnsureAgentWorkspace 若不存在则创建 workspace 占位说明文件（幂等）。
func (s *Server) EnsureAgentWorkspace(ctx context.Context, projectID uuid.UUID) error {
	readmePath := AgentWorkspacePrefix + "/README.tex"
	var n int
	err := s.pool.QueryRow(ctx,
		`SELECT COUNT(1) FROM project_files WHERE project_id=$1 AND path=$2`,
		projectID, readmePath).Scan(&n)
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	return s.putTextFile(ctx, projectID, readmePath, agentWorkspaceReadmeTex)
}

// agentSandboxWritePath 允许写入 workspace/ 或项目内 .tex / .bib（与 file_read 范围对齐，便于改主文稿）。
func agentSandboxWritePath(rel string) error {
	if strings.HasPrefix(rel, AgentWorkspacePrefix+"/") {
		return nil
	}
	ext := strings.ToLower(path.Ext(rel))
	if ext == ".tex" || ext == ".bib" {
		return nil
	}
	return fmt.Errorf("file_write 仅允许 %s/ 下文件或项目中的 .tex / .bib", AgentWorkspacePrefix)
}

// agentSandboxReadPath 允许读取 workspace/ 下任意文件；其余路径仅开放 LaTeX 常见源码与插图类型（PDF 附件须在 workspace/）。
func agentSandboxReadPath(rel, mainTexSanitized string) error {
	if strings.HasPrefix(rel, AgentWorkspacePrefix+"/") || rel == AgentWorkspacePrefix {
		return nil
	}
	ext := strings.ToLower(path.Ext(rel))
	switch ext {
	case ".tex", ".bib", ".sty", ".cls", ".bst", ".clo", ".cfg", ".def":
		return nil
	case ".png", ".jpg", ".jpeg", ".svg", ".eps":
		return nil
	}
	if mainTexSanitized != "" && rel == mainTexSanitized {
		return nil
	}
	return fmt.Errorf("file_read：PDF 与其它附件请在 %s/ 下；可先用 workspace_list 列出。LaTeX 源与插图可直接读相对路径。", AgentWorkspacePrefix)
}
