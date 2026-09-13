package migrations

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadRequiresStrictPairedNames(t *testing.T) {
	dir := t.TempDir()
	writeMigrationFile(t, dir, "000001-init.up.sql", "SELECT 1")
	writeMigrationFile(t, dir, "000001-init.down.sql", "SELECT 1")
	_, err := (&Runner{dir: dir}).load()
	if err == nil {
		t.Fatal("expected invalid migration name to fail")
	}
}

func TestLoadRequiresDownPair(t *testing.T) {
	dir := t.TempDir()
	writeMigrationFile(t, dir, "000001_init.up.sql", "SELECT 1")
	_, err := (&Runner{dir: dir}).load()
	if err == nil {
		t.Fatal("expected missing down migration to fail")
	}
}

func TestLoadHashesBothDirections(t *testing.T) {
	dir := t.TempDir()
	writeMigrationFile(t, dir, "000001_init.up.sql", "SELECT 1")
	writeMigrationFile(t, dir, "000001_init.down.sql", "SELECT 2")
	loaded, err := (&Runner{dir: dir}).load()
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded) != 1 || loaded[0].checksum == loaded[0].downChecksum {
		t.Fatalf("unexpected migration hashes: %#v", loaded)
	}
}

func TestRequireDownConfirmation(t *testing.T) {
	if err := RequireDownConfirmation(func(string) string { return "" }); err == nil {
		t.Fatal("expected unconfirmed down to fail")
	}
	if err := RequireDownConfirmation(func(string) string { return "yes" }); err == nil {
		t.Fatal("expected wrong confirmation to fail")
	}
	if err := RequireDownConfirmation(func(name string) string {
		if name != DownConfirmEnv {
			t.Fatalf("lookup %q", name)
		}
		return DownConfirmValue
	}); err != nil {
		t.Fatal(err)
	}
}

func TestRequireDownConfirmationMessage(t *testing.T) {
	err := RequireDownConfirmation(func(string) string { return "" })
	if err == nil || !strings.Contains(err.Error(), DownConfirmEnv) {
		t.Fatalf("error = %v", err)
	}
}

func writeMigrationFile(t *testing.T, dir, name, contents string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
}
