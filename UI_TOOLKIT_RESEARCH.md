# UI Toolkit Research: Solid.js Ecosystem

## Current State

VoxPilot's frontend is SolidJS 1.9 + TypeScript + Vite with **zero third-party UI
component libraries**. The entire UI is 12 hand-written components and ~1,420 lines of
custom CSS using CSS custom properties for theming. All interactive patterns (modals,
toasts, overlays, collapsibles) are hand-rolled with native HTML elements.

## Should We Adopt a UI Toolkit?

**Yes, but selectively.**

The current hand-rolled approach works for what exists today, but the roadmap includes
terminal views, git panels, syntax highlighting, file pickers, and richer interactive
controls. The maintenance cost of hand-rolling accessible modals, drawers, toast systems,
and form controls will compound as features grow.

We don't need a heavy, fully-styled design system. We already have a strong custom dark
theme with CSS variables, and the mobile-first touch/swipe UX is specialized enough that a
pre-styled library would fight us more than help.

## Ecosystem Overview

### Kobalte (kobalte.dev)

- **Type:** Unstyled/headless accessible UI toolkit for SolidJS
- **Components:** ~45 (Accordion, Alert Dialog, Combobox, Dialog, Menubar, Select, Tabs,
  Toast, Tooltip, and many more)
- **Status:** Active, v0.13.x. De facto standard headless library for Solid.js
- **Accessibility:** First-class WAI-ARIA compliance, focus management, keyboard navigation
- **Styling:** Completely unstyled -- bring your own CSS. Provides data attributes for
  state-based styling
- **Community:** Strong. Official SolidJS Discord channel. Same author as the deprecated
  Hope UI, now focused on Kobalte + Pigment (a styled layer on top)

### Solid Primitives (github.com/solidjs-community/solid-primitives)

- **Type:** Reactive utility primitives (not UI components). The "VueUse for Solid"
- **Coverage:** 60+ packages -- active-element, intersection-observer, resize-observer,
  keyboard, scroll, media queries, storage, idle detection, clipboard, timer, spring
  animations, and more
- **Status:** Highly mature. 1.5k GitHub stars. Managed by SolidJS core/ecosystem team
- **Accessibility:** N/A (utility primitives, not UI components)
- **Styling:** N/A

### Corvu (corvu.dev)

- **Type:** Unstyled, accessible UI primitives for SolidJS
- **Components:** ~9 primitives (Accordion, Calendar, Dialog, Disclosure, Drawer, OTP Field,
  Popover, Resizable, Tooltip) + 7 utilities (dismissible, focusTrap, presence, etc.)
- **Status:** Active, growing. Smaller and newer than Kobalte
- **Accessibility:** WAI-ARIA compliant
- **Styling:** Completely unstyled. Provides Tailwind/UnoCSS plugins for data-attribute
  styling
- **Community:** Active single-maintainer project. Dedicated SolidJS Discord channel

### Solid UI (solid-ui.com)

- **Type:** Styled components -- a port of shadcn/ui to SolidJS. Copy-paste model
- **Components:** ~55+ (built on top of Kobalte + Tailwind CSS)
- **Status:** Active, community-maintained
- **Accessibility:** Inherits from Kobalte
- **Styling:** **Requires Tailwind CSS** -- components are pre-styled with Tailwind classes
- **Community:** Growing adoption

### Ark UI (ark-ui.com)

- **Type:** Framework-agnostic headless component library (React, Solid, Vue, Svelte)
- **Components:** 45+ -- powered by state machines (Zag.js). Includes advanced components
  like Date Picker, Color Picker, File Upload, Tree View, Tour
- **Status:** Active, v5.x. Backed by Chakra Systems (commercial team)
- **Accessibility:** Full WAI-ARIA compliance
- **Styling:** Completely unstyled/headless
- **Community:** Very active. Professional maintenance, regular releases

### Park UI (park-ui.com)

- **Type:** Styled design system built on Ark UI + Panda CSS
- **Components:** Mirrors Ark UI's 45+ components with pre-styled variants
- **Status:** Active, officially joined the Chakra UI organization
- **Accessibility:** Inherits from Ark UI
- **Styling:** **Requires Panda CSS**
- **Community:** Strong, backed by Chakra Systems

