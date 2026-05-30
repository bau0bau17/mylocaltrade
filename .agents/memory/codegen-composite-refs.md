---
name: api-spec codegen + composite project references
description: Why mobile/admin typecheck shows stale generated types after running api-spec codegen, and how to refresh them
---

# api-spec codegen and TypeScript composite project references

After editing `lib/api-spec/openapi.yaml` and running
`pnpm --filter @workspace/api-spec run codegen`, the regenerated types live in
`lib/api-client-react/src/generated/`. The package is consumed from source
(`exports: { ".": "./src/index.ts" }`), so runtime/Metro picks up changes
immediately.

**But typecheck does not.** `lib/api-client-react` is a TypeScript `composite`
project (`emitDeclarationOnly`, `outDir: dist`, with `tsconfig.tsbuildinfo`).
Artifacts like `artifacts/mobile` reference it via `references` in their
tsconfig. A bare `tsc -p tsconfig.json --noEmit` (the per-package `typecheck`
script) reads the referenced project's **emitted `.d.ts` / cached tsbuildinfo**,
not the fresh source. So you get phantom errors like `"premium" is not
assignable to ListTradersPlan` even though the generated source is correct.

**Fix:** run the root `pnpm run typecheck`. It runs `typecheck:libs`
(`tsc --build`) first, which rebuilds the composite declarations, then runs the
per-artifact typechecks. Do not trust a single-package `tsc --noEmit` after
codegen until libs have been rebuilt.

**Also:** Metro logs a transient `Unable to resolve "./generated/api"` during
codegen because orval's "Cleaning output folder" briefly deletes the files.
It usually self-resolves once codegen finishes, but if Metro's haste map cached
the missing-module resolution, a plain expo workflow **restart is not enough** —
the error sticks even though the file exists on disk. Clear Metro's caches first
(`rm -rf $TMPDIR/metro-* /tmp/metro-* /tmp/haste-map-* node_modules/.cache/metro
artifacts/mobile/node_modules/.cache`) then restart the expo workflow. Verify by
screenshotting the app (it bundles/renders) rather than trusting the non-rotating
workflow log, whose tail can show a stale pre-clear error line.
