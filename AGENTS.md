# VoxPilot

## TypeScript

Never use the null forgiving operator (`!`). Never use `any`. Avoid casting and use type narrowing instead.

### End-to-End Type Safety

Type safety is very important. Types should flow across boundaries with no manual syncing:

1. **Database -> Backend**: Drizzle ORM schema in `schema.ts` defines the diff cache types.
2. **Backend -> API**: Hono route handlers infer types from the schema and Zod validators; the app exports `AppType`.
3. **API -> Frontend**: The frontend imports `AppType` via the `@backend/*` path alias and uses `hc<AppType>()` for fully typed RPC calls to VoxPilot endpoints.
4. **OpenCode SDK**: Session/message types come from `@opencode-ai/sdk` -- used by both backend and frontend.
5. **Frontend -> UI**: Component props should be derived from API response types, not redeclared.

Prefer letting types propagate through inference rather than duplicating type definitions across layers.

## Frontend

When working on UI components or design, read and follow `frontend/DESIGN_SYSTEM.md`.

## Dependencies

Always use the latest version of any new dependencies you introduce.
