package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	envDevelopment           = "development"
	envProduction            = "production"
	defaultPublicOrigin      = "http://127.0.0.1:5173"
	defaultHTTPAddress       = ":8090"
	defaultManagementAddress = ":8092"
	defaultMigrationsDir     = "/migrations"
)

type API struct {
	ServiceName           string
	Environment           string
	LogLevel              string
	HTTPAddress           string
	ManagementHTTPAddress string
	ShutdownTimeout       time.Duration
	DatabaseURL           string
	DatabaseTimeout       time.Duration
	DBMaxConns            int32
	AdminPublicOrigin     string
	ManagerPublicOrigin   string
	ManagerPlatform       ManagerPlatform
	SessionAbsoluteTTL    time.Duration
	SessionIdleTTL        time.Duration
	LoginRatePerMinute    int
	TrustProxy            bool
	BackendsFile          string
	MigrationsDir         string
	GrafanaBaseURL        string
	LokiBaseURL           string
	CookieSecure          bool
}

type ManagerPlatform struct {
	URL, CAFile, CertFile, KeyFile string
	Timeout                        time.Duration
}

type Migrate struct {
	DatabaseURL   string
	MigrationsDir string
	Timeout       time.Duration
}

type CLI struct {
	DatabaseURL     string
	DatabaseTimeout time.Duration
}

func LoadAPI() (API, error) {
	environment, err := loadEnvironment()
	if err != nil {
		return API{}, err
	}
	logLevel, err := loadLogLevel()
	if err != nil {
		return API{}, err
	}
	databaseURL, err := requireDatabaseURL()
	if err != nil {
		return API{}, err
	}
	httpAddress := strings.TrimSpace(os.Getenv("HTTP_ADDRESS"))
	if httpAddress == "" {
		httpAddress = defaultHTTPAddress
	}
	if err := validateListenAddress(httpAddress); err != nil {
		return API{}, fmt.Errorf("HTTP_ADDRESS: %w", err)
	}
	managementAddress := strings.TrimSpace(os.Getenv("MANAGEMENT_HTTP_ADDRESS"))
	if managementAddress == "" {
		managementAddress = defaultManagementAddress
	}
	if err := validateListenAddress(managementAddress); err != nil {
		return API{}, fmt.Errorf("MANAGEMENT_HTTP_ADDRESS: %w", err)
	}
	if addressesConflict(httpAddress, managementAddress) {
		return API{}, errors.New("MANAGEMENT_HTTP_ADDRESS must not conflict with HTTP_ADDRESS")
	}

	shutdownTimeout, err := duration("SHUTDOWN_TIMEOUT", 15*time.Second)
	if err != nil {
		return API{}, err
	}
	databaseTimeout, err := duration("DATABASE_TIMEOUT", 2*time.Second)
	if err != nil {
		return API{}, err
	}
	maxConns, err := integer("DB_MAX_CONNS", 10, 1, 100)
	if err != nil {
		return API{}, err
	}
	absoluteTTL, err := duration("SESSION_ABSOLUTE_TTL", 12*time.Hour)
	if err != nil {
		return API{}, err
	}
	idleTTL, err := duration("SESSION_IDLE_TTL", 2*time.Hour)
	if err != nil {
		return API{}, err
	}
	loginRate, err := integer("LOGIN_RATE_PER_MINUTE", 10, 1, 10_000)
	if err != nil {
		return API{}, err
	}
	trustProxy, err := boolean("TRUST_PROXY_HEADERS", false)
	if err != nil {
		return API{}, err
	}

	origin := strings.TrimSpace(os.Getenv("ADMIN_PUBLIC_ORIGIN"))
	if origin == "" {
		if environment != envDevelopment {
			return API{}, errors.New("ADMIN_PUBLIC_ORIGIN is required")
		}
		origin = defaultPublicOrigin
	}
	if _, err := url.ParseRequestURI(origin); err != nil {
		return API{}, fmt.Errorf("ADMIN_PUBLIC_ORIGIN must be an absolute URL")
	}

	managerOrigin := strings.TrimSpace(os.Getenv("MANAGERS_PUBLIC_ORIGIN"))
	if managerOrigin != "" {
		managerURL, err := parseBrowserOrigin(managerOrigin, environment)
		if err != nil {
			return API{}, fmt.Errorf("MANAGERS_PUBLIC_ORIGIN: %w", err)
		}
		adminURL, err := parseBrowserOrigin(origin, environment)
		if err != nil {
			return API{}, fmt.Errorf("ADMIN_PUBLIC_ORIGIN: %w", err)
		}
		if strings.EqualFold(managerURL.Hostname(), adminURL.Hostname()) {
			return API{}, errors.New("MANAGERS_PUBLIC_ORIGIN and ADMIN_PUBLIC_ORIGIN must use different hostnames")
		}
		managerOrigin = managerURL.Scheme + "://" + managerURL.Host
		origin = adminURL.Scheme + "://" + adminURL.Host
	}

	managerPlatform, err := loadManagerPlatform(managerOrigin)
	if err != nil {
		return API{}, err
	}

	migrationsDir := strings.TrimSpace(os.Getenv("MIGRATIONS_DIR"))
	if migrationsDir == "" {
		migrationsDir = defaultMigrationsDir
	}
	grafanaURL, err := optionalAbsoluteURL("GRAFANA_BASE_URL")
	if err != nil {
		return API{}, err
	}
	lokiURL, err := optionalAbsoluteURL("LOKI_BASE_URL")
	if err != nil {
		return API{}, err
	}

	return API{
		ServiceName:           "admin-api",
		Environment:           environment,
		LogLevel:              logLevel,
		HTTPAddress:           httpAddress,
		ManagementHTTPAddress: managementAddress,
		ShutdownTimeout:       shutdownTimeout,
		DatabaseURL:           databaseURL,
		DatabaseTimeout:       databaseTimeout,
		DBMaxConns:            int32(maxConns),
		AdminPublicOrigin:     origin,
		ManagerPublicOrigin:   managerOrigin,
		ManagerPlatform:       managerPlatform,
		SessionAbsoluteTTL:    absoluteTTL,
		SessionIdleTTL:        idleTTL,
		LoginRatePerMinute:    loginRate,
		TrustProxy:            trustProxy,
		BackendsFile:          strings.TrimSpace(os.Getenv("BACKENDS_FILE")),
		MigrationsDir:         migrationsDir,
		GrafanaBaseURL:        grafanaURL,
		LokiBaseURL:           lokiURL,
		CookieSecure:          environment != envDevelopment,
	}, nil
}

