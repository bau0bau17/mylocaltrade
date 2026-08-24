---
name: RevenueCat readiness identity barrier
description: Preventing stale RevenueCat account data when identity setup, retries, and timeouts overlap.
---

RevenueCat identity transitions must own all offering and customer-info reads. A provider may expose a terminal, retryable UI state when a bounded identity operation times out, but its native identity-operation barrier must remain live until the uncancellable `logIn` or `logOut` promise actually settles. Transition barriers must follow replacements, so A→B→C waits through the latest transition rather than only the one observed at the start.

**Why:** Native identity calls can complete after a UI timeout. Releasing the lock at the timeout lets retries, paywalls, lifecycle refreshes, or server reconciliation read the previous SDK account or lets a late old identity overwrite a newer one.

**How to apply:** Clear account-bound offering/customer state immediately on transition. Route Retry, purchase/paywall actions, and server-state refreshes through the same barrier before selecting an identity generation or using the native SDK. Keep generation and per-readiness-cycle guards for stale async completions, and retain deferred timeout/overlap tests when editing this behavior.