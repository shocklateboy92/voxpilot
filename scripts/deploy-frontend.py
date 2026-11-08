"""Publish a frontend release over LAN-only WebDAV, without tenant SSH."""

import argparse
import hashlib
import json
import re
import sys
import tarfile
import tempfile
import uuid
from pathlib import Path, PurePosixPath
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

PUSH_URL = "https://push.apps.lasath.com/voxpilot"
READ_URL = "https://static.apps.lasath.com/sysupdate/voxpilot"
RELEASE_API = "https://api.github.com/repos/shocklateboy92/voxpilot/releases"


def request(method, url, data=None, headers=None):
    headers = {
        "User-Agent": "voxpilot-deploy",
        "Cache-Control": "no-cache",
        **(headers or {}),
    }
    try:
        with urlopen(
            Request(url, data=data, headers=headers, method=method), timeout=120
        ) as response:
            return response.status, response.read()
    except HTTPError as error:
        if error.code in (404, 405):
            return error.code, b""
        raise RuntimeError(f"{method} {url}: HTTP {error.code}") from error


def checked_request(method, url, data=None, headers=None):
    status, body = request(method, url, data, headers)
    if not 200 <= status < 300:
        raise RuntimeError(f"{method} {url}: HTTP {status}")
    return body


def download_release(release, directory):
    tag = release if release.startswith("v") else f"v{release}"
    api = (
        f"{RELEASE_API}/latest"
        if release == "latest"
        else f"{RELEASE_API}/tags/{quote(tag, safe='')}"
    )
    metadata = json.loads(checked_request("GET", api))
    version = metadata["tag_name"].removeprefix("v")
    if not re.fullmatch(r"[A-Za-z0-9.+_-]+", version):
        raise RuntimeError("Release version contains unsafe characters")
    filename = f"voxpilot-frontend-{version}.tar.gz"
    assets = {
        asset["name"]: asset["browser_download_url"] for asset in metadata["assets"]
    }
    if filename not in assets or f"{filename}.sha256" not in assets:
        raise RuntimeError(f"Release {version} has no checksummed frontend artifact")
    archive = directory / filename
    archive.write_bytes(checked_request("GET", assets[filename]))
    checksum = checked_request("GET", assets[f"{filename}.sha256"]).decode().strip()
    match = re.fullmatch(r"([0-9a-fA-F]{64})\s+\*?(.+)", checksum)
    if match is None or match[2] != filename:
        raise RuntimeError("Invalid frontend checksum file")
    if hashlib.sha256(archive.read_bytes()).hexdigest() != match[1].lower():
        raise RuntimeError("Frontend artifact checksum mismatch")
    destination = directory / "frontend"
    destination.mkdir()
    with tarfile.open(archive, "r:gz") as source:
        for member in source.getmembers():
            path = PurePosixPath(member.name)
            if (
                path.is_absolute()
                or ".." in path.parts
                or not (member.isfile() or member.isdir())
            ):
                raise RuntimeError(f"Unsafe archive member: {member.name}")
        source.extractall(destination, filter="data")
    print(f"Release: {version}", flush=True)
    return destination


def frontend_files(directory):
    files = {}
    for path in sorted(directory.rglob("*")):
        relative = path.relative_to(directory).as_posix()
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise RuntimeError(f"Unsupported frontend entry: {relative}")
        if path.is_dir():
            continue
        if any(part.startswith(".") for part in PurePosixPath(relative).parts):
            raise RuntimeError(f"Hidden frontend file: {relative}")
        if relative == "config.json":
            raise RuntimeError(
                "config.json belongs to the server; never publish credentials"
            )
        files[relative] = path.read_bytes()
    if not files.get("index.html"):
        raise RuntimeError("Frontend directory has no nonempty index.html")
    return files


