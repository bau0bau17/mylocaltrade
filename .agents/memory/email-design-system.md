---
name: Email design system (shared shell)
description: Conventions for the branded email shell, variant selection, capture-hook testing, and preview generation.
---

All project emails render through one shared table-based shell (`email-shell.ts` in the api-server lib) — never hand-write email HTML in a sender.

**Rules:**
- Variant (neutral/trader/customer) is chosen ONLY from trusted server-side data; unknown/mixed audiences → neutral. New-message recipient variant = opposite of `senderRole`.
- Footer taglines per variant are fixed verbatim copy — don't rephrase.
- OTP/security emails carry the fixed security note and NO unsubscribe. Marketing keeps unsubscribe + privacy + contact + company identity. Lead reminder is the one transactional exception that keeps List-Unsubscribe headers.
- Campaign renderer passes Brevo merge tags through `raw`/`rawReason`/raw-unsubscribe options — everything else gets escaped. `title` (email `<title>`) = campaign subject, heading is separate.
- Plain text is auto-derived from the same block model — never maintain a parallel text template.

**Testing/preview pattern:** `__setEmailCaptureHookForTests` in `email.ts` intercepts fully rendered payloads inside `dispatchEmail` before any transport. It is hard-disabled in production (setter throws under NODE_ENV=production and the dispatcher re-checks per send) — keep both guards if refactoring. The preview generator script (`scripts/gen-email-previews.ts`) uses the same hook; nothing is ever sent.

**Why:** email clients (Outlook especially) need table layout, no JS/webfonts/gradients; a single shell keeps 28+ senders consistent and lets tests assert on exact production output.

**Logo single source (Aug 2026):** the email logo asset must stay a BYTE-IDENTICAL copy of the mobile app's canonical `logo@2x.png` — never a separately drawn/exported icon (a divergent 256² "house with tools" asset shipped in every email for months before anyone noticed). Served at the versioned `/api/public/mylocaltrade-logo-v2.png` (Gmail/CDN image proxies cache aggressively — any future logo change needs a NEW versioned filename, not an in-place overwrite); legacy `/api/public/logo.png` stays as an alias to the same file for already-delivered emails. Regression tests pin the served SHA-256 to the canonical mobile asset. Gmail's little sender avatar is NOT the email HTML logo — it comes from a Google account / BIMI, so template fixes never change it.
