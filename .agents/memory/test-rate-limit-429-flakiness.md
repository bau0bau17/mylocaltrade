---
name: API test 429 flakiness
description: Back-to-back api-server test runs 429 because rate limits are stored in shared Postgres, not memory.
---
Rate limiters use a Postgres-backed store (`rate_limit_hits` table) shared across processes, so counters persist between test runs against the same dev DB. Repeated full test runs (e.g. local run followed by mark_task_complete validation) exhaust per-IP windows and tests fail with 429 instead of expected statuses.

**Why:** limiters were made DB-backed for autoscaled deployments; tests all come from one IP, so windows fill fast.

**How to apply:** vitest `setupFiles` (api-server `src/test-setup.ts`) deletes `rate_limit_hits` before each test file. Keep that setup when touching vitest config; if a new test suite hits limited endpoints heavily and flakes with 429, clear the table rather than raising limits.

## Second flake class: dev-server startup backfill races test fixtures (Aug 2026)
When ALL workflows restart simultaneously (workspace/env reboot), the dev API server's
startup company-teams backfill (inserts OWNER membership for trader profiles lacking one)
runs against the SAME dev Postgres the api-test suite uses. If company-jobs.test.ts's
beforeAll creates a trader profile in that window, the server backfills its OWNER row
first and the test's own insertMembership hits 23505 on company_members_profile_user_unique_idx
("ownersBackfilled: 1" in the server boot log is the tell).
**How to apply:** a company-jobs duplicate-membership failure right after a simultaneous
boot is this race, not a code bug — rerun api-test once before investigating.

- Verifying a rerun: `/tmp/logs/*` files are drain snapshots — they update ONLY when logs are refreshed via the log tool. Tailing the newest file without refreshing re-reads the PREVIOUS run and fakes an identical failure.
