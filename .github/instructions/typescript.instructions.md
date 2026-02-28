---
applyTo: '**/*.ts, **/*.tsx'
---

Never use the null forgiving operator (`!`). Never use `any`. Avoid casting and use type narrowing instead.

## End-to-End Type Safety

Type safety is very important. Types should flow all the way from the database schema to rendered UI components with no manual syncing or codegen:

1. **Database → Backend**: Drizzle ORM schema in `schema.ts` is the single source of truth for data types.
2. **Backend → API**: Hono route handlers infer types from the schema; the app exports `AppType`.
3. **API → Frontend**: The frontend imports `AppType` via the `@backend/*` path alias and uses `hc<AppType>()` for fully typed RPC calls.
4. **Frontend → UI**: Component props should be derived from the API response types, not redeclared.

Prefer letting types propagate through inference rather than duplicating type definitions across layers. A schema change should produce compile errors everywhere it matters.