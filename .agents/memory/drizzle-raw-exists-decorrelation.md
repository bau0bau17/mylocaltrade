---
name: Drizzle raw-SQL correlated EXISTS de-correlates
description: Hand-written sql`exists(select 1 from t where col = col)` inside select() renders the inner column unqualified — predicate compares a column to itself and is true whenever the table is non-empty.
---

**Rule:** Never hand-write a correlated `EXISTS`/`NOT EXISTS` with the sql`` template inside a Drizzle `.select({...})` (e.g. in `count(*) filter (where exists (...))`). Use Drizzle's `exists()` / `notExists()` builders with a proper subquery and interpolate THOSE into the sql template instead.

**Why:** In raw sql`` fragments, Drizzle renders interpolated columns without a qualifying table alias for the subquery context. `sql\`exists (select 1 from ${otherTable} where ${otherTable.email} = ${mainTable.email})\`` came out with the inner predicate comparing the column to itself — silently true for every row whenever the other table had ANY rows. Symptom in the outreach audience breakdown: `excludedOnSuppressionList` counted ALL contacts and `excludedEarlyAccessDuplicate` was 0. No error, no warning — a pure logic corruption that only shows with data present (empty dev tables look fine).

**How to apply:** Any aggregate breakdown or filter that needs a correlated subquery against another table → build it with `exists(db.select().from(other).where(eq(other.col, main.col)))` and interpolate the builder. There is a comment at the fix site in the outreach audience computation. Related trap: [Drizzle ANY(array) mis-bind](drizzle-any-array-binding.md) — same "raw sql fragment silently wrong" family.
