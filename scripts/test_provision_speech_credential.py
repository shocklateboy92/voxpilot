import base64
import contextlib
import importlib.util
import io
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "provision_speech", Path(__file__).with_name("provision-speech-credential.py")
)
assert SPEC is not None and SPEC.loader is not None
PROVISION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROVISION)


class CredentialProvisioningTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name)
        self.key = self.home / ".config/voxpilot/credentials/openai-api-key"
        self.key.parent.mkdir(parents=True)
        self.key.write_bytes(b"synthetic-non-secret-test-input")
        os.chmod(self.key, 0o600)
        self.destination = (
            self.home
            / "src/homelab/mkosi.images/tenant/mkosi.extra/etc/homelab"
            / "hosts/chapel/credstore.encrypted/voxpilot-speech-openai-key.cred"
        )
        self.destination.parent.mkdir(parents=True)

    def test_accepts_systemd_base64_not_pem_and_transfers_only_ciphertext(self):
        cipher = base64.encodebytes(bytes(range(128)))
        output = io.StringIO()
        with (
            patch.object(Path, "home", return_value=self.home),
            patch.object(
                PROVISION.subprocess,
                "run",
                side_effect=[
                    subprocess.CompletedProcess([], 0, cipher),
                    subprocess.CompletedProcess([], 0),
                ],
            ) as run,
            contextlib.redirect_stdout(output),
        ):
            PROVISION.main()
        self.assertEqual(self.destination.read_bytes(), cipher)
        self.assertEqual(run.call_args.kwargs["input"], cipher)
        self.assertNotIn("synthetic-non-secret", output.getvalue())
        for call in run.call_args_list:
            self.assertEqual(
                call.args[0][:4], ["ssh", "-o", "BatchMode=yes", "root@chapel"]
            )
            self.assertIn('test "$(uname -n)" = chapel', call.args[0][4])

    def test_refuses_readable_or_symlink_credentials(self):
        for mode in (0o644, 0o640):
            os.chmod(self.key, mode)
            with (
                patch.object(Path, "home", return_value=self.home),
                patch.object(PROVISION.subprocess, "run") as run,
            ):
                with self.assertRaises(SystemExit):
                    PROVISION.main()
                run.assert_not_called()
        original = self.key.with_suffix(".original")
        self.key.rename(original)
        self.key.symlink_to(original)
        with (
            patch.object(Path, "home", return_value=self.home),
            self.assertRaises(SystemExit),
        ):
            PROVISION.main()

    def test_failure_does_not_publish_or_print_remote_output(self):
        with (
            patch.object(Path, "home", return_value=self.home),
            patch.object(
                PROVISION.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 1, b"invalid-output"),
            ) as run,
            self.assertRaises(SystemExit) as error,
        ):
            PROVISION.main()
        self.assertFalse(self.destination.exists())
        self.assertNotIn("invalid-output", str(error.exception))
        self.assertEqual(run.call_count, 1)

    def test_never_overwrites_existing_ciphertext(self):
        self.destination.write_bytes(b"existing-ciphertext")
        with (
            patch.object(Path, "home", return_value=self.home),
            patch.object(PROVISION.subprocess, "run") as run,
            self.assertRaises(SystemExit),
        ):
            PROVISION.main()
        run.assert_not_called()
        self.assertEqual(self.destination.read_bytes(), b"existing-ciphertext")


if __name__ == "__main__":
    unittest.main()