class Publisher:
    def __init__(self, push_url, read_url):
        self.push_url = push_url.rstrip("/")
        self.read_url = read_url.rstrip("/")
        for url in (self.push_url, self.read_url):
            parsed = urlsplit(url)
            if (
                parsed.scheme not in ("http", "https")
                or not parsed.netloc
                or parsed.query
                or parsed.fragment
            ):
                raise RuntimeError(
                    "Publish URLs must be HTTP(S) directory URLs without query or fragment"
                )
            if not parsed.path.endswith("/voxpilot"):
                raise RuntimeError(
                    "Publish URLs must be scoped to a /voxpilot directory"
                )
        self.directories = set()

    def url(self, base, relative):
        return f"{base}/{quote(relative, safe='/')}"

    def mkdir(self, relative):
        if relative in self.directories:
            return
        if relative:
            parent = str(PurePosixPath(relative).parent)
            self.mkdir("" if parent == "." else parent)
        url = self.url(self.push_url, relative).rstrip("/") + "/"
        status, _ = request("MKCOL", url)
        if status not in (200, 201, 204, 405):
            raise RuntimeError(f"MKCOL {url}: HTTP {status}")
        self.directories.add(relative)

    def atomic_put(self, relative, data):
        parent = str(PurePosixPath(relative).parent)
        self.mkdir("" if parent == "." else parent)
        temporary = f"{relative}.upload-{uuid.uuid4().hex}"
        temporary_url = self.url(self.push_url, temporary)
        destination = self.url(self.push_url, relative)
        checked_request("PUT", temporary_url, data)
        try:
            checked_request(
                "MOVE",
                temporary_url,
                headers={"Destination": destination, "Overwrite": "T"},
            )
        except Exception:
            # Only remove the temporary object created by this invocation.
            try:
                checked_request("DELETE", temporary_url)
            except (OSError, RuntimeError) as error:
                print(
                    f"Could not remove temporary upload {temporary}: {error}",
                    file=sys.stderr,
                )
            raise

    def publish(self, files):
        assets = sorted(name for name in files if name.startswith("assets/"))
        pending = []
        # Check every immutable name before changing any live files.
        for name in assets:
            status, existing = request("GET", self.url(self.read_url, name))
            if status == 404:
                pending.append(name)
            elif status != 200 or existing != files[name]:
                raise RuntimeError(
                    f"Immutable asset collision or unreadable asset: {name}"
                )
        self.mkdir("")
        for name in pending:
            print(f"Upload {name}", flush=True)
            self.atomic_put(name, files[name])
        for name in assets:
            if checked_request("GET", self.url(self.read_url, name)) != files[name]:
                raise RuntimeError(f"Published asset verification failed: {name}")
        for name in sorted(files):
            if name == "index.html" or name.startswith("assets/"):
                continue
            print(f"Upload {name}", flush=True)
            self.atomic_put(name, files[name])
        print("Publish index.html", flush=True)
        self.atomic_put("index.html", files["index.html"])
        if (
            checked_request("GET", self.url(self.read_url, "index.html"))
            != files["index.html"]
        ):
            raise RuntimeError("Published index.html verification failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument(
        "--release", default="latest", help="GitHub release version or latest (default)"
    )
    source.add_argument(
        "--directory", type=Path, help="publish an already-built frontend/dist instead"
    )
    parser.add_argument("--push-url", default=PUSH_URL)
    parser.add_argument("--read-url", default=READ_URL)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="validate and list files without contacting the publishing server",
    )
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="voxpilot-deploy-") as temporary:
        directory = args.directory or download_release(args.release, Path(temporary))
        files = frontend_files(directory)
        publisher = Publisher(args.push_url, args.read_url)
        if args.dry_run:
            print(
                f"Would publish {len(files)} files to {publisher.push_url}/; index.html last"
            )
            return
        publisher.publish(files)
        print(f"Published and verified: {publisher.read_url}/index.html")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError, tarfile.TarError) as error:
        print(f"deploy-frontend: {error}", file=sys.stderr)
        sys.exit(1)
