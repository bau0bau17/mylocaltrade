---
name: Verify-email stale mounted instance
description: Launch-blocking trap — (tabs) auth screens keep state across registrations; key-remount on identity params; verification writes carry lifecycle predicates.
---

**Incident (Aug 2026, prod):** a trader registered right after a customer in the same app session could never verify. The `(tabs)/auth/verify-email` screen instance stayed mounted with the customer's `verified=true`, so the trader instantly saw a false "Email Verified!" view — OTP input hidden, poll neutered. Server state was always correct (row unverified, token unredeemed; no verify GET ever arrived).

**Rules:**
1. Any `(tabs)` screen holding per-account state MUST remount when its identity params change: `return <Inner key={`${email}|${pollToken}`} />` in the default export. State-reset effects are not enough — refs and scheduled timers survive them.
2. Async work in such screens needs effect-local `cancelled` flags AND cleared redirect timeouts; an in-flight poll for account A must never navigate account B's screen.
3. Email-verification writes (finalize, resend re-arm) carry the lifecycle predicate IN the UPDATE itself: `email_verified=false AND deleted_at IS NULL AND deletion_status NOT IN (ANONYMISED, COMPLETED)` — read-time guards alone are TOCTOU-racy vs admin anonymise/complete. REQUESTED / DISABLED_PENDING_RETENTION stay allowed.
4. `finalizeEmailVerification` is transactional + idempotent (conditional flip, returns boolean); losers re-read and only report success if the row really is verified and live. Three callers: link GET, OTP POST, password-reset.

**Why:** the false-success screen is invisible to server logs and looks like an email/AASA problem; hours were spent ruling out universal-link interception (AASA only claims `/open` — verify links are NOT intercepted).

**How to apply:** touching auth screens under `(tabs)`, verification endpoints, or deletion lifecycle — keep the key-remount, the cancellation guards, and the write predicates; regression suite: `auth-verification-regression.test.ts`.
