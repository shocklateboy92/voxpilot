# VoxPilot Design System

Mobile-first, dark-by-default UI built with plain CSS custom properties, SolidJS, and Lucide icons. No external component library.

## Tokens

All colors are CSS custom properties on `:root`. Dark values are the default; light values are set via `@media (prefers-color-scheme: light)`. **Never use raw hex/rgba values outside `:root`.**

### Surfaces & Text

| Token                   | Semantic meaning                                       |
| ----------------------- | ------------------------------------------------------ |
| `--color-bg`            | Page background                                        |
| `--color-surface`       | Cards, panels, assistant message bubbles               |
| `--color-surface-dark`  | Recessed containers (tool blocks, changeset cards)     |
| `--color-text`          | Primary text                                           |
| `--color-muted`         | Secondary text, labels, placeholders                   |
| `--color-white`         | Text on colored backgrounds (buttons, active segments) |
| `--color-border`        | Standard borders between sections                      |
| `--color-option-bg`     | Interactive option/input backgrounds                   |
| `--color-option-border` | Interactive option/input borders                       |

### Semantic Colors

| Token                    | Semantic meaning                             |
| ------------------------ | -------------------------------------------- |
| `--color-accent`         | Primary action (buttons, links, focus rings) |
| `--color-accent-hover`   | Primary action hover state                   |
| `--color-ok`             | Success text/icons                           |
| `--color-ok-dark`        | Success button background                    |
| `--color-ok-hover`       | Success button hover                         |
| `--color-error`          | Error text/icons/borders                     |
| `--color-warning`        | Warning borders, confirmation prompts        |
| `--color-info`           | Informational accent (question blocks)       |
| `--color-info-light`     | Info heading text                            |
| `--color-info-dark`      | Info selected state background               |
| `--color-reject`         | Reject/dismiss button background             |
| `--color-reject-hover`   | Reject button hover                          |
| `--color-context-warn`   | Context usage warning level                  |
| `--color-toast-error-bg` | Error toast background                       |

### Overlay & Glass

| Token                   | Semantic meaning                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `--color-glass`         | Frosted glass background (status bar, input bar, agent picker). Uses `backdrop-filter: blur(12px)`. |
| `--color-overlay`       | Modal/sheet backdrop                                                                                |
| `--color-subtle-border` | Hairline dividers (hr, badge borders)                                                               |
| `--color-subtle-bg`     | Very faint backgrounds (table headers, badges)                                                      |
| `--color-code-bg`       | Inline code background                                                                              |
| `--color-code-block-bg` | Fenced code block background                                                                        |

### Diff Colors

| Token                    | Semantic meaning            |
| ------------------------ | --------------------------- |
| `--color-diff-add-bg`    | Added line background       |
| `--color-diff-del-bg`    | Deleted line background     |
| `--color-diff-hunk-bg`   | Hunk header background      |
| `--color-diff-header-bg` | File header background      |
| `--color-diff-divider`   | Diff section dividers       |
| `--color-table-border`   | Markdown table cell borders |

### Chat

| Token                   | Semantic meaning               |
| ----------------------- | ------------------------------ |
| `--color-user-msg`      | User message bubble background |
| `--color-assistant-msg` | Assistant message background   |

### Non-Color Tokens

| Token                 | Value                                        |
| --------------------- | -------------------------------------------- |
| `--font-sans`         | System sans-serif stack                      |
| `--font-mono`         | Monospace stack (code, tool names, git refs) |
| `--safe-bottom`       | iOS safe area inset                          |
| `--bottom-nav-height` | Bottom navigation bar height (48px)          |

## Buttons

All buttons use the `.btn` base class with optional modifiers. Combine them:

```html
<button class="btn">Default (blue)</button>
<button class="btn btn-success btn-sm">Allow once</button>
<button class="btn btn-danger btn-sm">Reject</button>
<button class="btn btn-ghost">✕</button>
<button class="btn btn-icon"><Plus size="{20}" /></button>
```

| Class          | Purpose                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| `.btn`         | Base — blue accent background, white text, rounded corners                      |
| `.btn-success` | Green background — approval, allow, submit actions                              |
| `.btn-danger`  | Gray background — reject, dismiss actions                                       |
| `.btn-ghost`   | No background — close buttons, subtle actions. Muted text, highlights on hover. |
| `.btn-icon`    | Circular (50%), 2rem — icon-only buttons (send, new chat)                       |
| `.btn-sm`      | Compact padding/font — use inside tool confirm and question blocks              |

## Icons

Use [Lucide](https://lucide.dev/) via `lucide-solid`. Import individual icons:

```tsx
import { Settings, Check, X, Loader } from "lucide-solid";

<Settings size={14} />
<Loader size={14} class="icon-spin" />
```

Conventions:

- `size={14}` for inline icons in tool blocks, badges, status indicators
- `size={18}` for button icons (send, close overlay)
- `size={20}` for nav buttons (new chat)
- `size={24}` for large indicators (swipe arrows)
- Add `class="icon-spin"` to `<Loader>` for animated spinners

CSS pseudo-content (`::before`, `::after`) is still used for:

- Disclosure triangles on `<details>` (▸/▾)
- Dropdown caret on session title button (▾)
- Streaming cursor (▊)

These are fine as unicode — they're typographic, not iconographic.

## Theming

The app respects `prefers-color-scheme` automatically. When adding a new color:

1. Add the dark value to `:root` in the "Design Tokens" section
2. Add the light value to the `@media (prefers-color-scheme: light)` block
3. Use `var(--color-your-token)` everywhere else

Test both themes. The `color-scheme: light dark` declaration on `:root` tells the browser to adapt native UI elements (scrollbars, form controls) automatically.

## CSS Structure

`style.css` is organized into 14 sections:

1. **Design Tokens** — `:root` variables and light theme overrides
2. **Reset & Base** — box-sizing, html/body, root
3. **Typography & Markdown** — `.markdown-body` descendants
4. **Buttons** — `.btn` and all variants
5. **Layout** — app shell, status bar, bottom nav
6. **Chat** — messages, bubbles, input, swipe arrows
7. **Agent Picker** — segmented control
8. **Tool Blocks & Confirmations** — tool call display, permission prompts
9. **Question Blocks** — AI question prompts
10. **Session Picker** — bottom sheet overlay
11. **Changesets & Review** — diff viewer, file lists
12. **Context Bar** — token usage display
13. **Toasts** — notification system
14. **Animations** — keyframes, `.icon-spin`

### Rules

- **No raw colors outside `:root`.** Always use `var(--color-*)`.
- **No ID selectors.** Use classes. Only exception: `#root` (Solid mount point).
- **No `@media` breakpoints.** This is a mobile-only app.
- **Max 1 blank line** between selectors within a section.
- New selectors go in the appropriate numbered section.
