"""Tests for read-only agent tools."""

from pathlib import Path

import pytest

from voxpilot.services.tools.glob_search import GlobSearchTool
from voxpilot.services.tools.grep_search import GrepSearchTool
from voxpilot.services.tools.list_directory import ListDirectoryTool
from voxpilot.services.tools.read_file import ReadFileTool
from voxpilot.services.tools.read_file_external import ReadFileExternalTool


@pytest.fixture
def work_dir(tmp_path: Path) -> Path:
    """Create a temporary working directory with test files."""
    # Create directory structure
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "main.py").write_text("# main\nprint('hello')\n")
    (tmp_path / "src" / "utils.py").write_text(
        "# utils\ndef helper():\n    return 42\n"
    )
    (tmp_path / "src" / "nested").mkdir()
    (tmp_path / "src" / "nested" / "deep.py").write_text("# deep\n")
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "README.md").write_text("# README\nSome docs.\n")
    (tmp_path / "README.md").write_text("# Project\nTop-level readme.\n")
    (tmp_path / ".gitignore").write_text("*.pyc\n")
    return tmp_path


# ── ReadFileTool ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_read_file_basic(work_dir: Path) -> None:
    tool = ReadFileTool()
    result = await tool.execute({"path": "README.md"}, work_dir)
    assert "# Project" in result
    assert "Top-level readme." in result
    assert "lines 1-2 of 2" in result


@pytest.mark.asyncio
async def test_read_file_with_line_numbers(work_dir: Path) -> None:
    tool = ReadFileTool()
    result = await tool.execute({"path": "src/utils.py"}, work_dir)
    assert "1 |" in result
    assert "2 |" in result
    assert "3 |" in result


@pytest.mark.asyncio
async def test_read_file_line_range(work_dir: Path) -> None:
    tool = ReadFileTool()
    result = await tool.execute(
        {"path": "src/utils.py", "start_line": 2, "end_line": 2}, work_dir
    )
    assert "def helper():" in result
    assert "# utils" not in result


@pytest.mark.asyncio
async def test_read_file_not_found(work_dir: Path) -> None:
    tool = ReadFileTool()
    result = await tool.execute({"path": "nonexistent.py"}, work_dir)
    assert result.startswith("Error:")
    assert "does not exist" in result


@pytest.mark.asyncio
async def test_read_file_path_traversal(work_dir: Path) -> None:
    tool = ReadFileTool()
    result = await tool.execute({"path": "../../../etc/passwd"}, work_dir)
    assert result.startswith("Error:")
    assert "outside" in result


@pytest.mark.asyncio
async def test_read_file_directory(work_dir: Path) -> None:
    tool = ReadFileTool()
    result = await tool.execute({"path": "src"}, work_dir)
    assert result.startswith("Error:")
    assert "not a file" in result


@pytest.mark.asyncio
async def test_read_file_missing_path_arg(work_dir: Path) -> None:
    tool = ReadFileTool()
    result = await tool.execute({}, work_dir)
    assert result.startswith("Error:")


@pytest.mark.asyncio
async def test_read_file_too_large(work_dir: Path) -> None:
    big_file = work_dir / "big.txt"
    big_file.write_text("x" * 200_000)
    tool = ReadFileTool()
    result = await tool.execute({"path": "big.txt"}, work_dir)
    assert result.startswith("Error:")
    assert "bytes" in result


@pytest.mark.asyncio
async def test_read_file_symlink_escape(work_dir: Path) -> None:
    """Symlinks pointing outside work_dir should be rejected."""
    link = work_dir / "escape_link"
    link.symlink_to("/etc/passwd")
    tool = ReadFileTool()
    result = await tool.execute({"path": "escape_link"}, work_dir)
    assert result.startswith("Error:")


# ── ListDirectoryTool ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_directory_root(work_dir: Path) -> None:
    tool = ListDirectoryTool()
    result = await tool.execute({"path": "."}, work_dir)
    assert "src/" in result
    assert "docs/" in result
    assert "README.md" in result


