"""glob_search tool — find files matching a glob pattern."""

from pathlib import Path
from typing import Any, ClassVar

from voxpilot.services.tools.base import Tool

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

MAX_RESULTS = 500


class GlobSearchTool(Tool):
    """Find files matching a glob pattern."""

    name = "glob_search"
    description = (
        "Find files matching a glob pattern within the working directory. "
        "Returns matching file paths relative to the working directory. "
        "Use '**/' for recursive matching (e.g., '**/*.py' finds all Python files)."
    )
    parameters: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "pattern": {
                "type": "string",
                "description": "Glob pattern to match files (e.g., '**/*.py', 'src/**/*.ts').",
            },
            "path": {
                "type": "string",
                "description": (
                    "Subdirectory to search within (relative to working directory). "
                    "Defaults to '.' (entire working directory)."
                ),
            },
        },
        "required": ["pattern"],
        "additionalProperties": False,
    }

    async def execute(self, arguments: dict[str, Any], work_dir: Path) -> str:
        """Find files matching a glob pattern."""
        pattern: str = arguments.get("pattern", "")
        if not pattern:
            return "Error: 'pattern' argument is required."

        raw_path: str = arguments.get("path", ".")
        resolved = self._resolve_path(raw_path, work_dir)
        if resolved is None:
            return f"Error: path '{raw_path}' is outside the working directory."
        if not resolved.exists():
            return f"Error: path '{raw_path}' does not exist."
        if not resolved.is_dir():
            return f"Error: '{raw_path}' is not a directory."

        try:
            raw_matches = sorted(resolved.glob(pattern))
        except ValueError as exc:
            return f"Error: invalid glob pattern '{pattern}': {exc}"

        # Filter out skip dirs and non-files
        results: list[str] = []
        work_resolved = work_dir.resolve()
        for match in raw_matches:
            if any(part in _SKIP_DIRS for part in match.parts):
                continue
            if not match.is_file():
                continue
            rel = match.relative_to(work_resolved)
            results.append(str(rel))
            if len(results) >= MAX_RESULTS:
                results.append(f"... (truncated at {MAX_RESULTS} results)")
                break

        if not results:
            return f"No files found matching pattern '{pattern}'."

        header = f"Found {len(results)} file(s) matching '{pattern}':\n"
        return header + "\n".join(results)
