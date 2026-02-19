"""list_directory tool — list entries in a directory."""

from pathlib import Path
from typing import Any, ClassVar

from voxpilot.services.tools.base import Tool

# Directories to always skip when listing
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

MAX_ENTRIES = 500


class ListDirectoryTool(Tool):
    """List files and subdirectories in a directory."""

    name = "list_directory"
    description = (
        "List the contents of a directory relative to the working directory. "
        "Returns file and subdirectory names (directories end with '/'). "
        "Common noise directories (.git, __pycache__, node_modules, etc.) are skipped."
    )
    parameters: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": (
                    "Directory path relative to the working directory. "
                    "Defaults to '.' (the working directory itself)."
                ),
            },
        },
        "additionalProperties": False,
    }

    async def execute(self, arguments: dict[str, Any], work_dir: Path) -> str:
        """List a directory's contents."""
        raw_path: str = arguments.get("path", ".")
        resolved = self._resolve_path(raw_path, work_dir)
        if resolved is None:
            return f"Error: path '{raw_path}' is outside the working directory."

        if not resolved.exists():
            return f"Error: directory '{raw_path}' does not exist."
        if not resolved.is_dir():
            return f"Error: '{raw_path}' is not a directory."

        try:
            entries = sorted(resolved.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except OSError as exc:
            return f"Error listing '{raw_path}': {exc}"

        lines: list[str] = []
        for entry in entries:
            name = entry.name
            if name in _SKIP_DIRS and entry.is_dir():
                continue
            if entry.is_dir():
                lines.append(f"{name}/")
            else:
                lines.append(name)
            if len(lines) >= MAX_ENTRIES:
                lines.append(f"... (truncated at {MAX_ENTRIES} entries)")
                break

        if not lines:
            return f"Directory '{raw_path}' is empty."

        rel = resolved.relative_to(work_dir.resolve())
        header = f"Directory: {rel}/\n"
        return header + "\n".join(lines)
