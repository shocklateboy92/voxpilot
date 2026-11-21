# VoxPilot Design System

Mobile-first, dark-by-default UI using SolidJS, Tailwind CSS 4, and Lucide icons.
The existing semantic palette is retained. There is no external component library.

## Where presentation belongs

- `src/ui/`: reusable, domain-independent controls. Consult its README before
  introducing a new primitive.
- `src/features/<feature>/`: feature components and local composition. For
  example, `ServerPicker` supplies data and callbacks to `SegmentedControl`.
- `src/app/`: the application shell and cross-feature composition.
- `src/styles/`: Tailwind entry point, tokens, generated-content styles, and
  exceptional cross-component browser behavior.

Use Tailwind utilities directly in TSX for layout and appearance. Extract a
component when it owns reusable presentation or interaction, not merely to wrap
`flex gap-2`. Domain-specific shared presentation stays with its feature (for
example, `features/chat/ComposerForm.tsx`).

## Tokens and themes

`src/styles/theme.css` defines semantic colors in `@theme static`. These generate
utilities such as `bg-surface`, `text-muted`, and `border-border`, and preserve
the CSS variables used by generated HTML and JavaScript. Light values override
the same variables under `:root[data-theme-ready]` and
`@media (prefers-color-scheme: light)`.

| Token / utility name | Purpose |
| --- | --- |
| `bg`, `surface`, `surface-dark` | Page, panel, and recessed surfaces |
| `text`, `muted`, `white` | Primary, secondary, and colored-button text |
| `border`, `subtle-border` | Standard borders and hairline dividers |
| `option-bg`, `option-border` | Form fields and selectable options |
| `accent`, `accent-hover` | Primary actions, links, selection, and focus |
| `ok`, `ok-dark`, `ok-hover` | Success text and approval buttons |
| `error`, `warning` | Errors and permission prompts |
| `reject`, `reject-hover` | Neutral dismissal buttons |
| `glass`, `overlay` | Frosted chrome and modal backdrops |
| `subtle-bg`, `code-bg`, `code-block-bg` | Badges and generated Markdown |
| `user-msg`, `assistant-msg` | Message surfaces |
| `diff-*`, `table-border` | Generated review and Markdown tables |
| `toast-error-bg` | Error notification surface |

- Keep raw colors in `theme.css`; the dark launch fallback in `index.html` is the
  exception. Runtime agent colors may be applied through `style` on badges.
- Use `font-sans` and `font-mono` to preserve the shared system font stacks.
- Prefer Tailwind's spacing/radius scale. Arbitrary values are appropriate for
  established compact typography, viewport calculations, and precise geometry.
- Theme changes should update tokens rather than adding `dark:` variants to
  every control.

The page stays dark without JavaScript. The head script sets `data-theme-ready`
and reads `--color-surface` for the browser's `theme-color`. Preserve both that
variable and the explicit layer order in the inline launch fallback; unlayered
fallback styles would override Tailwind's layered theme styling.

## Controls

```tsx
<Button variant="primary" onClick={save}>Save</Button>
<Button variant="success" size="sm">Allow once</Button>
<Button variant="reject" size="sm">Reject</Button>
<IconButton variant="ghost" aria-label="Close" onClick={close}>
  <X size={18} />
</IconButton>
```

`Button` variants are `neutral` (default), `floating`, `glass`, `primary`, `success`,
`reject`, `stop`, and `ghost`. Sizes are `md`, `sm`, `icon-sm`, `icon`, and `icon-lg`; prefer `IconButton` for
icon-only actions because it requires an accessible label. Button type defaults
to `button`; submit actions must explicitly use `type="submit"`.
Use `IconButton size="sm"` for compact status-bar actions; keep these in the
status bar's independent actions slot, never inside its disclosure button.
Use `floating` for neutral actions that sit directly over scrolling content.
It shares the status bar's tint and blur on each button, not on the row around
them. Keep solid semantic fills for colored actions such as Record and Stop.
Use `glass` for actions alongside composer selectors: the same tint and blur,
with the selectors' border and corner radius instead of a floating shadow.

`TextInput`, `Textarea`, and `Select` preserve native controls, refs, events, and
validation. `FormField` connects labels and optional help/error text to a control:

```tsx
<FormField label="Server URL" description="Your OpenCode server address">
  {(attributes) => <TextInput {...attributes} type="url" required />}
</FormField>
```

Use component props for appearance variants and `class` for caller-owned layout
(width, flex, margins). Do not pass utilities that conflict with a primitive's
internal styles and rely on class order: Tailwind's generated rule order wins,
not the order in the attribute. Add an explicit variant when needed.

Conditional classes use Solid's `classList`. Every utility must appear as a
complete literal for Tailwind's source scanner. Never construct names such as
`bg-${color}`. Keep genuinely runtime values (swipe offsets, textarea heights,
agent colors) in `style`. Use `splitProps` when forwarding DOM props so variants
stay reactive and aren't leaked into HTML.

## Icons and interaction

Import individual icons from `lucide-solid/icons/...`.

- 14px: inline tool icons and indicators.
- 18px: send/close icons.
- 20px: navigation icons.
- 24px: swipe arrows.
- `animate-spin`: busy icons.

Keep visible keyboard focus styles and native disabled behavior. Use
`ChoiceOption` and `SegmentedControl` for selections with `aria-pressed`.
`Overlay` provides a named dialog, focus containment/restoration, Escape, and
backdrop dismissal. Its header uses an accessible close button.

