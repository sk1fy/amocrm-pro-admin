package rbac

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestMatrixMatchesRolesMarkdown(t *testing.T) {
	body, err := os.ReadFile(rolesMarkdownPath(t))
	if err != nil {
		t.Fatal(err)
	}
	row := regexp.MustCompile(`^\| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|`)
	permRe := regexp.MustCompile("`([^`]+)`")
	seen := map[string]bool{}
	for _, line := range strings.Split(string(body), "\n") {
		matches := row.FindStringSubmatch(strings.TrimSpace(line))
		if len(matches) != 5 || !strings.Contains(matches[1], "`") {
			continue
		}
		want := map[string]bool{
			RoleViewer:   isGranted(matches[2]),
			RoleOperator: isGranted(matches[3]),
			RoleAdmin:    isGranted(matches[4]),
		}
		for _, permMatch := range permRe.FindAllStringSubmatch(matches[1], -1) {
			permission := strings.TrimSpace(permMatch[1])
			if !strings.Contains(permission, ":") {
				continue
			}
			seen[permission] = true
			for role, granted := range want {
				if Allows(role, permission) != granted {
					t.Errorf("%s %s: code=%t markdown=%t", role, permission, Allows(role, permission), granted)
				}
			}
		}
	}
	if len(seen) != len(AllPermissions) {
		t.Fatalf("markdown permissions = %d, code = %d", len(seen), len(AllPermissions))
	}
	for _, permission := range AllPermissions {
		if !seen[permission] {
			t.Errorf("permission %s missing from roles.md", permission)
		}
	}
}

func TestViewerHasNoEmployeePermissions(t *testing.T) {
	if Allows(RoleViewer, EmployeesRead) || Allows(RoleViewer, EmployeesWrite) {
		t.Fatal("viewer must not have employees permissions")
	}
}

func rolesMarkdownPath(t *testing.T) string {
	t.Helper()
	candidates := []string{
		"/docs/design/roles.md",
		"../../docs/design/roles.md",
		"../../../docs/design/roles.md",
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	t.Fatal("roles.md not found")
	return ""
}

func isGranted(cell string) bool {
	return strings.Contains(cell, "✓")
}
