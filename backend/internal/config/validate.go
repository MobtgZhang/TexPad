package config

import (
	"fmt"
	"os"
	"strings"
)

// ValidateCompile 校验 Docker 编译与命名卷配置；避免静默出现空 build.log。
func ValidateCompile(cfg Config) error {
	if cfg.CompileNative {
		return nil
	}
	vol := strings.TrimSpace(cfg.CompileDockerVolume)
	ws := strings.TrimSpace(cfg.CompileWorkspaceDir)
	if vol != "" && ws == "" {
		return fmt.Errorf("TEXPAD_COMPILE_WORKSPACE_DIR is required when TEXPAD_COMPILE_DOCKER_VOLUME is set (see README compile volume table)")
	}
	if vol != "" && ws != "" {
		fi, err := os.Stat(ws)
		if err != nil || !fi.IsDir() {
			return fmt.Errorf("TEXPAD_COMPILE_WORKSPACE_DIR %q must be an existing directory shared with the docker volume", ws)
		}
	}
	if getenvBool("TEXPAD_REQUIRE_COMPILE_VOLUME", false) && vol == "" {
		return fmt.Errorf("TEXPAD_REQUIRE_COMPILE_VOLUME is true but TEXPAD_COMPILE_DOCKER_VOLUME is empty; set both volume name and workspace dir (README)")
	}
	return nil
}
