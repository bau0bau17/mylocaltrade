---
name: Stale dist breaks typecheck after schema/spec changes
description: Why untouched api-server files fail typecheck, and how to fix it
---

Composite library packages (`lib/db`, `lib/api-zod`) export their `src` directly
via `package.json#exports`, but they are also TypeScript project references
(`composite: true`) whose consumers (e.g. `artifacts/api-server`,
`artifacts/admin`) typecheck against the emitted `dist/*.d.ts`, not the source.

**Symptom:** `pnpm --filter ./artifacts/api-server run typecheck` reports errors in
files you never touched — e.g. a column like `registerCheckStatus` "does not exist"
on the trader_profiles table type, or `vatNumber` missing from a generated zod
schema — even though the column/field clearly exists in the package source.

**Why:** the `dist` declaration files are stale relative to the package source
(schema columns added, OpenAPI/zod regenerated) and were never rebuilt.

**How to apply:** when typecheck fails on symbols that exist in `lib/db/src` or
`lib/api-zod/src`, rebuild the declarations before assuming a real error:
`cd lib/db && npx tsc -b` and `cd lib/api-zod && npx tsc -b`. Then re-run the
consumer typecheck.
