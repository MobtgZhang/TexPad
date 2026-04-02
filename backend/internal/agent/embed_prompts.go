package agent

import "embed"

//go:embed prompts/*.md
var promptsFS embed.FS

func loadPrompt(name string) string {
	b, err := promptsFS.ReadFile("prompts/" + name)
	if err != nil {
		return ""
	}
	return string(b)
}
