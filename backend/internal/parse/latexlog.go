package parse

import (
	"regexp"
	"strconv"
	"strings"
)

var reLaTeXError = regexp.MustCompile(`^! LaTeX Error:.*$`)
var rePackageError = regexp.MustCompile(`^Package \S+ Error:.*$`)
var reLine = regexp.MustCompile(`l\.(\d+)`)

// 整段日志上的兜底（避免 build.log 行尾格式异常时逐行扫描漏掉）
var (
	reFirstBangLine     = regexp.MustCompile(`(?m)^!\s+.+$`)
	reLatexmkMissing    = regexp.MustCompile(`(?m)^Latexmk: Missing input file.*$`)
	reLatexmkIncomplete = regexp.MustCompile(`(?m)^Latexmk: Errors,.*$`)
	reEngineCmdFailed   = regexp.MustCompile(`(?m)^\s*(?:pdflatex|xelatex|lualatex|context): Command for[^\n]+$`)
	reFatalErrorLine    = regexp.MustCompile(`(?m)^Fatal error occurred[^\n]*$`)
)

type LogIssue struct {
	Line    int
	Message string
	Raw     string
}

func lineNumberAfter(lines []string, from int) int {
	for j := from; j < len(lines) && j < from+6; j++ {
		if m := reLine.FindStringSubmatch(strings.TrimRight(lines[j], "\r")); len(m) == 2 {
			if v, err := strconv.Atoi(m[1]); err == nil {
				return v
			}
		}
	}
	return 0
}

// LaTeXIssues extracts human-readable failure lines from latexmk / pdflatex / xelatex log text.
func LaTeXIssues(logText string) []LogIssue {
	lines := strings.Split(logText, "\n")
	var out []LogIssue
	seen := make(map[string]struct{})
	for i := 0; i < len(lines); i++ {
		line := strings.TrimRight(lines[i], "\r")
		trim := strings.TrimSpace(line)
		if trim == "" {
			continue
		}
		var msg string
		switch {
		case reLaTeXError.MatchString(trim):
			msg = trim
		case rePackageError.MatchString(trim):
			msg = trim
		case strings.HasPrefix(trim, "! pdfTeX error"):
			msg = trim
		case strings.HasPrefix(trim, "! "):
			// ! Undefined control sequence、! Emergency stop、! I can't find file 等
			if len(trim) > 400 {
				msg = trim[:400] + "…"
			} else {
				msg = trim
			}
		default:
			continue
		}
		if _, ok := seen[msg]; ok {
			continue
		}
		seen[msg] = struct{}{}
		ln := lineNumberAfter(lines, i+1)
		out = append(out, LogIssue{Line: ln, Message: msg, Raw: line})
	}
	return out
}

// PrimaryCompileError 返回应展示给用户的第一条具体错误；issues 为 LaTeXIssues(logText) 的结果以免重复扫描。
func PrimaryCompileError(logText string, issues []LogIssue) string {
	if len(issues) > 0 {
		return issues[0].Message
	}
	for _, re := range []*regexp.Regexp{
		reFirstBangLine,
		reLatexmkMissing,
		reLatexmkIncomplete,
		reEngineCmdFailed,
		reFatalErrorLine,
	} {
		if m := re.FindString(logText); m != "" {
			s := strings.TrimSpace(m)
			if len(s) > 500 {
				return s[:500] + "…"
			}
			return s
		}
	}
	return ""
}
