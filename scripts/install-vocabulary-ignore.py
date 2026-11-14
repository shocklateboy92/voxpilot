#!/usr/bin/env python3
"""Install the private vocabulary pattern without replacing existing Git settings."""

import argparse
import json
import os
import subprocess
from pathlib import Path

PATTERN = "/.voxpilot/vocabulary.local.json"


def ignore_file():
    result = subprocess.run(
        ["git", "config", "--global", "--path", "--get", "core.excludesFile"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode == 0:
        path = Path(result.stdout.strip()).expanduser()
        if not path.is_absolute():
            raise ValueError("Git's global core.excludesFile must be an absolute path")
        return path
    if result.returncode != 1:
        raise RuntimeError("Could not read Git's global excludesFile setting")
    configured = os.environ.get("XDG_CONFIG_HOME")
    config = (
        Path(configured)
        if configured and Path(configured).is_absolute()
        else Path.home() / ".config"
    )
    return config / "git" / "ignore"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    path = ignore_file()
    content = path.read_text() if path.exists() else ""
    needed = PATTERN not in content.splitlines()
    if needed and not args.dry_run:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as output:
            if content and not content.endswith("\n"):
                output.write("\n")
            output.write(PATTERN + "\n")
    print(
        json.dumps(
            {
                "file": str(path),
                "pattern": PATTERN,
                "changed": needed and not args.dry_run,
                "would_change": needed,
                "dry_run": args.dry_run,
            }
        )
    )


if __name__ == "__main__":
    main()
