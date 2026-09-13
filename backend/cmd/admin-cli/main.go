package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/operations"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/config"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/postgres"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
)

const (
	usage = "usage: admin-cli employee <create|set-role|disable|revoke-sessions> --email EMAIL [--name NAME --role ROLE --password-stdin --actor EMAIL]\n" +
		"       admin-cli prune [--audit-before DATE] [--operations-before DATE] [--sessions-before DATE] [--confirm]"
	minPasswordLength = 8
)

const pruneUsage = `usage: admin-cli prune [--audit-before DATE] [--operations-before DATE] [--sessions-before DATE] [--confirm]

Prunes admin DB tables past their retention policy. Dry run by default:
prints matched row counts and deletes nothing. Deletion happens only with
--confirm. Dates are RFC 3339 or YYYY-MM-DD (UTC midnight); at least one
date is required, tables without a date are skipped.

Retention policy:
  admin_audit_log  365 days  employee, access and command audit history
  operations       180 days  terminal operations only (succeeded, failed,
                             partial, unknown_outcome)
  sessions          30 days  expired or revoked sessions

Intended to run from an external cron with explicit dates in the past`

const (
	auditRetentionPolicy      = "365d"
	operationsRetentionPolicy = "180d"
	sessionsRetentionPolicy   = "30d"
)

var errUsage = errors.New(usage)

var errPruneUsage = errors.New(pruneUsage)

type command struct {
	Action        string
	Email         string
	Name          string
	Role          string
	Actor         string
	PasswordStdin bool
	Password      []byte
}

type pruneCommand struct {
	AuditBefore      *time.Time
	OperationsBefore *time.Time
	SessionsBefore   *time.Time
	Confirm          bool
}

func main() {
	if err := run(os.Args[1:], os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string, input io.Reader, output io.Writer) error {
	employee, prune, err := parseArgs(args, input)
	if err != nil {
		return err
	}
	if employee != nil {
		defer clear(employee.Password)
	}

	cfg, err := config.LoadCLI()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), cfg.DatabaseTimeout)
	defer cancel()
	pool, err := postgres.Open(ctx, cfg.DatabaseURL, "admin-cli", 1)
	if err != nil {
		return errors.New("connect admin database failed")
	}
	defer pool.Close()

	audits := audit.NewStore(pool, cfg.DatabaseTimeout)
	sessions := auth.NewService(pool, cfg.DatabaseTimeout, 12*time.Hour, 2*time.Hour, false)
	if prune != nil {
		operationsStore := operations.NewStore(pool, cfg.DatabaseTimeout, audits)
		return executePrune(ctx, *prune, audits, operationsStore, sessions, output)
	}
	store := employees.NewStore(pool, cfg.DatabaseTimeout)
	return execute(ctx, *employee, store, sessions, audits, output)
}

func parseArgs(args []string, input io.Reader) (*command, *pruneCommand, error) {
	if len(args) > 0 && args[0] == "prune" {
		parsed, err := parsePrune(args[1:])
		if err != nil {
			return nil, nil, err
		}
		return nil, &parsed, nil
	}
	parsed, err := parseCommand(args, input)
	if err != nil {
		return nil, nil, err
	}
	return &parsed, nil, nil
}

