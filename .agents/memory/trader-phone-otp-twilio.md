---
name: Trader phone OTP — Twilio Verify
description: How trader SMS phone verification works (Twilio Verify primary + email fallback) and the invariants that keep it backend-only.
---

Trader phone verification (`/api/trader/phone/send-otp`, `/api/trader/phone/verify`)
uses **Twilio Verify** for SMS. Twilio generates/stores/expires/checks the code —
we never see or persist it.

**Backend-only invariant:** the mobile app calls these two endpoints with manual
`fetch` (they are NOT in the OpenAPI spec), so the JSON response shape and status
codes must stay identical. Changing the delivery mechanism must never change
`phoneMasked / expiresInSeconds / mockCode / attemptsRemaining / verificationStatus /
message / phoneVerified / error`. Keep it a pure backend swap → no TestFlight/app
rebuild.

**Path-selection invariant (do not break):**
- send-otp: `isTwilioVerifyConfigured()` → Twilio path, and it sets `phoneOtpHash = null`.
- verify: `useTwilio = isTwilioVerifyConfigured() && !phoneOtpHash`.
- So `phoneOtpHash === null` means "Twilio owns this code"; a non-null hash means
  a legacy/self-generated (email) code is in flight and must be bcrypt-compared.
  This lets an in-flight email OTP still verify after Twilio is switched on.
- When Twilio is unconfigured (local dev) the whole thing falls back to the
  pre-existing self-generated OTP delivered by email. Twilio owns the code, so the
  Twilio path never returns `mockCode`.

**Rate limiting is layered (requirement: per phone / account / IP):**
- Per-IP: express-rate-limit middleware in `app.ts` (per-instance MemoryStore).
- Per-number: in the route handler, not middleware — the resolved number and auth
  aren't available at the middleware layer. Keyed on canonical E.164 via
  `toUkE164()` so `07…/+447…/447…` variants share one bucket. Applies to BOTH the
  registered-number flow and the "different number" flow. **Why in-handler:** an
  earlier middleware attempt keyed on `req.body.phone` silently skipped the
  default flow (no body.phone) and could be evaded by format variants.
- Per-account: 60s resend cooldown + attempt cap, both stored on the trader row
  (survives autoscale). Twilio Verify also enforces its own per-number limits.

**UK E.164:** `toUkE164()` returns `+447XXXXXXXXX` or null; reject before spending
an SMS. Numbers are stored on the profile in E.164 once the Twilio path runs.

**Secrets (backend only, never in mobile):** `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` — the last is a Verify **Service**
SID (`VA…`), not the Account SID.
