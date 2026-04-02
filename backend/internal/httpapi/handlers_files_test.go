package httpapi

import "testing"

func TestSanitizeRelPath(t *testing.T) {
	tests := []struct {
		in   string
		ok   bool
		want string
	}{
		{"main.tex", true, "main.tex"},
		{"foo/bar.tex", true, "foo/bar.tex"},
		{"/foo/bar.tex", true, "foo/bar.tex"},
		{"../x", false, ""},
		{"foo/../x", false, ""},
		{"", false, ""},
		{"..", false, ""},
	}
	for _, tc := range tests {
		got, ok := sanitizeRelPath(tc.in)
		if ok != tc.ok || (tc.ok && got != tc.want) {
			t.Errorf("sanitizeRelPath(%q) = (%q, %v), want (%q, %v)", tc.in, got, ok, tc.want, tc.ok)
		}
	}
}
