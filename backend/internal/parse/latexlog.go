package parse

import (
	"regexp"
	"strconv"
	"strings"
)

var reLaTeXError = regexp.MustCompile(`^! LaTeX Error:.*$`)
var reLine = regexp.MustCompile(`l\.(\d+)`)

type LogIssue struct {
	Line    int
	Message string
	Raw     string
}

func LaTeXIssues(logText string) []LogIssue {
	lines := strings.Split(logText, "\n")
	var out []LogIssue
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		if reLaTeXError.MatchString(line) {
			msg := strings.TrimSpace(line)
			ln := 0
			if i+1 < len(lines) {
				if m := reLine.FindStringSubmatch(lines[i+1]); len(m) == 2 {
					if v, err := strconv.Atoi(m[1]); err == nil {
						ln = v
					}
				}
			}
			out = append(out, LogIssue{Line: ln, Message: msg, Raw: line})
		}
	}
	return out
}
