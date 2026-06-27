---
name: Subscription/status push dedupe
description: Why status-change push notifications must be gated on real transitions, not on every code path that updates the row.
---

# Status-change push must fire only on genuine transitions

When alerting users of subscription/billing status changes via push, gate every
send on an actual state transition — never send unconditionally from a path that
"applies" a change.

**Why:** The same logical event arrives through multiple, overlapping paths and
repeats:
- A premium-active state is re-confirmed on every app focus / "restore purchases"
  via the RevenueCat sync path — sending there unconditionally spams "Premium
  active" on every foreground.
- Provider activation/expiry arrives BOTH via the RevenueCat webhook AND later
  via the sync path; and Stripe emits several terminal events in sequence
  (subscription.updated + subscription.deleted) for one cancellation.
- Renewals re-run the same "grant/activate" branch as first purchase.

**How to apply:** Before notifying, read the prior row status and compute a
transition flag, then push only when it flips:
- activated push  → only when prior row was absent or status !== "active"
- cancelled/ended push → only when prior row status === "active"
Stripe activation already had a `wentLive` flag; reuse that pattern. Keep these
guards consistent across all three paths (RC sync, RC webhook, Stripe webhook)
or one path will double-notify what another already announced. Auto-renew-off
(scheduleCancel) is NOT an end-of-access event — no push; the in-app
"cancellation scheduled" banner covers it.
