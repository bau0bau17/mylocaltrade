---
name: Mobile dead-session auto-logout
description: How the mobile app converges to logged-out after server-side session revocation (account deletion, token rotation), and the rotation race guard.
---

# Ghost sessions must be killed client-side too

Server revocation (tokenVersion bump / deletionStatus set) makes every API
call 401, but the mobile app cached auth in AsyncStorage and never reacted —
users stayed "signed in" to deleted accounts.

**Rule:** the shared API client exposes `setUnauthorizedHandler`, fired only
when a 401 comes back on a request that carried the app session token from
the auth token getter (explicit Authorization headers, e.g. poll tokens, are
excluded). Mobile AuthContext wires it to a forceLogout that clears storage +
state WITHOUT server round-trips (push unregister would itself 401). It also
revalidates via `getMe` on app start and AppState foreground.

**Rotation race:** flows that rotate the token in place (GDPR deletion
request returns a fresh JWT via `applyToken`) can have in-flight requests
with the old token 401 mid-commit. `applyToken` sets a ~10s suppression
window during which the unauthorized handler is ignored — do not remove it.

**How to apply:** any new token-rotation flow must go through `applyToken`
(or set the suppression window) or it risks self-logout; any new client of
the API package should register its own unauthorized handler.
