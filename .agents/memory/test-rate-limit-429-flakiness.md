---
name: API test 429 flakiness
description: Back-to-back api-server test runs 429 because rate limits are stored in shared Postgres, not memory.
---
Rate limiters use a Postgres-backed store (`rate_limit_hits` table) shared across processes, so counters persist between test runs against the same dev DB. Repeated full test runs (e.g. local run followed by mark_task_complete validation) exhaust per-IP windows and tests fail with 429 instead of expected statuses.

**Why:** limiters were made DB-backed for autoscaled deployments; tests all come from one IP, so windows fill fast.

**How to apply:** vitest `setupFiles` (api-server `src/test-setup.ts`) deletes `rate_limit_hits` before each test file. Keep that setup when touching vitest config; if a new test suite hits limited endpoints heavily and flakes with 429, clear the table rather than raising limits.
