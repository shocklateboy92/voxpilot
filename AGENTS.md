# VoxPilot

## TypeScript

Never use the null forgiving operator (`!`). Never use `any`. Avoid casting and use type narrowing instead.

### End-to-End Type Safety

Type safety is very important. Types should flow across boundaries with no manual syncing:

1. **Storage -> Plugin**: The Snapshot Zod schema in `plugin/src/rpc.ts` validates durable plugin data.
2. **Plugin -> API**: `Rpc.define` uses Zod Standard Schema for inferred handler inputs and outputs.
3. **API -> Frontend**: Import the shared contract via `@plugin/rpc` and call `client.rpc(VoxPilotRpc)`.
4. **OpenCode client**: Session/message types come from `@opencode/client`.
5. **Frontend -> UI**: Component props should be derived from API response types, not redeclared.

Prefer letting types propagate through inference rather than duplicating type definitions across layers.

## Frontend

When working on UI components or design, read and follow `frontend/DESIGN_SYSTEM.md`.

### Error Handling

Do not wrap async event handlers in try/catch to show error toasts. The app has a global error handler that catches unhandled promise rejections and displays them automatically.

### CSS Classes

Use SolidJS `classList` for conditional classes. Do not build class strings with template literals or concatenation.

## Dependencies

Always use the latest version of any new dependencies you introduce.
