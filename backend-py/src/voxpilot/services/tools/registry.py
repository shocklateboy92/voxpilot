"""Tool registry — maps tool names to Tool instances."""

from openai.types.chat import ChatCompletionToolParam

from voxpilot.services.tools.base import Tool


class ToolRegistry:
    """Registry of available tools, keyed by name."""

    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        """Register a tool (overwrites if name already exists)."""
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool | None:
        """Return the tool with *name*, or ``None``."""
        return self._tools.get(name)

    def all(self) -> list[Tool]:
        """Return all registered tools."""
        return list(self._tools.values())

    def to_openai_tools(self) -> list[ChatCompletionToolParam]:
        """Return all tools in OpenAI function-calling format."""
        return [t.to_openai_tool() for t in self._tools.values()]
