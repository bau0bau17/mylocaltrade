---
name: EAS iOS builds (mylocaltrade)
description: How the mobile app's EAS build profiles map to backends, the device-install gotchas, and the sandbox git/VCS limitation.
---

# EAS iOS builds for mylocaltrade

## Build profiles → backend (eas.json)
- `development` profile: `ios.simulator: true` → **simulator-only** artifact (.tar.gz), CANNOT install on a physical iPhone. Points at the dev backend (`EXPO_PUBLIC_API_URL` = repl dev domain).
- `preview` profile: `distribution: internal`, `ios.simulator: false` → real-device ad-hoc `.ipa`. **By request, its `EXPO_PUBLIC_API_URL` is set to the dev domain** (same dev DB as the simulator) so test accounts/data are shared and data changes need no rebuild.
- `production` profile: points at `https://mylocaltrade.replit.app` (published deployment + production DB).

**Why:** "icon appears then Unable to install" = the user grabbed a *simulator* build, or an ad-hoc build whose profile predates device registration. Always confirm the build is `preview` (sim=false) and that the device UDID is in the provisioning profile.

## Dev backend stability
- `EXPO_PUBLIC_API_URL` is baked into the JS bundle at build time → changing the target backend requires a REBUILD; changing only DB *data* does not.
- The repl dev domain (`$REPLIT_DEV_DOMAIN`, a `…kirk.replit.dev` host) is stable per-repl, but the dev api-server only answers while the workspace workflows are running. If the repl sleeps, the iPhone preview build (pointed at dev) can't reach the API.

## Sandbox git/VCS limitation (Git ref: None)
- Plain `eas build` invokes git writes and hits the main-agent guard (`.git/index.lock`, destructive git ops blocked). Workaround: `EAS_NO_VCS=1 eas build …` archives the working dir directly.
- `EAS_NO_VCS=1` is also REQUIRED when the build must include an *uncommitted* eas.json/code change, because a git-based build only archives committed HEAD and the agent cannot commit mid-turn (the platform auto-checkpoint commits at end of turn).
- Tradeoff: NO_VCS builds show "Git ref: None". To get a real git ref, run the build in a later turn from a clean, already-committed tree (no uncommitted edits) without NO_VCS.

## Account verification (June 2026)
- The dev DB carries seeded test traders (incl. premium) that do **not** exist in production — never assume a dev test account is present in prod. The users table has `email_verified` (no `verification_status` column — that lives on trader_profiles).
