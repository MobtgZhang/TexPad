package agent

import (
	"context"
	"regexp"
	"strings"
)

var reCite = regexp.MustCompile(`\\cite[t\*]?\{([^}]+)\}`)

// CitationSanityCheck returns warnings for \cite{keys} not found in project .bib content.
func CitationSanityCheck(ctx context.Context, answer string, readBib func(context.Context) ([]byte, error)) string {
	if readBib == nil {
		return ""
	}
	matches := reCite.FindAllStringSubmatch(answer, -1)
	if len(matches) == 0 {
		return ""
	}
	keys := map[string]bool{}
	for _, m := range matches {
		for _, k := range strings.Split(m[1], ",") {
			k = strings.TrimSpace(k)
			if k != "" {
				keys[k] = true
			}
		}
	}
	if len(keys) == 0 {
		return ""
	}
	bib, err := readBib(ctx)
	if err != nil || len(bib) == 0 {
		return ""
	}
	bibS := string(bib)
	var missing []string
	for k := range keys {
		// @article{key, or @inproceedings{key,
		if !regexp.MustCompile(`@[a-zA-Z]+\s*\{\s*` + regexp.QuoteMeta(k) + `\s*[,]`).MatchString(bibS) {
			missing = append(missing, k)
		}
	}
	if len(missing) == 0 {
		return ""
	}
	return "自检：以下 \\cite 键在检索到的 .bib 条目中未找到，请核对是否幻觉或未保存文件：" + strings.Join(missing, ", ")
}
