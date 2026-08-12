import { beforeAll } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// A test run must NEVER dispatch real email — hundreds of fixture sends once
// exhausted the Brevo free-plan daily quota, after which Brevo silently
// accepted-and-dropped every production email (password resets included) for
// the rest of the day. The dispatcher reads these variables at call time, so
// stripping them here disables every real transport for the whole run
// regardless of which secrets exist in the workspace. (The dispatcher also
// refuses reserved test domains outright — this is the belt to that guard's
// braces.)
const TRANSPORT_ENV_KEYS = [
  "BREVO_API_KEY_VERIFICATION",
  "BREVO_API_KEY_NOTIFICATIONS",
  "BREVO_API_KEY_CONTACT",
  "BREVO_API_KEY_MARKETING",
  "MARKETING_BREVO_ENABLED",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
] as const;
for (const key of TRANSPORT_ENV_KEYS) {
  delete process.env[key];
}

// Unsubscribe tokens are signed with a DEDICATED secret (never the session
// secret). Tests always run with a fixed throwaway value so token building
// and verification work without any real configuration.
process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET = "test-unsubscribe-secret";
delete process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET_PREVIOUS;

// Rate-limit counters live in a shared Postgres table (see
// lib/pg-rate-limit-store.ts), so back-to-back test runs against the same
// development database accumulate hits and eventually make requests fail
// with 429 instead of the expected status. Clear the counters once at the
// start of every test run so each run starts from a clean window.
beforeAll(async () => {
  await db.execute(sql`DELETE FROM rate_limit_hits`);
});
