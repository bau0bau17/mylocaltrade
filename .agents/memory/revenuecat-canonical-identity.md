---
name: RevenueCat canonical identity (rc_ ids)
description: Server-generated rc_<32hex> app-user ids; numeric users.id is a narrowly-gated legacy alias; webhook/sync fail-closed rules.
---

The rule: the RevenueCat App User ID is a **server-generated opaque token** `rc_<32hex>` stored in `users.revenuecat_id` (nullable + unique, lazy guarded backfill on register/login//auth/me/invite-accept — the backfill IS the migration, no bulk script). The mobile app takes it ONLY from authenticated responses and passes it verbatim to `Purchases.logIn()`; it never constructs an identity.

**Why:** the old id was the guessable numeric `users.id` — a tampered client with the public SDK key could alias as any user and attach purchases/expirations to their account (grant or DoS via webhook, which authenticates RevenueCat but not the aliased identity).

Fail-closed rules (keep):
- Sync queries RevenueCat with the canonical rc_ id ONLY.
- Webhook resolves [app_user_id, original_app_user_id]; anonymous-only → 2xx ack `ignored:"anonymous"`; unknown/invalid → 2xx ack `ignored:"unknown_app_user_id"` + integrity error log (RC retries non-2xx forever, so ack; never mutate). Log only 8-char id prefixes.
- **Legacy numeric alias is gated**: an all-digits app_user_id resolves ONLY when that user already has a `subscriptions` row (pre-existing billing history). Never widen this — an ungated numeric fallback reopens the confused-deputy hole. Remove the alias entirely once pre-hardening sandbox customers are gone.
- A deleted account's rc_ id stays bound to the tombstoned row; re-registration mints a NEW id — late webhooks for the old id must never leak entitlements to the new account.

**Deploy order:** production DB needs the schema push (users.revenuecat_id + account_cleanup_jobs) BEFORE the API/app build that uses it, or auth/registration queries fail live.
