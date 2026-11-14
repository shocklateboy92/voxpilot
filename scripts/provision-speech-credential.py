"""Operator-only: seal the existing private API key on chapel without displaying it."""

import base64
import binascii
import os
import stat
import subprocess
from pathlib import Path


def main():
    source = Path.home() / ".config/voxpilot/credentials/openai-api-key"
    info = source.lstat()
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) != 0o600
    ):
        raise SystemExit("Expected an owned, private regular credential file (0600).")
    destination = (
        Path.home()
        / "src/homelab/mkosi.images/tenant/mkosi.extra/etc/homelab/hosts/chapel"
        / "credstore.encrypted/voxpilot-speech-openai-key.cred"
    )
    if destination.exists():
        raise SystemExit(
            "Ciphertext already exists; deliberate rotation requires operator review."
        )
    ssh = ["ssh", "-o", "BatchMode=yes", "root@chapel"]
    remote = (
        'set -eu; test "$(uname -n)" = chapel; '
        "systemd-creds encrypt --with-key=host "
        "--name=voxpilot-speech-openai-key - -"
    )
    with os.fdopen(os.open(source, os.O_RDONLY | os.O_NOFOLLOW), "rb") as key:
        sealed = subprocess.run(
            [*ssh, remote],
            stdin=key,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    try:
        ciphertext = base64.b64decode(b"".join(sealed.stdout.split()), validate=True)
    except binascii.Error:
        ciphertext = b""
    if sealed.returncode != 0 or len(ciphertext) < 64:
        raise SystemExit(
            "Chapel credential sealing failed; no plaintext was displayed or stored remotely."
        )
    with destination.open("xb") as output:
        output.write(sealed.stdout)
    subprocess.run(
        [
            *ssh,
            (
                'set -eu; test "$(uname -n)" = chapel; '
                "install -d -m 0700 /var/lib/voxpilot-speech/credentials; "
                "umask 077; cat > /var/lib/voxpilot-speech/credentials/openai.cred"
            ),
        ],
        input=sealed.stdout,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )
    print(
        "Chapel-only encrypted credential saved and provisioned. No production changes."
    )


if __name__ == "__main__":
    main()
