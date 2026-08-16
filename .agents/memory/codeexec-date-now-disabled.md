---
name: CodeExecution Date.now() disabled
description: Date.now()/time APIs can be disabled in the durable CodeExecution runtime; get timestamps via shellExec date instead.
---

The rule: in the CodeExecution notebook, `Date.now()` can throw `Date.now() is disabled in durableptc v1` (despite docs saying time works). Anything needing a current epoch (e.g. `fetchDeploymentLogs.afterTimestamp`) should get it via `shellExec({ command: "date +%s%3N" })` and `parseInt`, or use a literal `Date.parse("2026-08-16T10:00:00Z")` when an absolute anchor is known.

**Why:** hit during production smoke checks — a whole batched block failed on the first `Date.now()` call, costing a round-trip.

**How to apply:** never open a CodeExecution block with `Date.now()`; fetch the timestamp from the shell first (same block is fine), then reuse the number.
