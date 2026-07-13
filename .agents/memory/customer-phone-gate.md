---
name: Customer phone verification contact gate
description: How the customer SMS verification gate works and the pitfalls hit while building it
---

Phone is OPTIONAL at customer registration; verification is enforced at the
point of first contact with a trader, server-side, in three routes: create
enquiry, accept quote, accept conversation offer. The gate returns 403 with
machine-readable `code: "PHONE_VERIFICATION_REQUIRED"`; the mobile app detects
it (error `.data.code`) and routes to the customer verify-phone screen.

**Why:** gating at registration would hurt signup conversion; gating only in
the client is bypassable. Messaging inside an existing conversation is
intentionally NOT gated — a conversation can only exist after a gated enquiry.

**How to apply:**
- Any NEW customer→trader contact path must add the same
  `customerPhoneVerified()` check + `sendPhoneVerificationRequired(res)` 403.
- Customers are SMS-only (never RCS). Twilio Verify uses a service "kind"
  (trader vs customer); the customer kind reads
  `TWILIO_VERIFY_SERVICE_SID_CUSTOMER` and falls back to the shared SID.
- Pitfall: every helper in the Twilio module must be kind-aware —
  `isTwilioVerifyConfigured()` defaulted to trader creds, so a
  customer-only-SID deployment silently fell back to email OTP. Pass the kind
  everywhere (configured-check, start, check).
- Pitfall: per-IP OTP limiter is wired per-path in app.ts; a new send-otp
  endpoint must be added there explicitly or it ships with no IP throttle.
- Admin approval of a customer phone change request marks the new number
  verified (admin reviewed it); `/auth/me` exposes `phone` + `phoneVerified`.
