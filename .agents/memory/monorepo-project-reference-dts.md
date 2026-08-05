---
name: Monorepo TS project-reference stale .d.ts
description: Why editing lib/* source isn't enough — dependent artifacts read the referenced package's emitted dist .d.ts, not its src.
---

When you change a shared package under `lib/` (e.g. `@workspace/db`, `@workspace/api-client-react`) and a dependent artifact (`artifacts/api-server`, `artifacts/mobile`, etc.) then fails `tsc --noEmit` with errors like "Property X does not exist" or "Module has no exported member Y" — even though the source clearly has it — the cause is TypeScript **project references**.

Each artifact tsconfig lists `references: [{ path: "../../lib/db" }, ...]`. With project references, the dependent project type-checks against the referenced package's **emitted `dist/*.d.ts`**, NOT its `src`. This is true even though `package.json` `exports` points at `./src/index.ts` (that field governs Node/bundler runtime resolution, not tsc's reference resolution). The referenced package is `composite: true` and its stale `tsconfig.tsbuildinfo` + `dist` win.

**Why:** the `lib/*` packages have no `build`/`typecheck` npm script, so it's easy to assume editing source is sufficient. It is not for downstream typecheck.

**How to apply:** after editing a referenced `lib/*` package, rebuild its declarations before typechecking dependents:
`pnpm exec tsc -b lib/<pkg>/tsconfig.json --force`
(`--force` because the stale `tsconfig.tsbuildinfo` can otherwise skip the rebuild). Do this for every changed lib package, then run the dependent artifact's `typecheck`.

The API-client codegen is a classic trap: editing `lib/api-spec/openapi.yaml` then running `pnpm --filter @workspace/api-spec run codegen` (orval) writes generated **source** into `lib/api-client-react/src/generated` AND `lib/api-zod/src/generated`. Both of those packages are `composite` (emitDeclarationOnly → `dist`), so a new OpenAPI field won't appear to `artifacts/mobile` (or other consumers) until you rebuild them:
`pnpm exec tsc -b lib/api-client-react/tsconfig.json lib/api-zod/tsconfig.json --force`. Full order for an OpenAPI change: edit yaml → codegen → `tsc -b` those two libs `--force` → typecheck mobile. (Server-side schema edits under `lib/db` need the same `tsc -b` on `lib/db` for api-server.)

**Post-merge variant:** platform task-merges hit this too — a merged task that touched `lib/db/src` (e.g. new users column) leaves `dist` stale, so api-server tsc fails on the "missing" property in files YOUR diff never touched. First move on post-merge type errors in untouched files: `npx tsc -b lib/db/tsconfig.json --force` (or the relevant lib), not code edits.
