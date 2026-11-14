import importlib.util
import io
import subprocess
import tarfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "deploy_speech", Path(__file__).with_name("deploy-speech-staging.py")
)
assert SPEC is not None and SPEC.loader is not None
DEPLOY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DEPLOY)


class SpeechStagingDeploymentTest(unittest.TestCase):
    def test_remote_operations_have_fixed_staging_host_and_identity_guard(self):
        with patch.object(
            DEPLOY.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 0, b"ok", b""),
        ) as run:
            self.assertEqual(DEPLOY.remote("test -d /run"), b"ok")
        command = run.call_args.args[0]
        self.assertEqual(command[:4], ["ssh", "-o", "BatchMode=yes", "root@chapel"])
        self.assertEqual(
            command[4], 'set -eu; test "$(uname -n)" = chapel; test -d /run'
        )
        self.assertTrue(run.call_args.kwargs["capture_output"])

    def test_archive_contains_only_explicit_sources_with_declared_permissions(self):
        value = DEPLOY.archive(
            [
                ("speech/src/main.ts", b"source-only", 0o644),
                ("homelab/config", b"token-only-helper", 0o755),
            ]
        )
        with tarfile.open(fileobj=io.BytesIO(value)) as tar:
            self.assertEqual(tar.getnames(), ["speech/src/main.ts", "homelab/config"])
            self.assertEqual(tar.getmember("homelab/config").mode, 0o755)
            self.assertTrue(all(member.isfile() for member in tar.getmembers()))

    def test_no_production_hosts_or_opencode_restart_commands_in_deployer(self):
        source = Path(DEPLOY.__file__).read_text()
        self.assertNotIn("root@mccoy", source)
        self.assertNotIn("root@sisko", source)
        self.assertNotIn("root@medbay", source)
        self.assertNotIn("service restart", source)
        self.assertIn("systemctl restart homelab-voxpilot-speech.service", source)
        self.assertNotIn("caddy-merge-sites", source)

    def test_shared_production_unit_is_always_rewritten_to_staging(self):
        unit = (
            "[Unit]\nDescription=Speech\n[Container]\n"
            "Image=registry.apps.lasath.com/voxpilot-speech:0.1.0@sha256:"
            + "a"
            * 64
            + "\n"
            "EnvironmentFile=/etc/homelab/hosts/%H/voxpilot-speech/env\n"
        )
        value = DEPLOY.staging_unit(unit)
        self.assertIn("ConditionHost=chapel", value)
        self.assertIn(
            "Image=registry.staging.lasath.com/voxpilot-speech:voice-prototype@sha256:",
            value,
        )
        self.assertNotIn("registry.apps.lasath.com", value)
        self.assertIn("EnvironmentFile=/run/homelab/voxpilot-speech/host.env", value)
        with self.assertRaises(SystemExit):
            DEPLOY.staging_unit(
                unit,
                "registry.apps.lasath.com/voxpilot-speech:0.1.0@sha256:" + "a" * 64,
            )


if __name__ == "__main__":
    unittest.main()
