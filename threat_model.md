# Threat Model

## Project Overview

MyLocalTrade is a pnpm monorepo for a local-trades marketplace. The production system consists primarily of an Express 5 API (`artifacts/api-server`), an Expo mobile client (`artifacts/mobile`), and a separately built React/Vite admin web app (`artifacts/admin`). The API uses PostgreSQL via Drizzle ORM, JWT bearer tokens for customer/trader/admin authentication, Stripe for billing, SMTP/Nodemailer for transactional email, Companies House lookups during trader onboarding, and object storage for trader document uploads.

This scan is production-focused. Assume `NODE_ENV=production`, platform TLS is present, and `artifacts/mockup-sandbox` is not deployed to production unless future evidence shows otherwise.

## Assets

- **User accounts and bearer tokens** — customer, trader, and admin credentials/tokens grant access to marketplace actions and privileged back-office workflows.
- **Personal and business data** — names, email addresses, phone numbers, trader business details, messages, enquiries, reviews, saved-trader relationships, and onboarding metadata contain PII and marketplace-sensitive data.
- **Trader verification artifacts** — uploaded identity/business documents and moderation decisions are sensitive and high impact if exposed or tampered with.
- **Billing state** — Stripe customer/subscription identifiers and subscription status affect trader visibility and revenue.
- **Operational trust signals** — transactional emails, verification links, review/reply notifications, and support emails are sent from trusted app-controlled infrastructure and can be abused for phishing or impersonation if content handling is unsafe.
- **Application secrets and integrations** — JWT signing material, database credentials, SMTP credentials, Stripe secrets, object-storage credentials, and Companies House access must remain server-only.

## Trust Boundaries

- **Mobile/admin/browser clients → API** — all client input is untrusted. Authentication, authorization, validation, rate limits, and output scoping must be enforced server-side.
- **Public routes → authenticated user routes** — registration, login, contact, trader discovery, and webhook endpoints are reachable without auth; account/profile/messaging/billing/document routes are not.
- **Authenticated users → admin-only routes** — admin review/moderation/reporting/document-access functions must remain unreachable to customers and traders.
- **API → PostgreSQL** — the API has broad read/write access to core marketplace records; injection or broken authorization at this layer can expose or corrupt all tenant data.
- **API → object storage** — uploaded trader documents cross from untrusted users into long-lived storage; keys and preview/download flows must stay scoped.
- **API → external services** — Stripe webhooks and checkout, SMTP delivery, push notifications, and Companies House lookups cross service boundaries that require signature validation, origin/recipient control, and safe handling of attacker-influenced content.
- **Production → dev-only features** — demo billing activation paths, mock OTP behavior, and `mockup-sandbox` code should be ignored unless they are reachable in production.

## Scan Anchors

- Production entry points: `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/**/*.ts`, `artifacts/api-server/src/lib/auth.ts`, `artifacts/api-server/src/lib/email.ts`, `artifacts/api-server/src/lib/objectStorage.ts`, `artifacts/api-server/src/routes/subscriptions.ts`.
- Admin surface: `artifacts/admin/src/lib/auth.tsx`, `artifacts/admin/src/lib/api.ts`, plus admin-facing API routes in `artifacts/api-server/src/routes/admin.ts`.
- Highest-risk areas: auth/registration, admin moderation/document access, conversations/enquiries, transactional email rendering, uploads, and billing/webhooks.
- Public surfaces: auth registration/login/resend, trader listing/detail, contact, health, Stripe webhook, Companies House lookup.
- Authenticated surfaces: profile, saved traders, enquiries, conversations, reviews, subscriptions, trader phone/documents.
- Admin-only surfaces: `artifacts/api-server/src/routes/admin.ts` and the `artifacts/admin` app.
- Usually out of scope: `artifacts/mockup-sandbox`, any `NODE_ENV !== production` branches, and demo-only subscription activation that is explicitly blocked in production.

## Threat Categories

### Spoofing

The system issues JWT bearer tokens for customer, trader, and admin roles and also trusts Stripe webhook calls, Companies House responses, and SMTP-delivered messages to carry the app’s identity. Protected API endpoints MUST validate bearer tokens server-side on every request, role checks MUST be enforced in route handlers instead of the client, and all third-party callbacks (especially billing webhooks) MUST be authenticated before changing account state.

### Tampering

Untrusted users can submit registration data, profile fields, contact messages, conversations, enquiries, review text, uploaded document metadata, and billing-triggering actions. The API MUST validate and constrain all user-controlled fields, compute security-sensitive state transitions server-side, and ensure upload keys/object references are bound to the authenticated owner and intended workflow.

### Information Disclosure

The application stores PII, trader verification data, internal moderation state, and conversation content. API responses, file previews/downloads, logs, and email notifications MUST only disclose data to authorized principals, and administrative/reporting routes MUST not leak sensitive records to lower-privileged users. Error handling and logging MUST avoid exposing secrets, message bodies, or verification tokens beyond what operators genuinely need.

### Denial of Service

Public endpoints such as login, registration, resend-verification, contact, and any webhook or message creation flows can be abused to consume CPU, database capacity, email quota, or third-party API quota. Production endpoints MUST apply rate limits, body-size limits, and bounded external requests, and attacker-controlled inputs MUST not trigger unexpectedly expensive regex/template/rendering/upload behavior.

### Elevation of Privilege

This project has meaningful privilege separation between public users, authenticated customers, traders, and admins. Every route that reads or mutates user, trader, billing, conversation, moderation, or document data MUST enforce object-level ownership and role checks on the server. User-controlled content MUST never reach privileged sinks such as SQL, email templates, file paths, signed URLs, or admin-only actions without context-appropriate escaping and validation.