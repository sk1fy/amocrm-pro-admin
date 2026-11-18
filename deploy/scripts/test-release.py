#!/usr/bin/env python3
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("verify-release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.revision = "a" * 40
        self.manifest = {"schemaVersion": 1, "minimumCompatibleAdminRevision": "495cead", "migrationHead": "000011", "adminRevision": self.revision, "images": {}, "origins": {"ADMIN_PUBLIC_ORIGIN": "https://admin.example.invalid", "MANAGERS_PUBLIC_ORIGIN": "https://managers.example.invalid"}}
        self.config = {"services": {}}
        self.images = {}
        for index, (service, purpose) in enumerate(release.PURPOSES.items()):
            reference = "sha256:" + str(index) * 64
            labels = {"org.opencontainers.image.revision": self.revision, "io.rakurs.frontend.purpose": purpose, "io.rakurs.release.purpose": purpose}
            self.images[reference] = {"Id": reference, "Config": {"Labels": labels}}
            self.config["services"][service] = {"image": reference}
            self.manifest["images"][service] = {"reference": reference, "imageId": reference}
        self.config["services"]["admin-api"]["environment"] = copy.deepcopy(self.manifest["origins"])

    def verify(self):
        release.verify(self.manifest, self.config, self.images.__getitem__)

    def test_exact_release(self):
        self.verify()

    def test_negative_mismatches(self):
        mutations = {
            "mutable tag": lambda: self.config["services"]["ingress"].update(image="nginx:latest"),
            "wrong image": lambda: self.manifest["images"]["admin-api"].update(imageId="sha256:" + "f" * 64),
            "demo purpose": lambda: self.images[self.config["services"]["core-frontend"]["image"]]["Config"]["Labels"].update({"io.rakurs.frontend.purpose": "demo"}),
            "wrong revision": lambda: self.images[self.config["services"]["migrate"]["image"]]["Config"]["Labels"].update({"org.opencontainers.image.revision": "old"}),
            "wrong origin": lambda: self.manifest["origins"].update(ADMIN_PUBLIC_ORIGIN="https://other.example.invalid"),
            "unsafe rollback": lambda: self.manifest.update(minimumCompatibleAdminRevision="pre-A07"),
            "wrong schema": lambda: self.manifest.update(migrationHead="000010"),
            "missing image": lambda: self.manifest["images"].pop("admin-cli"),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                self.setUp()
                mutate()
                with self.assertRaises(ValueError):
                    self.verify()


if __name__ == "__main__":
    unittest.main()
