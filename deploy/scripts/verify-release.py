#!/usr/bin/env python3
"""Check the exact local images selected by resolved release Compose."""
import json
import re
import subprocess
import sys

PURPOSES = {
    "admin-api": "admin-api",
    "admin-cli": "admin-cli",
    "migrate": "migrate",
    "core-frontend": "core",
    "managers-frontend": "managers",
    "ingress": "ingress",
    "admin-postgres": None,
}


def verify(manifest, config, inspect):
    if manifest.get("schemaVersion") != 1:
        raise ValueError("unsupported release manifest version")
    if manifest.get("minimumCompatibleAdminRevision") != "495cead":
        raise ValueError("minimum compatible Admin revision must be 495cead")
    if manifest.get("migrationHead") != "000011":
        raise ValueError("release requires migration head 000011")
    revision = manifest.get("adminRevision", "")
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("adminRevision must be a full Git revision")
    if set(manifest.get("images", {})) != set(PURPOSES):
        raise ValueError("manifest must enumerate all release services exactly")
    for service, purpose in PURPOSES.items():
        image = config["services"][service]["image"]
        if not re.fullmatch(r"(?:[^\s]+@)?sha256:[0-9a-f]{64}", image):
            raise ValueError(f"{service} requires an immutable image ID or digest")
        actual = inspect(image)
        record = manifest["images"][service]
        if record.get("reference") != image or record.get("imageId") != actual["Id"]:
            raise ValueError(f"{service} image identity mismatch")
        if purpose is None:
            continue
        labels = actual["Config"].get("Labels") or {}
        purpose_key = "io.rakurs.frontend.purpose" if service.endswith("-frontend") else "io.rakurs.release.purpose"
        if labels.get(purpose_key) != purpose:
            raise ValueError(f"{service} purpose mismatch")
        if labels.get("org.opencontainers.image.revision") != revision:
            raise ValueError(f"{service} revision mismatch")
    environment = config["services"]["admin-api"]["environment"]
    origins = {key: environment[key] for key in ("ADMIN_PUBLIC_ORIGIN", "MANAGERS_PUBLIC_ORIGIN")}
    if manifest.get("origins") != origins:
        raise ValueError("release origins mismatch")


def inspect_image(reference):
    result = subprocess.run(["docker", "image", "inspect", reference], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)[0]


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: verify-release.py MANIFEST RESOLVED_COMPOSE_JSON")
    try:
        with open(sys.argv[1], encoding="utf-8") as source:
            manifest = json.load(source)
        with open(sys.argv[2], encoding="utf-8") as source:
            config = json.load(source)
        verify(manifest, config, inspect_image)
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(f"release verification failed: {error}")
    print("release image identities, labels and origins match manifest")
