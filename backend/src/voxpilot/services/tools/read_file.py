"""read_file tool — read the contents of a file with line numbers."""

from pathlib import Path
from typing import Any, ClassVar

from voxpilot.services.tools.base import Tool

MAX_FILE_SIZE = 100_000  # 100 KB


class ReadFileTool(Tool):
    """Read a file's contents, optionally a line range."""

    name = "read_file"
    description = (
        "Read the contents of a file relative to the working directory. "
        "Returns the file contents with line numbers. "
        "Optionally specify start_line and end_line (1-based, inclusive) to read a range."
    )
    parameters: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "File path relative to the working directory.",
            },
            "start_line": {
                "type": "integer",
                "description": (
                    "First line to read (1-based, inclusive). "
                    "Omit to start from the beginning."
                ),
            },
            "end_line": {
                "type": "integer",
                "description": "Last line to read (1-based, inclusive). Omit to read to the end.",
            },
        },
        "required": ["path"],
        "additionalProperties": False,
    }

    async def execute(self, arguments: dict[str, Any], work_dir: Path) -> str:
        """Read a file and return its contents with line numbers."""
        raw_path: str = arguments.get("path", "")
        if not raw_path:
            return "Error: 'path' argument is required."

        resolved = self._resolve_path(raw_path, work_dir)
        if resolved is None:
            return f"Error: path '{raw_path}' is outside the working directory."

        if not resolved.exists():
            return f"Error: file '{raw_path}' does not exist."
        if not resolved.is_file():
            return f"Error: '{raw_path}' is not a file."

        # Check file size
        size = resolved.stat().st_size
        if size > MAX_FILE_SIZE:
            return (
                f"Error: file '{raw_path}' is {size:,} bytes "
                f"(limit is {MAX_FILE_SIZE:,} bytes). "
                "Use start_line/end_line to read a portion."
            )

        try:
            text = resolved.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            return f"Error reading '{raw_path}': {exc}"

        lines = text.splitlines()
        total = len(lines)

        start: int = arguments.get("start_line", 1)
        end: int = arguments.get("end_line", total)

        # Clamp to valid range
        start = max(1, start)
        end = min(total, end)

        if start > end:
            return f"Error: start_line ({start}) > end_line ({end}). File has {total} lines."

        selected = lines[start - 1 : end]
        width = len(str(end))
        numbered = [f"{i:{width}d} | {line}" for i, line in enumerate(selected, start=start)]
        header = f"File: {raw_path} (lines {start}-{end} of {total})\n"
        return header + "\n".join(numbered)
