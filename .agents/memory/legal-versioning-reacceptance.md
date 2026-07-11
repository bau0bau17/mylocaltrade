---
name: Legal versioning & re-acceptance
description: How in-app legal doc updates are versioned and who re-accepts them
---
- Legal doc versions live server-side (api-server lib/legal.ts CURRENT_TERMS_VERSION / CURRENT_PRIVACY_VERSION, semver). Bumping them triggers the trader-dashboard re-acceptance banner.
- **Re-acceptance is TRADER-ONLY.** Acceptance versions are stored on trader_profiles; the users table has NO legal-version fields, so customers have no acceptance storage or prompt. Do not claim customer re-acceptance exists; adding it requires a users-table schema change.
- **Why:** repeated legal updates (v1.1.0, 11 July 2026) must be reported honestly — customers just see the updated documents.
- **Pre-launch item (recorded in replit.md, do NOT implement unprompted):** before enabling the trader-only RCS sender, split into two Twilio Verify Services (customer flow stays on an SMS-only service; both flows currently share one service SID, and service-level RCS would upgrade customer OTPs too).
- **Customer re-acceptance: explicitly DROPPED by the user (11 July 2026).** App not yet publicly launched; TestFlight customers are test accounts. New customers accept current docs at registration. Never add a customer re-acceptance banner/blocking logic or users-table legal-version fields unless the user asks again.
- **How to apply:** when updating Privacy/Terms copy, bump both versions, update the banner summary text/links in trader-dashboard, and keep the wording stage-accurate: contact details (incl. enquiry-provided phone) are hidden pre-hire and only unlocked mutually after quote acceptance/hire; RCS wording is trader-verification-only (customer flows SMS-only); reviews "can take up to 48 hours" (never guaranteed).
