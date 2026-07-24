import { beforeAll } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// Rate-limit counters live in a shared Postgres table (see
// lib/pg-rate-limit-store.ts), so back-to-back test runs against the same
// development database accumulate hits and eventually make requests fail
// with 429 instead of the expected status. Clear the counters once at the
// start of every test run so each run starts from a clean window.
beforeAll(async () => {
  await db.execute(sql`DELETE FROM rate_limit_hits`);
});
