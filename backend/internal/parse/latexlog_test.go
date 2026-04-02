package parse

import "testing"

func TestPrimaryCompileError_fallbackBang(t *testing.T) {
	log := "some noise\n! LaTeX Error: File `x.sty' not found.\n"
	issues := LaTeXIssues(log)
	if got := PrimaryCompileError(log, issues); got != "! LaTeX Error: File `x.sty' not found." {
		t.Fatalf("got %q", got)
	}
}

func TestPrimaryCompileError_fallbackRegex(t *testing.T) {
	// 逐行规则未覆盖时，整段里仍有 latexmk 摘要
	log := "foo\nLatexmk: Missing input file 'algorithmic.sty' (or dependence on it) from following:\n"
	issues := LaTeXIssues(log)
	if len(issues) != 0 {
		t.Fatalf("expected line parser to miss, got %d issues", len(issues))
	}
	got := PrimaryCompileError(log, issues)
	if got == "" || len(got) < 20 {
		t.Fatalf("expected missing file line, got %q", got)
	}
}