### Hope UI (github.com/hope-ui/hope-ui)

- **Type:** Styled component library inspired by Chakra UI
- **Status:** **DEPRECATED.** Last release August 2022. Succeeded by Kobalte + Pigment
- **Verdict:** Do not use

## Comparison

| Library              | Type                 | Components | Styled?   | Solid-Native?   | Status       | Fit           |
| -------------------- | -------------------- | ---------- | --------- | --------------- | ------------ | ------------- |
| **Kobalte**          | Headless toolkit     | ~45        | No        | Yes             | Active       | **Best fit**  |
| **Solid Primitives** | Reactive utilities   | 60+ pkgs   | N/A       | Yes             | Mature       | **Essential** |
| **Corvu**            | Headless primitives  | ~9         | No        | Yes             | Active       | Supplementary |
| **Ark UI**           | Headless toolkit     | 45+        | No        | Multi-framework | Active, v5.x | Good fit      |
| **Solid UI**         | Styled (shadcn port) | ~55+       | Tailwind  | Yes             | Active       | Poor fit      |
| **Park UI**          | Styled (Panda CSS)   | 45+        | Panda CSS | Multi-framework | Active       | Poor fit      |
| **Hope UI**          | Styled (CSS-in-JS)   | ~30        | Yes       | Yes             | Deprecated   | Avoid         |

## Recommendation: Kobalte + Solid Primitives

### Why Kobalte

- **Unstyled/headless** -- won't conflict with our existing CSS custom properties theme. We
  keep full styling control while getting accessible, keyboard-navigable, WAI-ARIA-compliant
  behavior for free
- **Covers patterns we're hand-rolling today:** Dialog, Toast, Collapsible, Tabs
- **Covers patterns we'll need soon:** Select, Combobox (file pickers), Menubar (git
  panels), Tabs (terminal/editor views)
- **Solid-native** -- no framework abstraction layer, integrates directly with SolidJS
  signals and reactivity

### Why Solid Primitives

- Reactive utilities we'll inevitably need: intersection observer, resize observer, keyboard
  handling, scroll management, media queries, storage, idle detection
- Zero UI impact -- pure utility, no styling decisions
- Mature, well-tested, maintained by the SolidJS core team

### Why Not Ark UI

Ark UI is a strong library, but Kobalte is the better choice for VoxPilot because:

- Kobalte is Solid-native (no framework abstraction overhead)
- Kobalte has a larger Solid.js-specific community and more Solid-specific examples
- Ark UI's state-machine approach (Zag.js) adds a dependency layer that isn't necessary for
  a single-framework project

### Why Not Solid UI / Park UI

Both require adopting a CSS framework (Tailwind or Panda CSS respectively), which would mean
rewriting the entire existing styling approach. That's a high cost for a project with a
working custom theme.

### Supplementary: Corvu

Worth using for specific primitives where it excels:

- **Drawer** -- useful for the mobile bottom-sheet session picker
- **Resizable** -- useful for terminal/panel layouts in future phases
- Can complement Kobalte without conflict

## Migration Path

Adoption should be incremental, not a big-bang rewrite:

1. **Add `solid-primitives` packages as needed** -- zero UI impact, pure utility. Start with
   resize-observer, media, keyboard, scroll as needed
2. **Replace the hand-rolled toast system** with Kobalte's `Toast` component
3. **Replace overlay/modal patterns** (SessionPicker, ReviewOverlay) with Kobalte's `Dialog`
4. **Replace `<details>` collapsibles** with Kobalte's `Collapsible` (better
   animation/accessibility)
5. **Use Kobalte's `Select`/`Combobox`** when building the directory picker and file picker
   features from the roadmap
6. **Consider Corvu's `Drawer`** when refining the mobile session picker bottom-sheet UX
7. **Consider Corvu's `Resizable`** when implementing terminal/panel split layouts

Each step is isolated and can be done independently without affecting the rest of the UI.
