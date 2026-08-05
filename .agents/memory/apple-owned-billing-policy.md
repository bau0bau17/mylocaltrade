---
name: Apple-owned billing/refund policy
description: All refund/cancellation copy defers to Apple; custom cooling-off flow intentionally removed and backend left dormant
---

Decision (Aug 2026, user-directed): the product fully adopts Apple's subscription model. Apple owns billing, renewals, cancellations and refunds; MyLocalTrade only manages Premium feature access.

**Rules:**
- No user-facing copy may promise refunds *from MyLocalTrade*, a "14-day cooling-off period", pro-rata refunds, or in-app cancellation processing. Cancellation copy points to App Store subscription settings; refund copy points to Apple (reportaproblem.apple.com / purchase history).
- The custom cooling-off flow was removed from UI + legal copy only: billing screen banner/file-request flow, admin Cancellations queue page/nav. The **backend stays dormant on purpose** — the cancellation-request endpoint, `cancellation_requests` table, admin attention-counts field, and the `coolingOff` object in the subscription status response all still exist server-side and are simply unused by clients. Do NOT "clean them up" or resurface them without an explicit ask.
- Legal versions were NOT bumped (no re-acceptance trigger) — copy alignment only, per legal-versioning rules.

**Why:** App Store compliance and a prior custom flow that conflicted with Apple's actual refund ownership; a support-facing email path remains for traders who write in.

**How to apply:** any new screen, email, FAQ or landing copy touching billing must follow the Apple-owned model; consistency check spans mobile legal pages, landing site refund page, and terms §10/§11.

**Page naming (Aug 2026):** The customer-facing page formerly titled "Refund & Cancellation Policy" is now titled "Subscription & Billing" everywhere (mobile route title, legal hub row, landing page title/h1/meta, all landing footers). URLs, route names, and file names intentionally KEPT (`/refund` mobile route, `/refund-policy` landing URL, `refund.tsx`, `RefundPolicy-*.js`) to avoid breaking links/SEO. Mobile billing screen's cancel button says "Cancel Premium subscription" (not "Switch to Free plan"). Don't "fix" the URL/title mismatch — it's deliberate.
