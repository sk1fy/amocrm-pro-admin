package main

import (
	"bytes"
	"strings"
	"testing"
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
