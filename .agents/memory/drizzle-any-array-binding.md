---
name: drizzle raw ANY(array) mis-binds → use inArray
description: Why a raw drizzle sql`col = ANY(${jsArray})` throws "malformed array literal" in Postgres, and the safe fix.
---

# Drizzle raw `= ANY(${jsArray})` mis-binds JS arrays

A raw drizzle template like `sql\`${table.col} = ANY(${conversationIds})\`` where
`conversationIds` is a JS number array binds the array **incorrectly** — Postgres
receives a scalar (e.g. `1`) where it expects an array literal, and throws
`error: malformed array literal: "1"`. Even a single-element array `[1]` fails.

**Symptom:** endpoint that lists rows + enriches them via a helper 500s for
*every* request once there is ≥1 row. With 0 rows the helper early-returns, so it
looks fine in an empty dev DB and only breaks in prod where data exists.

**Fix:** use the first-class helper `inArray(table.col, jsArray)` (generates a
proper `col in ($1, $2, ...)` with each element bound as a scalar). Keep the
`if (arr.length === 0) return;` guard so drizzle never emits `in ()`.

**Why:** raw `sql` interpolation of a JS array does not produce a Postgres array
literal or a parameter list; `inArray` does. This is not visible at typecheck —
it only fails at runtime against real data.

**How to apply:** never hand-write `= ANY(${jsArray})` in a drizzle `sql`
template for JS arrays; reach for `inArray`. When a list endpoint 500s only in
prod, pull the deployment log — the failing bundled SQL + params reveal binding
bugs a hand-written repro query will miss.
