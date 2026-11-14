"""Deploy only the supervised speech service and its HTTPS preview wiring on chapel."""

import argparse
import io
import re
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TENANT = ROOT.parent / "homelab/mkosi.images/tenant/mkosi.extra"
SSH = ["ssh", "-o", "BatchMode=yes", "root@chapel"]


def remote(command, data=None):
    result = subprocess.run(
        [*SSH, 'set -eu; test "$(uname -n)" = chapel; ' + command],
        input=data,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        # These commands handle source/ciphertext only; never dump runtime config.
        log = Path("/tmp/opencode/voxpilot-speech-deploy-error.log")
        log.write_bytes(result.stdout + result.stderr)
        raise SystemExit(f"Chapel deployment command failed; diagnostics: {log}")
    return result.stdout


def archive(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as tar:
        for name, data, mode in files:
            item = tarfile.TarInfo(name)
            item.size = len(data)
            item.mode = mode
            tar.addfile(item, io.BytesIO(data))
    return output.getvalue()


def staging_unit(unit, image=None):
    if image is None:
        match = re.search(r"^Image=[^\n]+@(sha256:[a-f0-9]{64})$", unit, re.MULTILINE)
        if match is None:
            raise SystemExit("Expected a digest-pinned speech image.")
        image = (
            "registry.staging.lasath.com/voxpilot-speech:voice-prototype@" + match[1]
        )
    if not re.fullmatch(
        r"registry\.staging\.lasath\.com/voxpilot-speech:voice-prototype@sha256:[a-f0-9]{64}",
        image,
    ):
        raise SystemExit("Staging deployment requires the chapel registry.")
    unit = re.sub(r"^Image=.*$", "Image=" + image, unit, flags=re.MULTILINE)
    return (
        unit.replace(
            "/etc/homelab/hosts/%H/credstore.encrypted/voxpilot-speech-openai-key.cred",
            "/var/lib/voxpilot-speech/credentials/openai.cred",
        )
        .replace(
            "/etc/homelab/hosts/%H/credstore.encrypted/voxpilot-speech-token.cred",
            "/var/lib/voxpilot-speech/credentials/token.cred",
        )
        .replace("/etc/homelab/voxpilot-speech/env", "/run/homelab/voxpilot-speech/env")
        .replace(
            "/etc/homelab/hosts/%H/voxpilot-speech/env",
            "/run/homelab/voxpilot-speech/host.env",
        )
        .replace("[Unit]\n", "[Unit]\nConditionHost=chapel\n", 1)
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--build",
        action="store_true",
        help="Build/push source only to chapel's staging registry before deployment",
    )
    args = parser.parse_args()
    remote(
        "test -s /var/lib/voxpilot-speech/credentials/openai.cred; test -s /run/voxpilot/dev/config.json"
    )
    image = None
    if args.build:
        paths = [
            "speech/package.json",
            "speech/bun.lock",
            "speech/build.ts",
            "speech/Containerfile",
            "speech/THIRD_PARTY_NOTICES.md",
            "plugin/src/speech-contract.ts",
            *(
                str(path.relative_to(ROOT))
                for path in sorted((ROOT / "speech/src").glob("*.ts"))
            ),
        ]
        files = []
        for name in paths:
            source = ROOT / name
            if source.is_symlink() or not source.is_file():
                raise SystemExit("Build input must be a regular source file.")
            files.append((name, source.read_bytes(), 0o644))
        remote(
            "install -d -m 0755 /run/voxpilot-speech-build; tar -xf - -C /run/voxpilot-speech-build",
            archive(files),
        )
        remote(
            "podman build --authfile /run/credentials/homelab-caddy.service/dockerhub-auth "
            "-t registry.staging.lasath.com/voxpilot-speech:voice-prototype "
            "-f /run/voxpilot-speech-build/speech/Containerfile /run/voxpilot-speech-build; "
            "podman push --digestfile /run/voxpilot-speech-build/image.digest "
            "registry.staging.lasath.com/voxpilot-speech:voice-prototype"
        )
        digest = remote("cat /run/voxpilot-speech-build/image.digest").decode().strip()
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
            raise SystemExit("Invalid staging image digest.")
        image = "registry.staging.lasath.com/voxpilot-speech:voice-prototype@" + digest
        print("Built staging image:", image)

    unit = (
        TENANT / "etc/containers/systemd/homelab-voxpilot-speech.container"
    ).read_text()
    unit = staging_unit(unit, image)
    token = (
        TENANT
        / "etc/homelab/hosts/chapel/credstore.encrypted/voxpilot-speech-token.cred"
    ).read_bytes()
    remote(
        "install -d -m 0700 /var/lib/voxpilot-speech/credentials; umask 077; cat > /var/lib/voxpilot-speech/credentials/token.cred",
        token,
    )
    preview_unit = """[Unit]
Description=VoxPilot staging preview speech connection
ConditionHost=chapel
[Service]
Type=oneshot
RemainAfterExit=yes
LoadCredentialEncrypted=voxpilot-speech-token:/var/lib/voxpilot-speech/credentials/token.cred
UMask=0077
Environment=DNS=staging.lasath.com
ExecStart=/run/homelab/voxpilot-speech/config /run/voxpilot/dev/config.json /run/voxpilot/dev/config.json
"""
    files = [
        ("containers/systemd/homelab-voxpilot-speech.container", unit.encode(), 0o644),
        (
            "homelab/voxpilot-speech/env",
            (TENANT / "etc/homelab/voxpilot-speech/env").read_bytes(),
            0o644,
        ),
        (
            "homelab/voxpilot-speech/config",
            (TENANT / "usr/lib/homelab/voxpilot-speech-config").read_bytes(),
            0o755,
        ),
        (
            "homelab/voxpilot-speech/host.env",
            (TENANT / "etc/homelab/hosts/chapel/voxpilot-speech/env").read_bytes(),
            0o644,
        ),
        (
            "homelab/caddy/sites.d/voxpilot-speech.caddy",
            (TENANT / "etc/homelab/caddy/sites.d/voxpilot-speech.caddy").read_bytes(),
            0o644,
        ),
        (
            "systemd/system/voxpilot-speech-preview-config.service",
            preview_unit.encode(),
            0o644,
        ),
    ]
    remote("tar -xf - -C /run", archive(files))
    remote(
        "/usr/lib/podman/quadlet -dryrun; systemctl daemon-reload; "
        "systemctl restart homelab-voxpilot-speech.service; "
        "systemctl restart voxpilot-speech-preview-config.service; "
        "install -m 0644 /run/homelab/caddy/sites.d/voxpilot-speech.caddy /run/homelab/caddy/merged.d/voxpilot-speech.caddy; "
        "podman exec caddy sh -c 'set -a; . /run/credentials/homelab-caddy.service/cloudflare-api-token; "
        "set +a; caddy validate --config /etc/caddy/Caddyfile; caddy reload --config /etc/caddy/Caddyfile'; "
        "systemctl is-active homelab-voxpilot-speech.service"
    )
    print("Chapel speech service and HTTPS development preview wiring deployed.")
    print(
        "Runtime /run overrides disappear on reboot. No production or OpenCode service changes."
    )


if __name__ == "__main__":
    main()
