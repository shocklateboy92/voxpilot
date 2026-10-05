# UI primitives

This directory owns domain-independent presentation and interaction. Components
receive data and callbacks through props; they do not fetch application data or
import stores, features, or API clients. ESLint enforces the import boundary.

Current primitives:

- `Overlay`: bottom or centered panel with backdrop dismissal.
- `Spinner`: centered loading indicator, optionally fullscreen.
- `SwipeablePane`: scroll container with optional swipe navigation callbacks.

Read `frontend/DESIGN_SYSTEM.md` before changing presentation. Keep native DOM
props and Solid reactivity intact. Use direct imports and component filenames
matching their exports. Add new primitives here when they represent reusable
presentation, rather than creating a component for every layout wrapper.
