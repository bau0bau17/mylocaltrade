# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

**MyLocalTrade.co.uk** — A UK local trades marketplace mobile app connecting customers with tradespeople. Features a customer-facing discovery experience, trader profiles with a free verified Basic listing and a paid Premium plan (£20/month or yearly, purchased via Apple In-App Purchase / RevenueCat on iOS), and a complete backend API.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Mobile**: Expo (React Native) with Expo Router
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   └── mobile/             # Expo React Native mobile app
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts
├── pnpm-workspace.yaml     # pnpm workspace
├── tsconfig.base.json      # Shared TS options
├── tsconfig.json           # Root TS project references
└── package.json            # Root package
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. Always typecheck from root: `pnpm run typecheck`.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly`

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server with full REST API for MyLocalTrade.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes mounted at `/api`:
  - `GET /api/healthz` — health check
  - `POST /api/auth/register/customer` — customer registration
  - `POST /api/auth/register/trader` — trader registration
  - `POST /api/auth/login` — login (returns JWT)
  - `GET /api/auth/me` — current user (auth required)
  - `GET /api/traders` — list traders (with search, category, location filters)
  - `GET /api/traders/featured` — featured traders
  - `GET /api/traders/:id` — single trader profile
  - `GET /api/profile` — trader's own profile (auth)
  - `PUT /api/profile` — update trader profile (auth)
  - `GET /api/subscriptions/plans` — subscription plans
  - `POST /api/subscriptions/checkout` — create checkout session (auth, demo mode fallback)
  - `GET /api/subscriptions/status` — subscription status (auth)
  - `POST /api/subscriptions/webhook` — Stripe webhook
  - `GET /api/saved-traders` — saved traders (auth)
  - `POST /api/saved-traders/:traderId` — save trader (auth)
  - `DELETE /api/saved-traders/:traderId` — unsave trader (auth)
  - `POST /api/enquiries` — create enquiry (auth)
  - `GET /api/enquiries` — list enquiries (auth)
  - `GET /api/categories` — trade categories
- Auth: JWT-based (`src/lib/auth.ts`), middleware via `authMiddleware`
- Depends on: `@workspace/db`, `@workspace/api-zod`
- Demo mode: When `STRIPE_SECRET_KEY` is not set, checkout returns a demo session; activation requires a separate POST to `/api/subscriptions/demo-activate`
  - `POST /api/subscriptions/demo-activate` — demo-only activation (auth, trader-only, blocked when Stripe is configured)

### `artifacts/mobile` (`@workspace/mobile`)

Expo React Native mobile app for MyLocalTrade.

- 4 bottom tabs: Home, Search, Traders, Account
- Stack screens: trader profile, auth (login/register), pricing, enquiry, trader dashboard (edit-profile/services/gallery/leads/billing), saved-traders, my-enquiries, static pages
- Uses NativeTabs with liquid glass on iOS 26+, classic Tabs with BlurView fallback
- Auth: JWT stored in AsyncStorage, managed via AuthContext
- API: Uses generated React Query hooks from `@workspace/api-client-react`
- Base URL configured via `lib/api-url.ts` (reads `EXPO_PUBLIC_DEV_DOMAIN`)
- Design: Futuristic dark theme — background `#0B1120`, surface `#111827`, card `#141B2D`, primary cyan `#00B4D8`, secondary mint `#06D6A0`, elite purple `#A855F7`, featured amber `#F59E0B`. All screens use `Colors.light.*` tokens — no hardcoded colors. Consistent 14–18px border radius, uppercase label tracking, muted icon backgrounds, `placeholderTextColor` on all TextInputs.

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL.

- Tables: `users`, `trader_profiles`, `saved_traders`, `enquiries`, `subscriptions`
- Users have `role` (customer/trader), traders have profiles with plan/subscription fields
- JSON columns for arrays (additionalServices, serviceAreas, galleryUrls, socialLinks)
- Push schema: `pnpm --filter @workspace/db run push`

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec (`openapi.yaml`) and Orval config. Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from OpenAPI spec. Used by api-server for validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client. Exports `setBaseUrl()` and `setAuthTokenGetter()` for configuration.

### `scripts` (`@workspace/scripts`)

Utility scripts. Run via `pnpm --filter @workspace/scripts run <script>`.

## Business Details (Placeholder)

- Company: Service Provider LTD
- Company No: 12345678
- Address: 123 Business Street, London, EC1A 1BB

## Subscription Tiers

- Basic: free — verified public listing, receive customer enquiries, website and social links, up to 3 gallery images
- Premium: £20/month or yearly (Apple In-App Purchase via RevenueCat on iOS) — everything in Basic plus featured placement, higher search ranking, unlimited gallery images, and a premium badge
- Note: website/social links and extra services are free for all verified traders; they are not a Premium-only perk. The single stored paid plan id is `premium` (Monthly vs Yearly cadence is derived client-side from RevenueCat).

## Pre-launch checklist (recorded, NOT yet implemented)

1. **Separate Twilio Verify Services before enabling trader RCS.** Before enabling the approved trader-only RCS sender on Twilio, create a second, SMS-only Twilio Verify Service for customer phone-change OTPs and route trader vs customer verification through separate service SIDs (backend change: second service SID secret + routing in the shared verification helper). Reason: both flows currently share one Verify Service with `channel: "sms"`, and enabling RCS at service level would upgrade customer OTPs to RCS too.
2. **Customer legal re-acceptance — DROPPED (11 July 2026, user decision).** The app has not launched publicly; current TestFlight customer accounts are test accounts only, so there are no live customers who need to re-accept updated documents. New customers accept the current Privacy Policy and Terms through the normal registration/account flow. Do NOT add a customer re-acceptance banner, blocking logic, or users-table legal-version fields unless the user explicitly asks again.

Do not change the pending Twilio RCS registration, publish, migrate or start a build until the user asks.

## User preferences

- All user-facing copy in the app (mobile, admin, etc.) must be in English. Never use Romanian (or any other language) in UI strings, error messages, validation messages, banners, placeholders, etc. Chat replies to the user can stay in Romanian, but everything that ends up on screen for end users is English-only.
- Admin parity across surfaces: anything implemented for the admin web panel (`artifacts/admin`) must also be implemented and adapted for the admin section of the mobile app (`artifacts/mobile/app/admin`). Treat admin-web work as half-done until the equivalent screen/flow exists on mobile too. Adapt the UX to mobile (modals, native components, touch targets) — do not just copy the web layout.
- Verification policy: Verification is based on the information traders provide to us. It is NOT (a) a guarantee of the quality of work carried out, (b) a criminal records (DBS) check, or (c) a replacement for independent checks customers should make themselves. Keep this principle consistent across all verification wording, product copy, admin terminology and policy/help text. DBS / criminal-records checks are not part of MyLocalTrade verification and must not be treated as a planned or performed verification feature. Do NOT introduce any DBS-related implementation or wording (beyond the existing "what verification is not" disclaimer) unless the user explicitly requests it.
