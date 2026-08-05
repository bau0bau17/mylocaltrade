# Threat Model

## Project Overview

MyLocalTrade is a pnpm monorepo for a local-trades marketplace. The production system consists primarily of an Express 5 API (`artifacts/api-server`), an Expo mobile client (`artifacts/mobile`), and a separately built React/Vite admin web app (`artifacts/admin`). The API uses PostgreSQL via Drizzle ORM, JWT bearer tokens for customer/trader/admin authentication, RevenueCat (Apple In-App Purchase) for billing, SMTP/Nodemailer for transactional email, Companies House lookups during trader onboarding, and object storage for trader document uploads.

This scan is production-focused. Assume `NODE_ENV=production`, platform TLS is present, and `artifacts/mockup-sandbox` is not deployed to production unless future evidence shows otherwise.

## Assets

- **User accounts and bearer tokens** — customer, trader, and admin credentials/tokens grant access to marketplace actions and privileged back-office workflows.
- **Personal and business data** — names, email addresses, phone numbers, trader business details, messages, enquiries, reviews, saved-trader relationships, and onboarding metadata contain PII and marketplace-sensitive data.
- **Trader verification artifacts** — uploaded identity/business documents and moderation decisions are sensitive and high impact if exposed or tampered with.
- **Billing state** — subscription rows synced from RevenueCat (Apple In-App Purchase) affect trader perks/featured placement and revenue. Stripe integration was fully removed (Aug 2026); legacy `stripe_*` DB columns remain as NULL placeholders only.
- **Operational trust signals** — transactional emails, verification links, review/reply notifications, and support emails are sent from trusted app-controlled infrastructure and can be abused for phishing or impersonation if content handling is unsafe.
- **Application secrets and integrations** — JWT signing material, database credentials, SMTP credentials, RevenueCat webhook/API credentials, object-storage credentials, and Companies House access must remain server-only. RevenueCat iOS/Android public SDK keys (`EXPO_PUBLIC_REVENUECAT_*`) are intentionally public and embedded in the mobile app; they are not secrets.

## Trust Boundaries

- **Mobile/admin/browser clients → API** — all client input is untrusted. Authentication, authorization, validation, rate limits, and output scoping must be enforced server-side.
- **Public routes → authenticated user routes** — registration, login, contact, trader discovery, and webhook endpoints are reachable without auth; account/profile/messaging/billing/document routes are not.
- **Authenticated users → admin-only routes** — admin review/moderation/reporting/document-access functions must remain unreachable to customers and traders.
- **API → PostgreSQL** — the API has broad read/write access to core marketplace records; injection or broken authorization at this layer can expose or corrupt all tenant data.
- **API → object storage** — uploaded trader documents cross from untrusted users into long-lived storage; keys and preview/download flows must stay scoped.
- **API → external services** — RevenueCat webhooks, SMTP delivery, push notifications, and Companies House lookups cross service boundaries that require authentication of callbacks, origin/recipient control, and safe handling of attacker-influenced content.
- **Production → dev-only features** — demo billing activation paths, mock OTP behavior, and `mockup-sandbox` code should be ignored unless they are reachable in production.

## Scan Anchors

- Production entry points: `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/**/*.ts`, `artifacts/api-server/src/lib/auth.ts`, `artifacts/api-server/src/lib/email.ts`, `artifacts/api-server/src/lib/objectStorage.ts`, `artifacts/api-server/src/routes/subscriptions.ts`.
- Admin surface: `artifacts/admin/src/lib/auth.tsx`, `artifacts/admin/src/lib/api.ts`, plus admin-facing API routes in `artifacts/api-server/src/routes/admin.ts`.
- Highest-risk areas: auth/registration, admin moderation/document access, conversations/enquiries, transactional email rendering, uploads, and billing/webhooks.
- Public surfaces: auth registration/login/resend, trader listing/detail, contact, health, RevenueCat webhook, Companies House lookup.
- Authenticated surfaces: profile, saved traders, enquiries, conversations, reviews, subscriptions, trader phone/documents.
- Admin-only surfaces: `artifacts/api-server/src/routes/admin.ts` and the `artifacts/admin` app.
- Usually out of scope: `artifacts/mockup-sandbox`, any `NODE_ENV !== production` branches, and demo-only subscription activation that is explicitly blocked in production.
- `artifacts/mobile/server/serve.js` landing page server: SAST HIGH path-traversal is a confirmed false positive (four independent controls block traversal). Do not re-investigate unless the file changes.
- `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` in `.replit` and `eas.json`: these are intentionally public RevenueCat mobile SDK keys; SAST flags them as secrets but they are not. Do not re-flag.

