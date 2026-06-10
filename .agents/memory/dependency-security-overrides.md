---
name: dependency security overrides
description: How transitive dependency CVEs are patched in this monorepo, plus the authoritative way to find patched version ranges.
---

# Fixing dependency vulnerabilities

Transitive-dep CVEs in this monorepo are pinned via `pnpm-workspace.yaml` `overrides`
using `pkg@major` keys (e.g. `uuid@9`, `ws@8`, `brace-expansion@5`). Direct deps
(e.g. `vitest`) are bumped in the owning package.json instead. After editing, run
`pnpm install` then verify with `runDependencyAudit` (code_execution) — it should
report 0 vulnerabilities.

**Get patched ranges from the source of truth, not by guessing "latest patch".**
POST the affected `{name: [versions]}` map to
`https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` and read
`vulnerable_versions`. Gotcha seen in practice: `qs` was vulnerable `<=6.15.1`, so
the "latest 6.15 patch" 6.15.1 was *still* vulnerable — needed 6.15.2. Same trap
for `ws` (needed >=8.20.1) and `uuid` (needed >=11.1.1).

**Why:** several advisories flag the latest version of an old major line, so there
is no in-major backport; the fix requires jumping to a newer major. uuid@11 ships
both ESM and CJS (`require('uuid').v4()` still works), so overriding old uuid 3/7/8/9
to ^11.1.1 is safe for CJS consumers like `@expo/ngrok` and `xcode`.

**How to apply:** when given a "fix N vulnerabilities" task, batch-query the bulk
advisory endpoint for exact patched ranges, add/raise overrides, `pnpm install`,
then `runDependencyAudit` to confirm 0.
