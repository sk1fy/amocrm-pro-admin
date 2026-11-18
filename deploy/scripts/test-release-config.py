#!/usr/bin/env python3
"""Validate standalone release topology and render the real nginx configuration."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[2]


def run(*args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True, **kwargs)
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)
    return result


def check_topology(config):
    services = config["services"]
    assert set(services) == {"admin-postgres", "admin-api", "admin-cli", "migrate", "core-frontend", "managers-frontend", "ingress"}
    for name, service in services.items():
        assert "build" not in service, name
        assert all(mount.startswith("/") for mount in service.get("tmpfs", [])), name
        if name != "ingress":
            assert not service.get("ports"), name
    ports = services["ingress"]["ports"]
    assert len(ports) == 1 and ports[0]["host_ip"] == "127.0.0.1" and ports[0]["target"] == 443
    api = services["admin-api"]
    assert api["environment"]["APP_ENV"] == "production"
    assert api["environment"]["TRUST_PROXY_HEADERS"] == "true"
    assert all(mount["read_only"] and not mount["bind"]["create_host_path"] for mount in api["volumes"])
    assert config["networks"]["platform"]["external"]
    assert config["networks"]["web"]["internal"] and config["networks"]["database"]["internal"]
    assert not config["networks"]["egress"].get("internal", False)


def main():
    env = dict(os.environ)
    for key in ("ADMIN_POSTGRES_IMAGE", "MIGRATE_IMAGE", "ADMIN_CLI_IMAGE", "ADMIN_API_IMAGE", "ADMIN_CORE_IMAGE", "ADMIN_MANAGERS_IMAGE", "ADMIN_INGRESS_IMAGE"):
        env[key] = "sha256:" + "a" * 64
    env.update(POSTGRES_DB="admin", POSTGRES_USER="admin", ADMIN_DB_PASSWORD="test-only", DATABASE_URL="postgres://admin:test-only@admin-postgres/admin?sslmode=disable", MIGRATION_TIMEOUT="2m", ADMIN_PUBLIC_ORIGIN="https://admin.example.invalid", MANAGERS_PUBLIC_ORIGIN="https://managers.example.invalid:8443", MANAGERS_PLATFORM_URL="https://platform.example.invalid", MANAGERS_PLATFORM_TIMEOUT="2s", CORE_ADMIN_API_TOKEN="test-only", CORE_ADMIN_NETWORK="test-core", MANAGERS_PLATFORM_NETWORK="test-platform", ADMIN_TLS_PORT="8443")
    for key in ("BACKENDS_FILE_PATH", "MANAGERS_PLATFORM_CA_PATH", "MANAGERS_PLATFORM_CERT_PATH", "MANAGERS_PLATFORM_KEY_PATH", "ADMIN_TLS_CERT_PATH", "ADMIN_TLS_KEY_PATH"):
        env[key] = "/tmp/release-config-test-unused"
    compose = shlex.split(env.get("COMPOSE", "docker compose"))
    args = [*compose, "--profile", "tools", "-f", str(ROOT / "deploy/docker-compose.release.yml"), "config", "--format", "json"]
    config = json.loads(run(*args, env=env).stdout)
    check_topology(config)
    for key in ("ADMIN_API_IMAGE", "MANAGERS_PUBLIC_ORIGIN", "MANAGERS_PLATFORM_KEY_PATH", "MIGRATE_IMAGE", "ADMIN_CLI_IMAGE"):
        missing = dict(env)
        missing.pop(key)
        result = subprocess.run(args, env=missing, capture_output=True, text=True)
        assert result.returncode != 0, f"missing {key} was accepted"
    image = "rakurs-ingress-config-test:" + uuid.uuid4().hex
    try:
        run("docker", "build", "-f", str(ROOT / "deploy/ingress.Dockerfile"), "-t", image, str(ROOT / "deploy"), env={**env, "DOCKER_BUILDKIT": "0"})
        with tempfile.TemporaryDirectory(prefix=".rakurs-ingress-", dir=ROOT) as directory:
            run("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=admin.example.invalid", "-keyout", directory + "/server.key", "-out", directory + "/server.crt", "-days", "1")
            base = ["docker", "run", "--rm", "--read-only", "--tmpfs", "/etc/nginx/conf.d", "--tmpfs", "/var/cache/nginx", "--tmpfs", "/var/run", "--security-opt", "no-new-privileges:true", "--add-host", "admin-api:127.0.0.1", "-v", directory + ":/etc/admin-tls:ro", "-e", "ADMIN_PUBLIC_ORIGIN=" + env["ADMIN_PUBLIC_ORIGIN"]]
            run(*base, "-e", "MANAGERS_PUBLIC_ORIGIN=" + env["MANAGERS_PUBLIC_ORIGIN"], image, "nginx", "-t")
            for origin in ("http://managers.example.invalid", "https://admin.example.invalid", "https://managers.example.invalid/path", "https://managers.example.invalid:65536", "https://bad;host"):
                result = subprocess.run([*base, "-e", "MANAGERS_PUBLIC_ORIGIN=" + origin, image, "nginx", "-t"], capture_output=True, text=True)
                assert result.returncode != 0, f"invalid origin was accepted: {origin}"
    finally:
        run("docker", "image", "rm", image)
    print("release topology, required parameters and actual nginx configuration pass")


if __name__ == "__main__":
    main()
