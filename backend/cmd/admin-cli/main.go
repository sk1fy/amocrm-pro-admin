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
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/config"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/postgres"
	"github.com/sk1fy/amocrm-pro-admin/internal/rbac"
)

const (
	usage             = "usage: admin-cli employee <create|set-role|disable|revoke-sessions> --email EMAIL [--name NAME --role ROLE --password-stdin --actor EMAIL]"
	minPasswordLength = 8
)

var errUsage = errors.New(usage)

type command struct {
	Action        string
	Email         string
	Name          string
	Role          string
	Actor         string
	PasswordStdin bool
	Password      []byte
}

func main() {
	if err := run(os.Args[1:], os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string, input io.Reader, output io.Writer) error {
	cmd, err := parseCommand(args, input)
	if err != nil {
		return err
	}
	defer clear(cmd.Password)

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

	store := employees.NewStore(pool, cfg.DatabaseTimeout)
	sessions := auth.NewService(pool, cfg.DatabaseTimeout, 12*time.Hour, 2*time.Hour, false)
	audits := audit.NewStore(pool, cfg.DatabaseTimeout)
	return execute(ctx, cmd, store, sessions, audits, output)
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
