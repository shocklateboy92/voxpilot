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

`Button` variants are `neutral` (default), `primary`, `success`, `reject`, `stop`,
and `ghost`. Sizes are `md`, `sm`, `icon`, and `icon-lg`; prefer `IconButton` for
icon-only actions because it requires an accessible label. Button type defaults
to `button`; submit actions must explicitly use `type="submit"`.

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

Async event errors go through the global rejection handler. Do not add per-control
try/catch blocks just to display error toasts.

## CSS exceptions and functional hooks

- `app.css`: imports Tailwind and the scoped styles, then sets page/root defaults.
- `theme.css`: colors, shared layout variables, fonts, shadows, and animations.
- `markdown.css`: typography for HTML produced by MarkdownIt. Explicit list
  styles preserve bullets/numbering after Tailwind Preflight.
- `diff.css`: the class contract with the plugin's generated diff HTML.
- `behaviors.css`: keyboard-aware navigation and light-theme status-bar shadow.
  These contextual rules share the utilities layer so they can override layout
  utilities such as `flex`.

Keep `--safe-top`, `--safe-bottom`, `--bottom-nav-height`, and
`--status-bar-clearance` coordinated between the shell and composer.
`ReviewOverlay` measures `--code-font-size`, `--code-line-height`,
`--line-num-width`, `--cell-padding`, and `--font-mono` to calculate print width.

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