@pytest.mark.asyncio
async def test_list_directory_subdirectory(work_dir: Path) -> None:
    tool = ListDirectoryTool()
    result = await tool.execute({"path": "src"}, work_dir)
    assert "nested/" in result
    assert "main.py" in result
    assert "utils.py" in result


@pytest.mark.asyncio
async def test_list_directory_default_path(work_dir: Path) -> None:
    tool = ListDirectoryTool()
    result = await tool.execute({}, work_dir)
    assert "src/" in result


@pytest.mark.asyncio
async def test_list_directory_not_found(work_dir: Path) -> None:
    tool = ListDirectoryTool()
    result = await tool.execute({"path": "nonexistent"}, work_dir)
    assert result.startswith("Error:")


@pytest.mark.asyncio
async def test_list_directory_skips_pycache(work_dir: Path) -> None:
    (work_dir / "__pycache__").mkdir()
    (work_dir / "__pycache__" / "test.pyc").write_bytes(b"\x00")
    tool = ListDirectoryTool()
    result = await tool.execute({"path": "."}, work_dir)
    assert "__pycache__" not in result


@pytest.mark.asyncio
async def test_list_directory_path_traversal(work_dir: Path) -> None:
    tool = ListDirectoryTool()
    result = await tool.execute({"path": "../../.."}, work_dir)
    assert result.startswith("Error:")


@pytest.mark.asyncio
async def test_list_directory_dirs_first(work_dir: Path) -> None:
    """Directories should be listed before files."""
    tool = ListDirectoryTool()
    result = await tool.execute({"path": "."}, work_dir)
    lines = result.strip().split("\n")
    # Find first dir and first file (skip header)
    dir_indices = [i for i, ln in enumerate(lines) if ln.endswith("/")]
    file_indices = [
        i for i, ln in enumerate(lines)
        if not ln.endswith("/") and i > 0
    ]
    if dir_indices and file_indices:
        assert dir_indices[0] < file_indices[0]


# ── GrepSearchTool ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_grep_search_basic(work_dir: Path) -> None:
    tool = GrepSearchTool()
    result = await tool.execute({"pattern": "hello"}, work_dir)
    assert "main.py" in result
    assert "hello" in result


@pytest.mark.asyncio
async def test_grep_search_no_match(work_dir: Path) -> None:
    tool = GrepSearchTool()
    result = await tool.execute({"pattern": "nonexistent_string_xyz"}, work_dir)
    assert "No matches" in result


@pytest.mark.asyncio
async def test_grep_search_with_include(work_dir: Path) -> None:
    tool = GrepSearchTool()
    result = await tool.execute(
        {"pattern": "#", "include": "*.md"}, work_dir
    )
    assert "README.md" in result
    assert "main.py" not in result


@pytest.mark.asyncio
async def test_grep_search_with_path(work_dir: Path) -> None:
    tool = GrepSearchTool()
    result = await tool.execute({"pattern": "#", "path": "docs"}, work_dir)
    assert "docs" in result
    # Should not find the root README
    lines = [ln for ln in result.split("\n") if ln.startswith("README.md")]
    assert len(lines) == 0


@pytest.mark.asyncio
async def test_grep_search_invalid_regex(work_dir: Path) -> None:
    tool = GrepSearchTool()
    result = await tool.execute({"pattern": "[invalid"}, work_dir)
    assert result.startswith("Error:")
    assert "regex" in result.lower()


@pytest.mark.asyncio
async def test_grep_search_case_insensitive(work_dir: Path) -> None:
    tool = GrepSearchTool()
    result = await tool.execute({"pattern": "HELLO"}, work_dir)
    assert "main.py" in result


@pytest.mark.asyncio
async def test_grep_search_path_traversal(work_dir: Path) -> None:
    tool = GrepSearchTool()
    result = await tool.execute(
        {"pattern": "root", "path": "../../.."}, work_dir
    )
    assert result.startswith("Error:")


# ── GlobSearchTool ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_glob_search_basic(work_dir: Path) -> None:
    tool = GlobSearchTool()
    result = await tool.execute({"pattern": "**/*.py"}, work_dir)
    assert "src/main.py" in result
    assert "src/utils.py" in result
    assert "src/nested/deep.py" in result