func execute(
	ctx context.Context,
	cmd command,
	store *employees.Store,
	sessions *auth.Service,
	audits *audit.Store,
	output io.Writer,
) error {
	switch cmd.Action {
	case "create":
		hash, err := auth.Hash(string(cmd.Password))
		if err != nil {
			return err
		}
		emp, err := store.Create(ctx, employees.CreateInput{
			Email: cmd.Email, Name: cmd.Name, Role: cmd.Role, PasswordHash: hash,
		})
		if err != nil {
			if errors.Is(err, employees.ErrConflict) {
				return errors.New("employee already exists")
			}
			return err
		}
		actorID, actorEmail := resolveActor(ctx, store, cmd.Actor, emp)
		if err := audits.Record(ctx, audit.Event{
			EmployeeID: actorID,
			ActorEmail: actorEmail,
			Action:     audit.ActionEmployeeCreate,
			ObjectType: "employee",
			ObjectRef:  "employee:" + emp.ID.String(),
			Metadata:   map[string]any{"email": emp.Email, "role": emp.Role, "source": "cli"},
		}); err != nil {
			return err
		}
		return json.NewEncoder(output).Encode(map[string]any{
			"id": emp.ID.String(), "email": emp.Email, "name": emp.Name, "role": emp.Role, "status": emp.Status,
		})
	case "set-role":
		emp, err := store.GetByEmail(ctx, cmd.Email)
		if err != nil {
			return err
		}
		updated, _, _, err := store.Update(ctx, emp.ID, employees.UpdateInput{Role: &cmd.Role})
		if err != nil {
			return err
		}
		if err := sessions.RevokeAll(ctx, updated.ID, auth.ReasonRoleChange); err != nil {
			return err
		}
		actorID, actorEmail := resolveActor(ctx, store, cmd.Actor, updated)
		if err := audits.Record(ctx, audit.Event{
			EmployeeID: actorID,
			ActorEmail: actorEmail,
			Action:     audit.ActionEmployeeUpdate,
			ObjectType: "employee",
			ObjectRef:  "employee:" + updated.ID.String(),
			Metadata: map[string]any{
				"changed": []string{"role"},
				"from":    map[string]any{"role": emp.Role},
				"to":      map[string]any{"role": updated.Role},
				"source":  "cli",
			},
		}); err != nil {
			return err
		}
		return json.NewEncoder(output).Encode(map[string]any{
			"id": updated.ID.String(), "email": updated.Email, "role": updated.Role, "status": updated.Status,
		})
	case "disable":
		emp, err := store.GetByEmail(ctx, cmd.Email)
		if err != nil {
			return err
		}
		status := auth.StatusDisabled
		updated, _, _, err := store.Update(ctx, emp.ID, employees.UpdateInput{Status: &status})
		if err != nil {
			return err
		}
		if err := sessions.RevokeAll(ctx, updated.ID, auth.ReasonDisabled); err != nil {
			return err
		}
		actorID, actorEmail := resolveActor(ctx, store, cmd.Actor, updated)
		if err := audits.Record(ctx, audit.Event{
			EmployeeID: actorID,
			ActorEmail: actorEmail,
			Action:     audit.ActionEmployeeDisable,
			ObjectType: "employee",
			ObjectRef:  "employee:" + updated.ID.String(),
			Metadata:   map[string]any{"changed": []string{"status"}, "source": "cli"},
		}); err != nil {
			return err
		}
		return json.NewEncoder(output).Encode(map[string]any{
			"id": updated.ID.String(), "email": updated.Email, "status": updated.Status,
		})
	case "revoke-sessions":
		emp, err := store.GetByEmail(ctx, cmd.Email)
		if err != nil {
			return err
		}
		if err := sessions.RevokeAll(ctx, emp.ID, auth.ReasonAdmin); err != nil {
			return err
		}
		actorID, actorEmail := resolveActor(ctx, store, cmd.Actor, emp)
		if err := audits.Record(ctx, audit.Event{
			EmployeeID: actorID,
			ActorEmail: actorEmail,
			Action:     audit.ActionSessionsRevoke,
			ObjectType: "employee",
			ObjectRef:  "employee:" + emp.ID.String(),
			Metadata:   map[string]any{"source": "cli"},
		}); err != nil {
			return err
		}
		return json.NewEncoder(output).Encode(map[string]any{"ok": true, "email": emp.Email})
	default:
		return errUsage
	}
}

func parseCommand(args []string, input io.Reader) (command, error) {
	var cmd command
	for _, arg := range args {
		if strings.HasPrefix(arg, "--password") && arg != "--password-stdin" && !strings.HasPrefix(arg, "--password-stdin=") {
			return command{}, errors.New("password flags are not allowed; use --password-stdin")
		}
	}
	if len(args) < 2 || args[0] != "employee" {
		return command{}, errUsage
	}
	cmd.Action = args[1]
	flags := flag.NewFlagSet("admin-cli", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&cmd.Email, "email", "", "")
	flags.StringVar(&cmd.Name, "name", "", "")
	flags.StringVar(&cmd.Role, "role", "", "")
	flags.StringVar(&cmd.Actor, "actor", "", "")
	flags.BoolVar(&cmd.PasswordStdin, "password-stdin", false, "")
	if err := flags.Parse(args[2:]); err != nil || flags.NArg() != 0 {
		return command{}, errUsage
	}
	cmd.Email = auth.NormalizeEmail(cmd.Email)
	cmd.Name = strings.TrimSpace(cmd.Name)
	cmd.Actor = auth.NormalizeEmail(cmd.Actor)
	if cmd.Email == "" {
		return command{}, errors.New("email is required")
	}
	switch cmd.Action {
	case "create":
		if cmd.Name == "" || !rbac.ValidRole(cmd.Role) || !cmd.PasswordStdin {
			return command{}, errors.New("create requires --email --name --role --password-stdin")
		}
		raw, err := io.ReadAll(io.LimitReader(input, 4096))
		if err != nil {
			return command{}, errors.New("read password failed")
		}
		raw = trimLineEnding(raw)
		if utf8.RuneCount(raw) < minPasswordLength {
			clear(raw)
			return command{}, errors.New("password must be at least 8 characters")
		}
		cmd.Password = raw
	case "set-role":
		if !rbac.ValidRole(cmd.Role) || cmd.PasswordStdin {
			return command{}, errors.New("set-role requires --email --role")
		}
	case "disable", "revoke-sessions":
		if cmd.PasswordStdin || cmd.Role != "" {
			return command{}, errUsage
		}
	default:
		return command{}, errUsage
	}
	return cmd, nil
}

