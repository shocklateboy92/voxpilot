import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("install-vocabulary-ignore.py")
PATTERN = "/.voxpilot/vocabulary.local.json"


class VocabularyIgnoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(
            prefix="voxpilot-ignore-test-", dir="/tmp/opencode"
        )
        self.root = Path(self.temporary.name)
        self.env = {
            **os.environ,
            "HOME": str(self.root),
            "XDG_CONFIG_HOME": str(self.root / "config"),
            "GIT_CONFIG_GLOBAL": str(self.root / "gitconfig"),
            "GIT_CONFIG_NOSYSTEM": "1",
        }

    def tearDown(self):
        self.temporary.cleanup()

    def run_installer(self, *arguments):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), *arguments],
            env=self.env,
            cwd=self.root,
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(result.stdout)

    def test_default_is_idempotent_and_dry_run_does_not_create_files(self):
        target = self.root / "config/git/ignore"
        self.assertTrue(self.run_installer("--dry-run")["would_change"])
        self.assertFalse(target.exists())
        self.assertTrue(self.run_installer()["changed"])
        self.assertEqual(target.read_text(), PATTERN + "\n")
        self.assertFalse(self.run_installer()["changed"])

    def test_existing_global_file_is_preserved_without_repointing_config(self):
        target = self.root / "custom.ignore"
        target.write_text("existing-pattern")
        subprocess.run(
            ["git", "config", "--global", "core.excludesFile", str(target)],
            env=self.env,
            cwd=self.root,
            check=True,
        )
        before = (self.root / "gitconfig").read_text()
        self.run_installer()
        self.assertEqual(target.read_text(), "existing-pattern\n" + PATTERN + "\n")
        self.assertEqual((self.root / "gitconfig").read_text(), before)

    def test_symlink_to_existing_ignore_file_is_kept(self):
        real = self.root / "real.ignore"
        real.write_text("another-pattern\n")
        target = self.root / "config/git/ignore"
        target.parent.mkdir(parents=True)
        target.symlink_to(real)
        self.run_installer()
        self.assertTrue(target.is_symlink())
        self.assertEqual(real.read_text(), "another-pattern\n" + PATTERN + "\n")


if __name__ == "__main__":
    unittest.main()
