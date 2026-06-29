---
name: Email OTP verification (in-app code)
description: Anti-enumeration + path-parity rules for the unauthenticated email-code verify endpoint
---

In-app email verification by 6-digit code is the PRIMARY mobile flow after signup;
the web verification LINK is only a fallback. Both must verify the same account
without behavioural drift.

## Rule: one shared finalize helper for BOTH paths
The link GET and the code POST both call a single finalize helper (mark verified,
clear token+OTP, activate customers, trader PENDING_EMAIL_VERIFICATION ->
PENDING_PHONE_VERIFICATION, audit). Never duplicate the side-effects in one path.
**Why:** two independent verify paths silently diverge (e.g. one forgets the trader
status transition or customer activation). **How to apply:** any new verify entry
point routes through that helper; test link/code parity together.

## Rule: the code-verify endpoint is UNAUTHENTICATED -> no account-state oracle
Collapse every non-lockout failure (unknown email, already-verified, missing OTP,
expired, wrong code) into ONE identical generic 400. Do NOT return a distinct
409/ALREADY_VERIFIED or a distinct "expired" code, and do NOT expose
attemptsRemaining. The only state-specific response allowed is the 429 lockout
(only reachable after exhausting attempts on a real active OTP).
**Why:** distinct responses let an attacker enumerate which emails are registered
or verified. A code review failed the first cut for exactly this.
**How to apply:** also run a dummy bcrypt compare against a fixed module-level hash
on the no-real-OTP branches so latency doesn't leak existence; keep the OpenAPI
contract documenting only 200/400/429.

## Policy mirror
Mirrors the trader phone OTP: bcrypt-hashed 6-digit code, 10-min TTL, max 5
attempts, resend regenerates+resets. Auto-login on success (returns {token,user}
same shape as /auth/login); customers active immediately, traders stay inactive
until subscription payment.