func parsePrune(args []string) (pruneCommand, error) {
	var (
		cmd     pruneCommand
		auditAt string
		opsAt   string
		sessAt  string
	)
	flags := flag.NewFlagSet("admin-cli prune", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&auditAt, "audit-before", "", "")
	flags.StringVar(&opsAt, "operations-before", "", "")
	flags.StringVar(&sessAt, "sessions-before", "", "")
	flags.BoolVar(&cmd.Confirm, "confirm", false, "")
	if err := flags.Parse(args); err != nil || flags.NArg() != 0 {
		return pruneCommand{}, errPruneUsage
	}
	var err error
	if cmd.AuditBefore, err = parseRetentionCutoff("--audit-before", auditAt); err != nil {
		return pruneCommand{}, err
	}
	if cmd.OperationsBefore, err = parseRetentionCutoff("--operations-before", opsAt); err != nil {
		return pruneCommand{}, err
	}
	if cmd.SessionsBefore, err = parseRetentionCutoff("--sessions-before", sessAt); err != nil {
		return pruneCommand{}, err
	}
	if cmd.AuditBefore == nil && cmd.OperationsBefore == nil && cmd.SessionsBefore == nil {
		return pruneCommand{}, errPruneUsage
	}
	return cmd, nil
}

func parseRetentionCutoff(flagName, raw string) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	for _, layout := range []string{"2006-01-02", time.RFC3339} {
		parsed, err := time.Parse(layout, raw)
		if err != nil {
			continue
		}
		utc := parsed.UTC()
		return &utc, nil
	}
	return nil, fmt.Errorf("%s must be RFC 3339 or YYYY-MM-DD: %q", flagName, raw)
}

type pruneLine struct {
	Table   string `json:"table"`
	Policy  string `json:"policy"`
	Before  string `json:"before"`
	Mode    string `json:"mode"`
	Matched *int64 `json:"matched,omitempty"`
	Deleted *int64 `json:"deleted,omitempty"`
}

func executePrune(
	ctx context.Context,
	cmd pruneCommand,
	audits *audit.Store,
	operationsStore *operations.Store,
	sessions *auth.Service,
	output io.Writer,
) error {
	mode := "dry-run"
	if cmd.Confirm {
		mode = "delete"
	}
	encoder := json.NewEncoder(output)
	targets := []struct {
		table  string
		policy string
		before *time.Time
		prune  func(context.Context, time.Time) (int64, error)
		count  func(context.Context, time.Time) (int64, error)
	}{
		{"admin_audit_log", auditRetentionPolicy, cmd.AuditBefore, audits.PruneBefore, audits.CountBefore},
		{"operations", operationsRetentionPolicy, cmd.OperationsBefore, operationsStore.PruneTerminalBefore, operationsStore.CountTerminalBefore},
		{"sessions", sessionsRetentionPolicy, cmd.SessionsBefore, sessions.PruneExpiredBefore, sessions.CountExpiredBefore},
	}
	for _, target := range targets {
		if target.before == nil {
			continue
		}
		line := pruneLine{
			Table:  target.table,
			Policy: target.policy,
			Before: target.before.UTC().Format(time.RFC3339),
			Mode:   mode,
		}
		var err error
		var count int64
		if cmd.Confirm {
			count, err = target.prune(ctx, *target.before)
			line.Deleted = &count
		} else {
			count, err = target.count(ctx, *target.before)
			line.Matched = &count
		}
		if err != nil {
			return err
		}
		if err := encoder.Encode(line); err != nil {
			return fmt.Errorf("write prune result: %w", err)
		}
	}
	return nil
}

func resolveActor(ctx context.Context, store *employees.Store, actorEmail string, fallback employees.Employee) (*uuid.UUID, string) {
	if actorEmail != "" {
		if actor, err := store.GetByEmail(ctx, actorEmail); err == nil {
			id := actor.ID
			return &id, actor.Email
		}
		return nil, actorEmail
	}
	id := fallback.ID
	return &id, fallback.Email
}

func trimLineEnding(raw []byte) []byte {
	if len(raw) > 0 && raw[len(raw)-1] == '\n' {
		raw = raw[:len(raw)-1]
		if len(raw) > 0 && raw[len(raw)-1] == '\r' {
			raw = raw[:len(raw)-1]
		}
	}
	return raw
}

func clear(buf []byte) {
	for i := range buf {
		buf[i] = 0
	}
}