Composer action buttons prevent pointer-driven focus transfer so keyboard/nav
layout changes cannot move a button between pointer-down and click. Keyboard
activation still works normally.
When composing from a viewer, capture its selection before focus moves. Show the
excerpt as a previewable, removable draft chip, including in compact voice mode.
Enter inserts a newline in the composer on all devices; use Send to submit.

Async event errors go through the global rejection handler. Do not add per-control
try/catch blocks just to display error toasts.

## CSS exceptions and functional hooks

- `app.css`: imports Tailwind and the scoped styles, then sets page/root defaults.
- `theme.css`: colors, shared layout variables, fonts, shadows, and animations.
- `markdown.css`: typography for HTML produced by MarkdownIt. Explicit list
  styles preserve bullets/numbering after Tailwind Preflight.
- `diff.css`: the class contract with the plugin's generated diff HTML.
- `behaviors.css`: keyboard-aware navigation and light-theme status-bar shadow.
  Navigation uses the shell's explicit composer focus state, not `:has(:focus)`,
  to avoid stale WebKit focus styles when switching modes or backends.
  These contextual rules share the utilities layer so they can override layout
  utilities such as `flex`.

Keep `--safe-top`, `--safe-bottom`, `--bottom-nav-height`, and
`--status-bar-clearance` coordinated between the shell and composer.
On initial load, existing conversations start in reading mode below 400 CSS pixels
and with the composer expanded at wider widths. The chosen mode persists across
in-app conversation switches and viewport resizes. In reading mode, hide the
bottom navigation and selector rows, set `--bottom-nav-height` to zero, and
retain floating expand and voice/Stop controls.
Never switch modes based on scroll direction or blur.
Reading content extends to the bottom edge without a bottom fade or reserved
safe-area band; floating controls still respect `--safe-bottom`.
The composer stays mounted to preserve drafts and active microphone capture;
its compact recorder uses the same recording lifecycle as the expanded controls.
Chat, diff review and the file viewer share a single session footer, including
the server, model and thinking selectors. Switching panes preserves the current
mode, draft and recorder; only the background content becomes inert.
Keep review navigation reachable in the footer: show Resume review in chat
reading mode when there is a parked review, and Files in the review itself.
In expanded review, place Files beside the server selector (or model selector
when no server selector is shown), not in its own row. Use the `glass` button
variant there and keep the floating pill in reading mode. The review status bar
still summarizes the current file and change.
The review sheet, comparison picker, and inline diff card share changed-file
rows: wrap long paths rather than truncating, and keep change counts aligned.
Closing a review parks it. Finish review in the file sheet clears the resume
position without deleting the snapshot or invalidating links to it.
If the agent resumes while dictation is active or microphone permission is pending,
keep recording with Finish and Cancel available. Finishing transcribes and submits
with `steer` delivery even while the agent is busy; generation must not discard audio.
Idle reading controls still replace the microphone with Stop during generation.
Reading-mode state and expand/collapse callbacks travel together in the optional
`ReadingControls` capability.
Sending returns to reading on narrow screens and leaves the current mode unchanged
on wider screens. Finishing a recording reveals transcription progress/recovery.
New conversations retain their full setup form.
`ReviewOverlay` measures `--code-font-size`, `--code-line-height`,
`--line-num-width`, `--cell-padding`, and `--font-mono` to calculate print width.
Below `40rem`, the review hides line numbers and uses the reclaimed width for
formatting. A muted dot in the existing left padding marks each formatted row,
including blank rows; browser-wrapped continuations have no dot.
Review citations scroll to the mapped row without highlighting it. If the row
cannot be located, open the snapshot file and show a notice rather than guessing.
Code previews use the same breakpoint and gutter markers as review. Wide
viewports show formatted line numbers; below `40rem`, a dot marks each formatted
line, not soft-wrapped continuations. Always format and reflow supported code for
the available width. `#L…` file links still refer to original source lines.
Markdown still uses the rendered document view.
The plugin checks preview size, the first 8,000 bytes for NULs, and UTF-8
validity before returning file text. Do not gate Read-card previews on extensions.
For images, the plugin identifies the MIME type with `file` and enforces a size
limit before the browser fetches raw bytes from OpenCode. Fetch with `no-store`
and show the result in `<img>` via a revocable object URL, never as inline SVG.

Some semantic classes remain as stable behavior/test hooks, not styling rules:
`message`, `streaming`, `tool-block`, `changeset-card`, and picker/review hooks.
Prefer accessible locators for new browser tests. `.change-region` and
`.current-change` are the review navigation contract. `.scroll-wrapper` identifies
independently scrolling Markdown content; its touch events must not reach swipe
navigation. Do not remove these hooks as unused styles.

Keep the mobile layout at wider widths; do not introduce desktop sidebars or
multi-column variants. Narrow-width progressive disclosure is fine. Wide code
and tables scroll independently rather than widening the page.

## Verification

Use npm and the npm lockfile for frontend dependencies. Run typecheck, Solid lint,
the production build, and browser tests against the dev backend after a styling migration.
`e2e/presentation.spec.ts` covers theme switching, the no-JavaScript launch,
reactive selected states, narrow widths, modal keyboard handling, safe areas,
and touch-keyboard layout. It attaches screenshots to the Playwright report.
Compare dark/light chat, question, picker, and review views when changing tokens
or shared controls; see `e2e/README.md` for the dev-server test setup.
