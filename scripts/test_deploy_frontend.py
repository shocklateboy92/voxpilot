import hashlib
import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import unquote, urlsplit

spec = importlib.util.spec_from_file_location(
    "deploy_frontend", Path(__file__).with_name("deploy-frontend.py")
)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class WebDAV:
    def __init__(self):
        self.files = {"assets/old.js": b"old", "index.html": b"old index"}
        self.calls = []
        self.fail_move = False
        self.corrupt_assets = False

    def relative(self, url):
        path = unquote(urlsplit(url).path)
        return path.split("/voxpilot/", 1)[1] if "/voxpilot/" in path else ""

    def request(self, method, url, data=None, headers=None):
        name = self.relative(url)
        self.calls.append((method, name))
        if method == "GET":
            if name not in self.files:
                return 404, b""
            body = self.files[name]
            if self.corrupt_assets and name.startswith("assets/new"):
                body = b"corrupted"
            return 200, body
        if method == "MKCOL":
            return 201, b""
        if method == "PUT":
            self.files[name] = data
            return 201, b""
        if method == "MOVE":
            if self.fail_move:
                raise RuntimeError("MOVE failed")
            destination = self.relative(headers["Destination"])
            self.files[destination] = self.files.pop(name)
            self.calls.append(("activated", destination))
            return 204, b""
        if method == "DELETE":
            del self.files[name]
            return 204, b""
        raise AssertionError(method)


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.server = WebDAV()
        self.publisher = deploy.Publisher(deploy.PUSH_URL, deploy.READ_URL)
        self.files = {
            "assets/new.js": b"new",
            "assets/fonts/a font.woff2": b"font",
            "icon.svg": b"icon",
            "index.html": b"new index",
        }
        self.mock = patch.object(deploy, "request", self.server.request)
        self.mock.start()
        self.addCleanup(self.mock.stop)

    def test_assets_first_index_last_and_old_assets_retained(self):
        self.publisher.publish(self.files)
        activated = [
            name for method, name in self.server.calls if method == "activated"
        ]
        self.assertEqual(activated[-1], "index.html")
        self.assertEqual(
            activated[:2],
            sorted(name for name in self.files if name.startswith("assets/")),
        )
        self.assertEqual(self.server.files["assets/old.js"], b"old")
        self.assertEqual(self.server.files["index.html"], b"new index")
        self.assertFalse(any(".upload-" in name for name in self.server.files))

    def test_existing_identical_assets_are_not_uploaded(self):
        self.server.files.update(self.files)
        self.publisher.publish(self.files)
        self.assertFalse(
            any(
                method == "PUT" and name.startswith("assets/")
                for method, name in self.server.calls
            )
        )

    def test_collision_fails_before_any_writes(self):
        self.server.files["assets/new.js"] = b"different"
        with self.assertRaisesRegex(RuntimeError, "collision"):
            self.publisher.publish(self.files)
        self.assertTrue(all(method == "GET" for method, _ in self.server.calls))
        self.assertEqual(self.server.files["index.html"], b"old index")

    def test_failed_move_preserves_index_and_cleans_temporary_file(self):
        self.server.fail_move = True
        with self.assertRaisesRegex(RuntimeError, "MOVE failed"):
            self.publisher.publish(self.files)
        self.assertEqual(self.server.files["index.html"], b"old index")
        self.assertFalse(any(".upload-" in name for name in self.server.files))

    def test_asset_readback_failure_preserves_index(self):
        self.server.corrupt_assets = True
        with self.assertRaisesRegex(RuntimeError, "verification failed"):
            self.publisher.publish(self.files)
        self.assertEqual(self.server.files["index.html"], b"old index")

    def test_urls_must_be_scoped(self):
        with self.assertRaisesRegex(RuntimeError, "scoped"):
            deploy.Publisher(
                "https://push.apps.lasath.com/homelab/mccoy", deploy.READ_URL
            )


class InputTests(unittest.TestCase):
    def test_credentials_missing_index_and_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with self.assertRaisesRegex(RuntimeError, "index.html"):
                deploy.frontend_files(directory)
            (directory / "index.html").write_text("index")
            (directory / "config.json").write_text("secret")
            with self.assertRaisesRegex(RuntimeError, "credentials"):
                deploy.frontend_files(directory)
            (directory / "config.json").unlink()
            (directory / "link").symlink_to("index.html")
            with self.assertRaisesRegex(RuntimeError, "Unsupported"):
                deploy.frontend_files(directory)

    def release_responses(self, archive, checksum=None):
        filename = "voxpilot-frontend-0.1.1+abc.tar.gz"
        metadata = {
            "tag_name": "v0.1.1+abc",
            "assets": [
                {
                    "name": filename,
                    "browser_download_url": "https://example.test/archive",
                },
                {
                    "name": filename + ".sha256",
                    "browser_download_url": "https://example.test/checksum",
                },
            ],
        }
        checksum = checksum or hashlib.sha256(archive).hexdigest()
        return [
            json.dumps(metadata).encode(),
            archive,
            f"{checksum}  {filename}\n".encode(),
        ]

    def archive(self, name="./index.html", kind=tarfile.REGTYPE):
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w:gz") as archive:
            member = tarfile.TarInfo(name)
            member.type = kind
            if kind == tarfile.REGTYPE:
                member.size = 5
                archive.addfile(member, io.BytesIO(b"index"))
            else:
                member.linkname = "index.html"
                archive.addfile(member)
        return output.getvalue()

    def test_release_checksum_and_safe_extraction(self):
        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(
                deploy,
                "checked_request",
                side_effect=self.release_responses(self.archive()),
            ):
                directory = deploy.download_release("latest", Path(temporary))
            self.assertEqual(deploy.frontend_files(directory), {"index.html": b"index"})

    def test_checksum_mismatch(self):
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.object(
                deploy,
                "checked_request",
                side_effect=self.release_responses(self.archive(), "0" * 64),
            ),
            self.assertRaisesRegex(RuntimeError, "checksum mismatch"),
        ):
            deploy.download_release("latest", Path(temporary))

    def test_traversal_links_and_absolute_paths(self):
        for name, kind in [
            ("../outside", tarfile.REGTYPE),
            ("/outside", tarfile.REGTYPE),
            ("link", tarfile.SYMTYPE),
        ]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                responses = self.release_responses(self.archive(name, kind))
                with (
                    patch.object(deploy, "checked_request", side_effect=responses),
                    self.assertRaisesRegex(RuntimeError, "Unsafe archive"),
                ):
                    deploy.download_release("latest", Path(temporary))


if __name__ == "__main__":
    unittest.main()
