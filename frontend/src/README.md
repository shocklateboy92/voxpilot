# Frontend ownership

- `features/chat/`: messages, composer, agent/model selection, and chat helpers.
- `features/sessions/`: session selection and forking.
- `features/tools/`: tool rendering, permissions, questions, and background tools.
- `features/review/`: changesets, diff review, and review state.
- `features/connection/`: connection and offline screens.
- `ui/`: domain-independent presentation and interaction primitives.
- `app/`: application composition, shared state, startup, navigation, notifications,
  and cross-feature event reconciliation.
- `platform/`: OpenCode transport, connection configuration, and browser utilities.

Keep components, state, helpers, and colocated tests with the feature that owns
them. Start each feature flat; introduce a subdirectory for a meaningful group
such as tool renderers. Use PascalCase for component files and kebab-case for
other modules. Prefer direct imports over broad barrel exports.

UI primitives take data and callbacks through props. They must not import app
state, feature modules, or API clients. Generic browser interaction helpers are
fine. Feature components may compose UI primitives and call application logic.
Use domain names for feature components (`AgentPicker`) and generic names for
primitives (`SegmentedControl`). Reuse across features alone does not change
ownership.

`app/ChatView.tsx` composes chat, navigation, and review. `app/streaming.ts`
reconciles events across sessions, permissions, questions, and messages.
`app/wake-lock.ts` connects session activity to the browser wake lock. These
modules belong to app coordination rather than a single feature or a generic
browser layer. The central store remains shared; folder ownership does not
require splitting state or changing startup ordering.

The entry point deliberately imports `app/App.tsx` dynamically after connecting.
Keep pre-connection UI independent of the app store's top-level bootstrap await.