@pytest.mark.asyncio
async def test_glob_search_md_files(work_dir: Path) -> None:
    tool = GlobSearchTool()
    result = await tool.execute({"pattern": "**/*.md"}, work_dir)
    assert "README.md" in result
    assert "docs/README.md" in result


@pytest.mark.asyncio
async def test_glob_search_with_path(work_dir: Path) -> None:
    tool = GlobSearchTool()
    result = await tool.execute({"pattern": "*.py", "path": "src"}, work_dir)
    assert "main.py" in result
    # Should not include deep files (non-recursive glob)
    assert "deep.py" not in result


@pytest.mark.asyncio
async def test_glob_search_no_match(work_dir: Path) -> None:
    tool = GlobSearchTool()
    result = await tool.execute({"pattern": "**/*.rs"}, work_dir)
    assert "No files found" in result


@pytest.mark.asyncio
async def test_glob_search_skips_pycache(work_dir: Path) -> None:
    (work_dir / "__pycache__").mkdir()
    (work_dir / "__pycache__" / "test.pyc").write_bytes(b"\x00")
    tool = GlobSearchTool()
    result = await tool.execute({"pattern": "**/*.pyc"}, work_dir)
    assert "No files found" in result


@pytest.mark.asyncio
async def test_glob_search_path_traversal(work_dir: Path) -> None:
    tool = GlobSearchTool()
    result = await tool.execute(
        {"pattern": "*.py", "path": "../../.."}, work_dir
    )
    assert result.startswith("Error:")


# ── Tool framework ───────────────────────────────────────────────────────────


def test_tool_registry() -> None:
    from voxpilot.services.tools import default_registry

    tools = default_registry.all()
    assert len(tools) == 5
    names = {t.name for t in tools}
    assert names == {
        "read_file", "list_directory", "grep_search",
        "glob_search", "read_file_external",
    }


def test_tool_openai_format() -> None:
    from voxpilot.services.tools import default_registry

    specs = default_registry.to_openai_tools()
    assert len(specs) == 5
    for spec in specs:
        assert spec["type"] == "function"
        assert "name" in spec["function"]
        assert "description" in spec["function"]
        assert "parameters" in spec["function"]


def test_tool_registry_get() -> None:
    from voxpilot.services.tools import default_registry

    tool = default_registry.get("read_file")
    assert tool is not None
    assert tool.name == "read_file"

    assert default_registry.get("nonexistent") is None


@pytest.mark.asyncio
async def test_read_file_absolute_path_rejected(work_dir: Path) -> None:
    """Absolute paths should be resolved relative to work_dir, but /etc/passwd should escape."""
    tool = ReadFileTool()
    result = await tool.execute({"path": "/etc/passwd"}, work_dir)
    # Depending on OS, this may resolve to work_dir/etc/passwd (not found)
    # or be detected as path traversal. Either way it should error.
    assert result.startswith("Error:")


@pytest.mark.asyncio
async def test_list_directory_empty(work_dir: Path) -> None:
    (work_dir / "empty").mkdir()
    tool = ListDirectoryTool()
    result = await tool.execute({"path": "empty"}, work_dir)
    assert "empty" in result.lower()


@pytest.mark.asyncio
async def test_read_file_binary_extension_allowed(work_dir: Path) -> None:
    """read_file should work with any readable text file regardless of extension."""
    (work_dir / "data.json").write_text('{"key": "value"}')
    tool = ReadFileTool()
    result = await tool.execute({"path": "data.json"}, work_dir)
    assert "key" in result


@pytest.mark.asyncio
async def test_grep_search_line_numbers(work_dir: Path) -> None:
    """Results should include file:line_number format."""
    tool = GrepSearchTool()
    result = await tool.execute({"pattern": "def helper"}, work_dir)
    assert ":2:" in result  # "def helper" is on line 2 of utils.py


@pytest.mark.asyncio
async def test_tool_requires_confirmation_default(work_dir: Path) -> None:
    """All Phase 2 read-only tools should not require confirmation."""
    tool = ReadFileTool()
    assert tool.requires_confirmation is False

    tool2 = ListDirectoryTool()
    assert tool2.requires_confirmation is False


