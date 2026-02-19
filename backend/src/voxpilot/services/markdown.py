"""Server-side Markdown → HTML rendering via markdown-it-py.

Uses a module-level ``MarkdownIt`` instance with sensible defaults.
The renderer is intentionally customisable — callers can register
custom render rules (e.g. to replace the default ``fence`` handler
for syntax-highlighted code blocks) via :func:`set_fence_renderer`
or the lower-level :func:`get_renderer` escape hatch.

Example — replacing the code-fence renderer::

    from voxpilot.services.markdown import set_fence_renderer

    def my_fence(tokens, idx, options, env):
        token = tokens[idx]
        lang = token.info.strip() if token.info else ""
        code = token.content
        return f'<pre data-lang="{lang}"><code>{code}</code></pre>'

    set_fence_renderer(my_fence)
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from markdown_it import MarkdownIt
from markdown_it.renderer import RendererHTML, RendererProtocol

if TYPE_CHECKING:
    from collections.abc import Sequence

    from markdown_it.token import Token
    from markdown_it.utils import EnvType, OptionsDict

# ── Types for custom render rules ────────────────────────────────────────────


class RenderRule(Protocol):
    """Signature accepted by ``RendererHTML.rules``."""

    def __call__(
        self,
        renderer: RendererProtocol,
        tokens: Sequence[Token],
        idx: int,
        options: OptionsDict,
        env: EnvType,
    ) -> str: ...


# ── Module-level instance ────────────────────────────────────────────────────

_md = MarkdownIt("commonmark", {"html": False, "typographer": True})
_md.enable("table")


def get_renderer() -> MarkdownIt:
    """Return the singleton ``MarkdownIt`` instance for advanced tweaks."""
    return _md


def set_fence_renderer(rule: RenderRule) -> None:
    """Override the ``fence`` (fenced code block) render rule.

    This is the primary extensibility hook — use it to plug in your
    own syntax highlighter when richer context is available.
    """
    renderer = _md.renderer
    if not isinstance(renderer, RendererHTML):
        msg = "Cannot override rules on a non-HTML renderer"
        raise TypeError(msg)
    renderer.rules["fence"] = rule  # pyright: ignore[reportArgumentType]


def set_render_rule(name: str, rule: RenderRule) -> None:
    """Override an arbitrary render rule by token name.

    Common token names: ``fence``, ``code_inline``, ``code_block``,
    ``image``, ``link_open``, ``heading_open``, etc.
    """
    renderer = _md.renderer
    if not isinstance(renderer, RendererHTML):
        msg = "Cannot override rules on a non-HTML renderer"
        raise TypeError(msg)
    renderer.rules[name] = rule  # pyright: ignore[reportArgumentType]


# ── Public API ────────────────────────────────────────────────────────────────


def render_markdown(text: str) -> str:
    """Render a Markdown string to HTML.

    Returns an empty string for empty / whitespace-only input.
    """
    if not text or not text.strip():
        return ""
    return _md.render(text)