## Confirmed Clean (Task #108)

The following were investigated and found not vulnerable in the current codebase:
- Admin route authorization — all `/admin/*` routes correctly protected by `adminOnly` / `superAdminOnly`.
- Conversations/enquiries IDOR — conversation detail verifies caller is customer or trader party before returning data.
- Demo-mode billing in production — `/subscriptions/demo-activate` checks `NODE_ENV === "production"` per-request and returns 404; no payment bypass. (The former Stripe checkout/webhook surface was removed entirely in Aug 2026.)
- RevenueCat webhook auth — shared-secret Authorization header compared with `crypto.timingSafeEqual`; an unset secret fails closed (403).
- Promo code double-claim — `SELECT … FOR UPDATE` + per-user unique constraint prevent concurrent abuse.
- Rate limiting — all public endpoints have PostgreSQL-backed rate limits applied at the Express layer.
- SQL injection — all queries use Drizzle parameterized helpers.

## Confirmed Fixed (Task #119)

- **Stripe webhook multi-signature verifier (ID 14)** — Stripe integration was fully removed in commit `a011817`. No Stripe webhook code remains in `subscriptions.ts`.

## Threat Categories

### Spoofing

The system issues JWT bearer tokens for customer, trader, and admin roles and also trusts RevenueCat webhook calls, Companies House responses, and SMTP-delivered messages to carry the app's identity. Protected API endpoints MUST validate bearer tokens server-side on every request, role checks MUST be enforced in route handlers instead of the client, and all third-party callbacks (especially billing webhooks) MUST be authenticated before changing account state.

Known open issue: email verification link tokens have no expiry — see vulnerability `email-verification-link-no-expiry`.

### Tampering

Untrusted users can submit registration data, profile fields, contact messages, conversations, enquiries, review text, uploaded document metadata, and billing-triggering actions. The API MUST validate and constrain all user-controlled fields, compute security-sensitive state transitions server-side, and ensure upload keys/object references are bound to the authenticated owner and intended workflow.

### Information Disclosure

The application stores PII, trader verification data, internal moderation state, and conversation content. API responses, file previews/downloads, logs, and email notifications MUST only disclose data to authorized principals, and administrative/reporting routes MUST not leak sensitive records to lower-privileged users. Error handling and logging MUST avoid exposing secrets, message bodies, or verification tokens beyond what operators genuinely need.

Known open issue: login endpoint leaks account existence for deleted/unverified accounts via status-code differences — see vulnerability `login-account-enumeration`.

### Denial of Service

Public endpoints such as login, registration, resend-verification, contact, and any webhook or message creation flows can be abused to consume CPU, database capacity, email quota, or third-party API quota. Production endpoints MUST apply rate limits, body-size limits, and bounded external requests, and attacker-controlled inputs MUST not trigger unexpectedly expensive regex/template/rendering/upload behavior.

### Elevation of Privilege

This project has meaningful privilege separation between public users, authenticated customers, traders, and admins. Every route that reads or mutates user, trader, billing, conversation, moderation, or document data MUST enforce object-level ownership and role checks on the server. User-controlled content MUST never reach privileged sinks such as SQL, email templates, file paths, signed URLs, or admin-only actions without context-appropriate escaping and validation.

Known open issue: trader-controlled fields (businessName, notes) can carry CSV formula-injection payloads into the super-admin audit-report export — see vulnerability `csv-formula-injection-admin-audit-report`.
