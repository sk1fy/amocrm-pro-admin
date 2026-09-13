package main

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestParseCreateRequiresPasswordStdin(t *testing.T) {
	_, err := parseCommand([]string{
		"employee", "create",
		"--email", "admin@example.invalid",
		"--name", "Admin",
		"--role", "admin",
		"--password", "secret-value",
	}, bytes.NewReader(nil))
	if err == nil || !strings.Contains(err.Error(), "password flags are not allowed") {
		t.Fatalf("error = %v", err)
	}
}

func TestParseCreateReadsPassword(t *testing.T) {
	cmd, err := parseCommand([]string{
		"employee", "create",
		"--email", "Admin@example.invalid",
		"--name", "Admin",
		"--role", "admin",
		"--password-stdin",
	}, bytes.NewReader([]byte("strong-pass\n")))
	if err != nil {
		t.Fatal(err)
	}
	if cmd.Email != "admin@example.invalid" || string(cmd.Password) != "strong-pass" {
		t.Fatalf("%+v", cmd)
	}
}

func TestParseSetRole(t *testing.T) {
	cmd, err := parseCommand([]string{
		"employee", "set-role",
		"--email", "ops@example.invalid",
		"--role", "operator",
	}, bytes.NewReader(nil))
	if err != nil {
		t.Fatal(err)
	}
	if cmd.Action != "set-role" || cmd.Role != "operator" {
		t.Fatalf("%+v", cmd)
	}
}

func TestParsePruneCutoffs(t *testing.T) {
	cmd, err := parsePrune([]string{
		"--audit-before", "2025-01-02",
		"--operations-before", "2025-03-04T05:06:07+03:00",
		"--confirm",
	})
	if err != nil {
		t.Fatal(err)
	}
	if cmd.Confirm != true || cmd.SessionsBefore != nil {
		t.Fatalf("%+v", cmd)
	}
	if got := cmd.AuditBefore.UTC().Format(time.RFC3339); got != "2025-01-02T00:00:00Z" {
		t.Fatalf("audit before = %s", got)
	}
	if got := cmd.OperationsBefore.UTC().Format(time.RFC3339); got != "2025-03-04T02:06:07Z" {
		t.Fatalf("operations before = %s", got)
	}
}

func TestParsePruneRequiresAtLeastOneCutoff(t *testing.T) {
	if _, err := parsePrune(nil); !errors.Is(err, errPruneUsage) {
		t.Fatalf("error = %v", err)
	}
	if _, err := parsePrune([]string{"--confirm"}); !errors.Is(err, errPruneUsage) {
		t.Fatalf("error = %v", err)
	}
}

func TestParsePruneRejectsInvalidDate(t *testing.T) {
	_, err := parsePrune([]string{"--sessions-before", "yesterday"})
	if err == nil || !strings.Contains(err.Error(), "--sessions-before must be RFC 3339 or YYYY-MM-DD") {
		t.Fatalf("error = %v", err)
	}
}
