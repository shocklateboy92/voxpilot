# UI primitives

This directory owns domain-independent presentation and interaction. Components
receive data and callbacks through props; they do not fetch application data or
import stores, features, or API clients. ESLint enforces the import boundary.

| Primitive | API / purpose |
| --- | --- |
| `Button` | `variant`: neutral, primary, success, reject, stop, ghost; `size`: md, sm, icon, icon-lg. Defaults to `type="button"`. |
| `IconButton` | Button with required `aria-label`; `size`: md or lg. |
| `TextInput` | Native input; normal/compact `density`, optional `mono`. |
| `Textarea` | Native textarea; field/composer `variant`. |
| `Select` | Native select; field/ghost `variant`, normal/compact `density`, optional `mono`. |
| `FormField` | Label, description, error, and render callback receiving linked accessibility attributes. |
| `Badge` | Compact badge; optional `mono`, native span props including runtime `style`. |
| `Panel` | Bordered recessed container; default/warning `tone`. |
| `Disclosure`, `DisclosureSummary` | Native details/summary with shared open-state presentation. |
| `CodeOutput` | Scrolling monospace pre; optional `compact` height and `error` tone. |
| `SegmentedControl` | Typed options, value/label accessors, selection callback, disabled state. |
| `ChoiceOption` | Selected button with optional description and checkmark. |
| `Overlay`, `OverlayHeader` | Named bottom/center/fullscreen dialog, keyboard focus handling, dismissal, and shared header. |
| `MarkdownView` | Shared Markdown typography and heading anchors, with caller-supplied link URLs/attributes. |
| `ListRow` | Native full-width selection button for picker rows. |
| `EmptyState` | Centered, muted empty-state content. |
| `Spinner` | Centered loading indicator, optionally fullscreen. |
| `SwipeablePane` | Scroll container with optional swipe navigation callbacks. |

Read `frontend/DESIGN_SYSTEM.md` before changing presentation. Keep native DOM
props and Solid reactivity intact. Use direct imports and component filenames
matching their exports. Add new primitives here when they represent reusable
presentation, rather than creating a component for every layout wrapper.

Variants belong in props. Caller `class`/`classList` should supply layout and
stable hooks, not conflicting overrides of internal utilities. Keep utility
names literal and conditional styling in `classList`.
