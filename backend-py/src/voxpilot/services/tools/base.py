"""Abstract base class for agent tools."""

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, ClassVar

from openai.types.chat import ChatCompletionToolParam


class Tool(ABC):
    """Base class for all agent tools.

    Subclasses must define ``name``, ``description``, ``parameters``
    (a JSON Schema dict), and implement ``execute()``.
    """

    name: str
    description: str
    parameters: ClassVar[dict[str, Any]]

    # Forward-looking hook for Phase 3 (write tools / shell).
    requires_confirmation: bool = False

    @abstractmethod
    async def execute(self, arguments: dict[str, Any], work_dir: Path) -> str:
        """Run the tool and return a text result.

        Must not raise — return an error description string instead.
        *work_dir* is the project root that all paths are resolved against.
        """

    def to_openai_tool(self) -> ChatCompletionToolParam:
        """Return the tool definition in OpenAI function-calling format."""
        return ChatCompletionToolParam(
            type="function",
            function={
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        )

    def _resolve_path(self, raw: str, work_dir: Path) -> Path | None:
        """Resolve *raw* relative to *work_dir* and validate it stays inside.

        Returns ``None`` if the resolved path escapes *work_dir*.
        """
        resolved = (work_dir / raw).resolve()
        try:
            resolved.relative_to(work_dir.resolve())
        except ValueError:
            return None
        return resolved
