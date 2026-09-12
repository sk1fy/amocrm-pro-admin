package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/platform/config"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/migrations"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/postgres"
)

var errUsage = errors.New("invalid migration command")

func main() {
	command, err := migrationCommand(os.Args[1:], os.Getenv)
	if errors.Is(err, errUsage) {
		fmt.Fprintln(os.Stderr, "usage: admin-migrate [up|down]")
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	cfg, err := config.LoadMigrate()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), cfg.Timeout)
	defer cancel()

	pool, err := postgres.Open(ctx, cfg.DatabaseURL, "admin-migrate", 1)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer pool.Close()

	started := time.Now()
	runner := migrations.New(pool, cfg.MigrationsDir)
	if command == "down" {
		err = runner.Down(ctx)
	} else {
		err = runner.Up(ctx)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("migrations %s completed in %s\n", command, time.Since(started).Round(time.Millisecond))
}

func migrationCommand(arguments []string, getenv func(string) string) (string, error) {
	command := "up"
	if len(arguments) == 1 {
		command = arguments[0]
	}
	if len(arguments) > 1 || (command != "up" && command != "down") {
		return "", errUsage
	}
	if command == "down" {
		if err := migrations.RequireDownConfirmation(getenv); err != nil {
			return "", err
		}
	}
	return command, nil
}
