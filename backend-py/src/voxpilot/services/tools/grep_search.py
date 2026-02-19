"""grep_search tool — search file contents by regex pattern."""

import re
from pathlib import Path
from typing import Any, ClassVar

from voxpilot.services.tools.base import Tool

# Directories to skip when walking
_SKIP_DIRS = {
    ".git",
    "__pycache__",
    "node_modules",
    ".venv",
    "venv",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
}

MAX_MATCHES = 200
MAX_LINE_LENGTH = 500


class GrepSearchTool(Tool):
    """Search file contents by regex pattern."""

    name = "grep_search"
    description = (
        "Search for a regex pattern in file contents within the working directory. "
        "Returns matching lines with file paths and line numbers. "
        "Optionally restrict to a subdirectory and/or glob file pattern."
    )
    parameters: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "pattern": {
                "type": "string",
                "description": "Regular expression pattern to search for.",
            },
            "path": {
                "type": "string",
                "description": (
                    "Subdirectory to search within (relative to working directory). "
                    "Defaults to '.' (entire working directory)."
                ),
            },
            "include": {
                "type": "string",
                "description": (
                    "Glob pattern to filter files (e.g., '*.py', '*.ts'). "
                    "If omitted, searches all text files."
                ),
            },
        },
        "required": ["pattern"],
        "additionalProperties": False,
    }

    async def execute(self, arguments: dict[str, Any], work_dir: Path) -> str:
        """Search for a regex pattern in files."""
        pattern_str: str = arguments.get("pattern", "")
        if not pattern_str:
            return "Error: 'pattern' argument is required."

        try:
            regex = re.compile(pattern_str, re.IGNORECASE)
        except re.error as exc:
            return f"Error: invalid regex pattern '{pattern_str}': {exc}"

        raw_path: str = arguments.get("path", ".")
        resolved = self._resolve_path(raw_path, work_dir)
        if resolved is None:
            return f"Error: path '{raw_path}' is outside the working directory."
        if not resolved.exists():
            return f"Error: path '{raw_path}' does not exist."

        include: str | None = arguments.get("include")
        matches: list[str] = []
        files_searched = 0

        for file_path in self._walk_files(resolved, include):
            files_searched += 1
            try:
                text = file_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue

            rel = file_path.relative_to(work_dir.resolve())
            for line_no, line in enumerate(text.splitlines(), start=1):
                if regex.search(line):
                    display = line[:MAX_LINE_LENGTH]
                    if len(line) > MAX_LINE_LENGTH:
                        display += "..."
                    matches.append(f"{rel}:{line_no}: {display}")
                    if len(matches) >= MAX_MATCHES:
                        matches.append(
                            f"... (truncated at {MAX_MATCHES} matches)"
                        )
                        return self._format_result(
                            pattern_str, matches, files_searched
                        )

        return self._format_result(pattern_str, matches, files_searched)

    def _walk_files(self, root: Path, include: str | None) -> list[Path]:
        """Collect files to search, respecting skip dirs and optional glob."""
        files: list[Path] = []
        if root.is_file():
            files.append(root)
            return files

        for entry in sorted(root.rglob("*")):
            # Skip noise directories
            if any(part in _SKIP_DIRS for part in entry.parts):
                continue
            if not entry.is_file():
                continue
            # Apply include glob filter
            if include and not entry.match(include):
                continue
            # Skip likely binary files
            if self._is_likely_binary(entry):
                continue
            files.append(entry)
        return files

    @staticmethod
    def _is_likely_binary(path: Path) -> bool:
        """Heuristic: skip files with common binary extensions."""
        binary_exts = {
            ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg",
            ".woff", ".woff2", ".ttf", ".eot",
            ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z",
            ".exe", ".dll", ".so", ".dylib", ".o", ".a",
            ".pyc", ".pyo", ".class", ".jar",
            ".db", ".sqlite", ".sqlite3",
            ".pdf", ".doc", ".docx", ".xls", ".xlsx",
            ".mp3", ".mp4", ".avi", ".mov", ".wav",
        }
        return path.suffix.lower() in binary_exts

    @staticmethod
    def _format_result(
        pattern: str, matches: list[str], files_searched: int
    ) -> str:
        if not matches:
            return f"No matches found for pattern '{pattern}' ({files_searched} files searched)."
        header = (
            f"Found {len(matches)} match(es) for '{pattern}'"
            f" ({files_searched} files searched):\n"
        )
        return header + "\n".join(matches)