func loadManagerPlatform(managerOrigin string) (ManagerPlatform, error) {
	platform := ManagerPlatform{
		URL:      strings.TrimSpace(os.Getenv("MANAGERS_PLATFORM_URL")),
		CAFile:   strings.TrimSpace(os.Getenv("MANAGERS_PLATFORM_CA_FILE")),
		CertFile: strings.TrimSpace(os.Getenv("MANAGERS_PLATFORM_CERT_FILE")),
		KeyFile:  strings.TrimSpace(os.Getenv("MANAGERS_PLATFORM_KEY_FILE")),
	}
	var err error
	platform.Timeout, err = duration("MANAGERS_PLATFORM_TIMEOUT", 10*time.Second)
	if err != nil || platform.Timeout < time.Second || platform.Timeout > 30*time.Second {
		return ManagerPlatform{}, errors.New("MANAGERS_PLATFORM_TIMEOUT must be between 1s and 30s")
	}
	if platform.URL != "" || platform.CAFile != "" || platform.CertFile != "" || platform.KeyFile != "" {
		if managerOrigin == "" || platform.URL == "" || platform.CAFile == "" || platform.CertFile == "" || platform.KeyFile == "" {
			return ManagerPlatform{}, errors.New("platform requires MANAGERS_PUBLIC_ORIGIN, MANAGERS_PLATFORM_URL and all three mTLS files")
		}
	}
	return platform, nil
}

func LoadMigrate() (Migrate, error) {
	databaseURL, err := requireDatabaseURL()
	if err != nil {
		return Migrate{}, err
	}
	timeout, err := duration("MIGRATION_TIMEOUT", 2*time.Minute)
	if err != nil {
		return Migrate{}, err
	}
	dir := strings.TrimSpace(os.Getenv("MIGRATIONS_DIR"))
	if dir == "" {
		dir = defaultMigrationsDir
	}
	return Migrate{DatabaseURL: databaseURL, MigrationsDir: dir, Timeout: timeout}, nil
}

