# App Review notes — Team subscription plans (Phase D)

Prepared text and reviewer context for the App Store submission that introduces
Team plans. **Nothing here is submitted automatically** — the owner pastes the
relevant parts into App Store Connect ("App Review Information" → Notes) when
he submits the build himself.

## What changed in this build (reviewer-facing)

- New auto-renewing subscription products (subscription group "Trader
  Subscription", 22124207 — same group as the existing Solo Monthly/Yearly,
  with Apple service levels Team 20 > Team 10 > Team 5 > Solo):
  - `com.mylocaltrade.app.trader.team5.yearly` — Team 5, up to 5 employee seats
  - `com.mylocaltrade.app.trader.team10.yearly` — Team 10, up to 10 employee seats
  - `com.mylocaltrade.app.trader.team20.yearly` — Team 20, up to 20 employee seats
- Team plans are **single business subscriptions** purchased by the business
  owner. They are **not** priced or billed per employee. The owner never
  occupies a seat.
- The pricing screen shows, for every plan: name, price (from StoreKit),
  billing period, included seats, auto-renewal terms, cancellation
  instructions, a Restore Purchases button, and links to the Privacy Policy
  and Terms of Use (Guideline 3.1.2).

## Suggested reviewer notes text

> MyLocalTrade is a UK trades marketplace. Tradespeople can optionally
> subscribe to Premium (Solo monthly/yearly, unchanged) or to a new Team plan
> (yearly). A Team plan is one subscription bought by the business owner that
> additionally lets the owner invite up to 5/10/20 employees to share the
> business's enquiries and messages. Employees never pay and see no purchase
> UI. All billing is via Apple In-App Purchase in the shared subscription
> group; upgrades/downgrades between plans use the standard App Store
> proration flow. If a Team plan lapses or is downgraded, excess employee
> seats are suspended (read-only) — no customer data or employee accounts are
> deleted. Restore Purchases is on the pricing screen.
>
> Demo account: [owner fills in existing review demo credentials].
> To see Team features: sign in as the demo trader (a verified business
> owner), open Account → Team.

## Compliance checklist (verified in this build)

- [x] Price, period and seat count shown per plan before purchase
  (`app/(tabs)/pricing.tsx` — plan cards + compliance box).
- [x] Auto-renew + 24h cancellation wording next to purchase buttons.
- [x] Restore Purchases button on the same screen.
- [x] Privacy Policy and Terms of Use links on the same screen.
- [x] No external purchase links anywhere in the purchase flow.
- [x] Employees (non-purchasers) see no prices and no purchase prompts.
- [x] Refund/cancel copy defers to Apple everywhere (no refunds-from-us
  wording — see docs/brand & legal policies).
- [x] Terms of Use (in-app + website) describe Team plans, seat suspension
  and history retention in identical substance.

## Things NOT to say to review

- Do not mention RevenueCat webhooks/server enforcement details — irrelevant
  to review and invites questions.
- Do not describe seat suspension as "losing access to the account" — the
  login and history remain (it is act-blocking only).