@pytest.mark.asyncio
async def test_read_file_preserves_encoding(work_dir: Path) -> None:
    """UTF-8 content should be preserved."""
    (work_dir / "unicode.txt").write_text("Hello 🌍 世界\n", encoding="utf-8")
    tool = ReadFileTool()
    result = await tool.execute({"path": "unicode.txt"}, work_dir)
    assert "🌍" in result
    assert "世界" in result


@pytest.mark.asyncio
async def test_grep_skips_binary_files(work_dir: Path) -> None:
    """Binary files should be skipped by grep."""
    (work_dir / "image.png").write_bytes(b"\x89PNG\r\n" + b"\x00" * 100)
    tool = GrepSearchTool()
    result = await tool.execute({"pattern": "PNG"}, work_dir)
    assert "image.png" not in result


@pytest.mark.asyncio
async def test_glob_search_missing_pattern(work_dir: Path) -> None:
    tool = GlobSearchTool()
    result = await tool.execute({}, work_dir)
    assert result.startswith("Error:")


@pytest.mark.asyncio
async def test_grep_search_missing_pattern(work_dir: Path) -> None:
    tool = GrepSearchTool()
    result = await tool.execute({}, work_dir)
    assert result.startswith("Error:")


@pytest.mark.asyncio
async def test_read_file_start_greater_than_end(work_dir: Path) -> None:
    tool = ReadFileTool()
    result = await tool.execute(
        {"path": "README.md", "start_line": 5, "end_line": 1}, work_dir
    )
    assert result.startswith("Error:")


@pytest.mark.asyncio
async def test_symlink_within_work_dir_allowed(work_dir: Path) -> None:
    """Symlinks within work_dir should work fine."""
    (work_dir / "link.md").symlink_to(work_dir / "README.md")
    tool = ReadFileTool()
    result = await tool.execute({"path": "link.md"}, work_dir)
    assert "# Project" in result


@pytest.mark.asyncio
async def test_list_directory_file_not_dir(work_dir: Path) -> None:
    tool = ListDirectoryTool()
    result = await tool.execute({"path": "README.md"}, work_dir)
    assert result.startswith("Error:")
    assert "not a directory" in result


@pytest.mark.asyncio
async def test_glob_search_not_a_dir(work_dir: Path) -> None:
    tool = GlobSearchTool()
    result = await tool.execute(
        {"pattern": "*.py", "path": "README.md"}, work_dir
    )
    assert result.startswith("Error:")


# ── ReadFileExternalTool ──────────────────────────────────────────────────────


def test_read_file_external_requires_confirmation() -> None:
    tool = ReadFileExternalTool()
    assert tool.requires_confirmation is True


@pytest.mark.asyncio
async def test_read_file_external_reads_absolute_path(tmp_path: Path) -> None:
    """Should read a file by absolute path."""
    test_file = tmp_path / "external.txt"
    test_file.write_text("line one\nline two\n")

    tool = ReadFileExternalTool()
    result = await tool.execute({"path": str(test_file)}, tmp_path)
    assert "line one" in result
    assert "line two" in result
    assert "lines 1-2 of 2" in result


@pytest.mark.asyncio
async def test_read_file_external_file_not_found(tmp_path: Path) -> None:
    tool = ReadFileExternalTool()
    result = await tool.execute({"path": "/nonexistent/file.txt"}, tmp_path)
    assert result.startswith("Error:")
    assert "does not exist" in result


@pytest.mark.asyncio
async def test_read_file_external_line_range(tmp_path: Path) -> None:
    test_file = tmp_path / "multi.txt"
    test_file.write_text("a\nb\nc\nd\ne\n")

    tool = ReadFileExternalTool()
    result = await tool.execute(
        {"path": str(test_file), "start_line": 2, "end_line": 4}, tmp_path
    )
    assert "b" in result
    assert "c" in result
    assert "d" in result
    assert "lines 2-4 of 5" in result


@pytest.mark.asyncio
async def test_read_file_external_empty_path(tmp_path: Path) -> None:
    tool = ReadFileExternalTool()
    result = await tool.execute({"path": ""}, tmp_path)
    assert result.startswith("Error:")
