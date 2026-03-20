# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

**MyLocalTrade.co.uk** — A UK local trades marketplace mobile app connecting customers with tradespeople. Features a customer-facing discovery experience, trader profiles with subscription tier badges (Basic £10, Premium £20, Elite £30/month), Stripe checkout integration (demo mode when no STRIPE_SECRET_KEY), and a complete backend API.

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
- Design: Professional blue/white UK marketplace palette (primary #1A56DB, secondary #047857)

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
- Email: support@mylocaltrade.co.uk
- Company No: 12345678
- Address: 123 Business Street, London, EC1A 1BB

## Subscription Tiers

- Basic: £10/month — standard listing, 3 gallery images
- Premium: £20/month — enhanced profile, 10 images, priority search, premium badge
- Elite: £30/month — featured placement, unlimited images, top visibility, star badge
