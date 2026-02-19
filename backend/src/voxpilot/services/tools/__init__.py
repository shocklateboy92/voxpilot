"""Agent tool framework — base class, registry, and built-in tools."""

from voxpilot.services.tools.base import Tool
from voxpilot.services.tools.glob_search import GlobSearchTool
from voxpilot.services.tools.grep_search import GrepSearchTool
from voxpilot.services.tools.list_directory import ListDirectoryTool
from voxpilot.services.tools.read_file import ReadFileTool
from voxpilot.services.tools.read_file_external import ReadFileExternalTool
from voxpilot.services.tools.registry import ToolRegistry

__all__ = [
    "GlobSearchTool",
    "GrepSearchTool",
    "ListDirectoryTool",
    "ReadFileExternalTool",
    "ReadFileTool",
    "Tool",
    "ToolRegistry",
    "default_registry",
]


def _build_default_registry() -> ToolRegistry:
    """Create a registry with all built-in tools pre-registered."""
    reg = ToolRegistry()
    reg.register(ReadFileTool())
    reg.register(ListDirectoryTool())
    reg.register(GrepSearchTool())
    reg.register(GlobSearchTool())
    reg.register(ReadFileExternalTool())
    return reg


default_registry = _build_default_registry()
