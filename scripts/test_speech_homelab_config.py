import json
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

TENANT = Path(__file__).resolve().parents[2] / "homelab/mkosi.images/tenant/mkosi.extra"


class SpeechHomelabConfigTest(unittest.TestCase):
    def test_shared_units_use_host_credentials_and_enable_config_at_boot(self):
        unit = (
            TENANT / "etc/containers/systemd/homelab-voxpilot-speech.container"
        ).read_text()
        config = (
            TENANT / "etc/systemd/system/voxpilot-speech-config.service"
        ).read_text()
        preset = (TENANT / "etc/systemd/system-preset/10-homelab.preset").read_text()
        self.assertNotIn("ConditionHost=chapel", unit + config)
        self.assertIn(
            "/etc/homelab/hosts/%H/credstore.encrypted/voxpilot-speech-openai-key.cred",
            unit,
        )
        self.assertIn("/etc/homelab/hosts/%H/voxpilot-speech/env", unit)
        self.assertIn("registry.apps.lasath.com/voxpilot-speech:0.1.0@sha256:", unit)
        self.assertNotIn("openai", config)
        self.assertIn("EnvironmentFile=/etc/homelab/hosts/%H/env", config)
        self.assertIn("enable voxpilot-speech-config.service", preset)

    def test_origins_are_host_scoped_and_route_uses_dns(self):
        common = (TENANT / "etc/homelab/voxpilot-speech/env").read_text()
        self.assertNotIn("SPEECH_ALLOWED_ORIGINS", common)
        for host, expected in (
            (
                "chapel",
                [
                    "https://voxpilot-dev.staging.lasath.com",
                    "https://voxpilot.staging.lasath.com",
                ],
            ),
            ("mccoy", ["https://voxpilot.apps.lasath.com"]),
        ):
            value = (
                (TENANT / f"etc/homelab/hosts/{host}/voxpilot-speech/env")
                .read_text()
                .strip()
            )
            self.assertEqual(json.loads(value.split("=", 1)[1]), expected)
        route = (TENANT / "etc/homelab/caddy/sites.d/voxpilot-speech.caddy").read_text()
        self.assertIn("speech.{$DNS}", route)

    def test_config_generator_uses_dns_preserves_servers_and_does_not_log_token(self):
        helper = TENANT / "usr/lib/homelab/voxpilot-speech-config"
        with tempfile.TemporaryDirectory(dir="/tmp/opencode") as directory:
            root = Path(directory)
            token = "synthetic-speech-token-" + "x" * 40
            (root / "voxpilot-speech-token").write_text(token + "\n")
            path = root / "config.json"
            servers = [
                {
                    "id": "test",
                    "url": "https://coding.example",
                    "password": "synthetic-password",
                }
            ]
            for dns in ("apps.lasath.com", "staging.lasath.com"):
                path.write_text(json.dumps({"servers": servers}))
                result = subprocess.run(
                    ["sh", str(helper), str(path), str(path)],
                    env={
                        "PATH": os.defpath,
                        "CREDENTIALS_DIRECTORY": directory,
                        "DNS": dns,
                    },
                    capture_output=True,
                    check=True,
                )
                output = json.loads(path.read_text())
                self.assertEqual(output["servers"], servers)
                self.assertEqual(
                    output["speech"], {"url": f"https://speech.{dns}", "token": token}
                )
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                self.assertEqual(result.stdout, b"")
                self.assertEqual(result.stderr, b"")
            original = path.read_bytes()
            result = subprocess.run(
                ["sh", str(helper), str(path), str(path)],
                env={"PATH": os.defpath, "CREDENTIALS_DIRECTORY": directory},
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(path.read_bytes(), original)
            self.assertNotIn(token.encode(), result.stderr)


if __name__ == "__main__":
    unittest.main()