func LoadCLI() (CLI, error) {
	databaseURL, err := requireDatabaseURL()
	if err != nil {
		return CLI{}, err
	}
	timeout, err := duration("DATABASE_TIMEOUT", 30*time.Second)
	if err != nil {
		return CLI{}, err
	}
	return CLI{DatabaseURL: databaseURL, DatabaseTimeout: timeout}, nil
}

func parseBrowserOrigin(raw, environment string) (*url.URL, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" || parsed.User != nil ||
		(parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.ForceQuery ||
		parsed.Fragment != "" || strings.Contains(raw, "#") {
		return nil, errors.New("must be a browser origin")
	}
	if parsed.Scheme != "https" && (environment != envDevelopment || parsed.Scheme != "http") {
		return nil, errors.New("must use HTTPS outside development")
	}
	parsed.Host = strings.ToLower(parsed.Host)
	if port := parsed.Port(); port != "" {
		value, err := strconv.Atoi(port)
		if err != nil || value < 1 || value > 65_535 {
			return nil, errors.New("must specify a valid TCP port")
		}
		if (parsed.Scheme == "https" && value == 443) || (parsed.Scheme == "http" && value == 80) {
			parsed.Host = strings.TrimSuffix(parsed.Host, ":"+port)
		} else {
			parsed.Host = net.JoinHostPort(parsed.Hostname(), strconv.Itoa(value))
		}
	} else if strings.HasSuffix(parsed.Host, ":") {
		return nil, errors.New("must specify a valid TCP port")
	}
	return parsed, nil
}

func NormalizeOrigin(origin string) string {
	return strings.TrimRight(strings.TrimSpace(origin), "/")
}

func requireDatabaseURL() (string, error) {
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		return "", errors.New("DATABASE_URL is required")
	}
	return databaseURL, nil
}

func loadEnvironment() (string, error) {
	environment := strings.TrimSpace(os.Getenv("APP_ENV"))
	if environment == "" {
		environment = envDevelopment
	}
	if environment != envDevelopment && environment != envProduction {
		return "", fmt.Errorf("APP_ENV must be development or production, got %q", environment)
	}
	return environment, nil
}

func loadLogLevel() (string, error) {
	logLevel := strings.ToLower(strings.TrimSpace(os.Getenv("LOG_LEVEL")))
	if logLevel == "" {
		logLevel = "info"
	}
	switch logLevel {
	case "debug", "info", "warn", "error":
		return logLevel, nil
	default:
		return "", fmt.Errorf("LOG_LEVEL must be debug, info, warn, or error, got %q", logLevel)
	}
}

func duration(name string, fallback time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	value, err := time.ParseDuration(raw)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("%s must be a positive duration: %q", name, raw)
	}
	return value, nil
}

func integer(name string, fallback, minValue, maxValue int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < minValue || value > maxValue {
		return 0, fmt.Errorf("%s must be an integer between %d and %d: %q", name, minValue, maxValue, raw)
	}
	return value, nil
}

func boolean(name string, fallback bool) (bool, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("%s must be a boolean: %q", name, raw)
	}
	return value, nil
}

func addressesConflict(first, second string) bool {
	firstHost, firstPort, firstErr := net.SplitHostPort(first)
	secondHost, secondPort, secondErr := net.SplitHostPort(second)
	if firstErr != nil || secondErr != nil {
		return first == second
	}
	if firstPort != secondPort {
		return false
	}
	return firstHost == secondHost || wildcardHost(firstHost) || wildcardHost(secondHost)
}

func validateListenAddress(address string) error {
	_, rawPort, err := net.SplitHostPort(address)
	if err != nil {
		return errors.New("must be a TCP host:port address")
	}
	port, err := strconv.Atoi(rawPort)
	if err != nil || port < 1 || port > 65_535 {
		return errors.New("port must be an integer between 1 and 65535")
	}
	return nil
}

func wildcardHost(host string) bool {
	return host == "" || host == "0.0.0.0" || host == "::"
}

func optionalAbsoluteURL(name string) (string, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return "", nil
	}
	parsed, err := url.ParseRequestURI(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("%s must be an absolute URL", name)
	}
	return strings.TrimRight(raw, "/"), nil
}
