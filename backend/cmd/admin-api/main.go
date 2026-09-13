package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/sk1fy/amocrm-pro-admin/internal/accounts"
	"github.com/sk1fy/amocrm-pro-admin/internal/audit"
	"github.com/sk1fy/amocrm-pro-admin/internal/auth"
	"github.com/sk1fy/amocrm-pro-admin/internal/catalog"
	"github.com/sk1fy/amocrm-pro-admin/internal/employees"
	"github.com/sk1fy/amocrm-pro-admin/internal/httpapi"
	"github.com/sk1fy/amocrm-pro-admin/internal/operations"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/config"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/logging"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/migrations"
	"github.com/sk1fy/amocrm-pro-admin/internal/platform/postgres"
	"github.com/sk1fy/amocrm-pro-admin/internal/transport/httpserver"
)

func main() {
	if err := run(); err != nil {
		slog.Error("admin-api stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.LoadAPI()
	if err != nil {
		return err
	}
	logger := logging.New(cfg.ServiceName, cfg.Environment, cfg.LogLevel)
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	databaseContext, cancel := context.WithTimeout(ctx, cfg.DatabaseTimeout)
	pool, err := postgres.Open(databaseContext, cfg.DatabaseURL, cfg.ServiceName, cfg.DBMaxConns)
	cancel()
	if err != nil {
		return err
	}
	defer pool.Close()

	schemaContext, schemaCancel := context.WithTimeout(ctx, cfg.DatabaseTimeout)
	err = migrations.New(pool, cfg.MigrationsDir).EnsureCurrent(schemaContext)
	schemaCancel()
	if err != nil {
		return err
	}

	employeeStore := employees.NewStore(pool, cfg.DatabaseTimeout)
	sessionService := auth.NewService(pool, cfg.DatabaseTimeout, cfg.SessionAbsoluteTTL, cfg.SessionIdleTTL, cfg.CookieSecure)
	auditStore := audit.NewStore(pool, cfg.DatabaseTimeout)
	limiter := auth.NewLimiter(cfg.LoginRatePerMinute)

	if cfg.BackendsFile == "" {
		return fmt.Errorf("BACKENDS_FILE is required")
	}
	registry, err := catalog.Load(cfg.BackendsFile, catalog.Options{})
	if err != nil {
		return err
	}
	accountService := accounts.New(registry.Backends(), auditStore)
	operationService := operations.New(operations.NewStore(pool, cfg.DatabaseTimeout, auditStore), registry, employeeStore)
	reconcileCtx, stopReconcile := context.WithCancel(ctx)
	reconcileDone := make(chan struct{})
	go func() { defer close(reconcileDone); operationService.Reconcile(reconcileCtx) }()
	defer func() { stopReconcile(); <-reconcileDone }()

	cleanupContext, stopCleanup := context.WithCancel(ctx)
	cleanupDone := make(chan struct{})
	go func() {
		defer close(cleanupDone)
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-cleanupContext.Done():
				return
			case <-ticker.C:
				if err := sessionService.Cleanup(cleanupContext); err != nil {
					logger.Error("session cleanup failed", "error", err)
				}
			}
		}
	}()
	defer func() {
		stopCleanup()
		<-cleanupDone
	}()

	public := httpapi.New(httpapi.Dependencies{
		Operations:   operationService,
		Employees:    employeeStore,
		Sessions:     sessionService,
		Audit:        auditStore,
		Limiter:      limiter,
		PublicOrigin: cfg.AdminPublicOrigin,
		TrustProxy:   cfg.TrustProxy,
		Logger:       logger,
		Timeout:      cfg.DatabaseTimeout,
		Registry:     registry,
		Accounts:     accountService,
	})
	management := httpapi.Management(pool, cfg.DatabaseTimeout, logger)

	return httpserver.RunAll(ctx, logger, cfg.ShutdownTimeout,
		httpserver.New(cfg.HTTPAddress, public),
		httpserver.New(cfg.ManagementHTTPAddress, management),
	)
}
