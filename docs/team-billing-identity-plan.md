# Company Teams — identity, entitlement, billing & UI correction plan

Status: **PROPOSED — awaiting owner approval. No production changes, no product creation, no builds until approved.**
Date: 2026-08-15. Evidence gathered read-only from the workspace codebase, RevenueCat API and the production database.

---

## 1. Root causes of the four confirmed defects

### D1 — Employees see Premium promotion & subscription surfaces
Purely a gating gap: the app decides visibility from "is a trader" + "has an RC entitlement", never from company role.

- Home banner ("Promote your business" / "Stand out in local searches"): `artifacts/mobile/app/(tabs)/index.tsx:79-87, 389-404` — condition is `(!isAuthenticated || isTrader) && !hasTraderSubscription`. An Employee is `role='trader'` with no personal entitlement ⇒ banner shows. Same for the featured-section CTA (`:89-93, 365-381`). Neither consumes team context.
- Subscription Plans (`/pricing`, `artifacts/mobile/app/(tabs)/pricing.tsx`): route has **no guard**; reachable from Home, dashboard checklist (`trader-dashboard/index.tsx:312`), billing screen (`billing.tsx:209-270`) and direct deep link. The "Verification required" card renders for any `isTrader && verificationStatus !== 'VERIFIED'` (`pricing.tsx:258-271`) — an Employee is never VERIFIED (owns no profile), so they see exactly the card in the screenshot.
- Only the Account screen consumes `GET /api/company/team-context` (`account.tsx:246-262`) — which is why Billing & Plan is correctly hidden there but nowhere else.
- Server: **no subscription route knows about company roles** (`artifacts/api-server/src/routes/subscriptions.ts`). Employees are blocked only *incidentally* (no owned `trader_profiles` row ⇒ 403 on sync/demo; no `subscriptions` row ⇒ 400 on cancel/resume/cancellation-request; `GET /status` is auth-only and reports "none"). There is no explicit `OWNER_ONLY` rejection anywhere.

### D2 — Employee photo change "changes" the Owner's photo
**The server and database are correct.** Production (read-only) shows fully isolated rows:
- user 12 (owner, sabaulucian@live.com): `avatar_url = /objects/customer-uploads/12/v/83b6…`
- user 13 (employee, lucian.sabau@serviceproviderltd.co.uk): `avatar_url = /objects/customer-uploads/13/v/1b6a…`

Upload keys are minted per authenticated user (`customer-uploads.ts:46-50` → `customer-uploads/<userId>/…`), `PATCH /auth/me/avatar` verifies object ownership and writes `WHERE users.id = caller` (`auth.ts:1333-1356`), serving resolves the exact owner of the requested path (`customer-uploads.ts:147-217`).

The defect is **client-side, the same stale-mounted-tab-screen class as the verify-email trap fixed on 2026-08-15**: `AccountScreen` keeps `avatarPreview` local state (`account.tsx:91`) and renders `avatarPreview ?? user.avatarUrl` (`account.tsx:393-396`). Tab screens never unmount across logout/login, so after the Employee picks a photo, the *same mounted screen instance* still shows that local preview when the Owner (or anyone) logs in on the same device. Both screenshots show the same photo because both accounts were viewed on one phone within a minute.

Fix: remount the Account screen content per identity (`key = user.id`), exactly like the verify-email fix, so ALL local state (preview, busy flags) resets on account switch; plus API tests proving two same-company users independently upload/replace/delete photos.

### D3 — Team management lacks member identity
`GET /api/company/team` returns only `{id,userId,fullName,email,role,joinedAt}` (`company-team.ts:246-293`) — no avatar, no membership state; the mobile list renders a generic icon circle (`team.tsx:275-316`). Nothing is broken; the feature was never built. Requires an API extension + a member-detail modal.

### D4 — Invitation UI breaks the design system
`join-team.tsx` hardcodes light values instead of tokens from `artifacts/mobile/constants/colors.ts` (navy palette): input `backgroundColor:'#fff'` and eye button (`:245-265`), invalid/signed-in cards `backgroundColor:'#fff'` (`:282-285`), error `#B91C1C` (`:113, 266`), button/spinner text `#fff` (`:202-210, 267-274`). All seven states (loading / valid / form / keyboard / expired-revoked-used / validation error / success) must use the existing dark tokens; no separate palette.

---

## 2. Current subscription / RevenueCat architecture inventory

**RevenueCat project `proja2b11716`** (read via API):
- Apps: iOS `app644273284a` (bundle `com.mylocaltrade.app`, ASC API key + subscription key configured), Android `app30e7c6f7ae` (no products), Test Store `app106918db20`.
- Entitlement: exactly one — `entl99e72cc04b` "Trader Subscription".
- Products attached to it: iOS `com.mylocaltrade.app.trader.monthly` (P1M), `com.mylocaltrade.app.trader.yearly` (P1Y); Test Store `monthly`/`yearly`.
- Offerings: single `default` (current) with `$rc_monthly` + `$rc_annual` packages.

**Mobile** (`artifacts/mobile/lib/revenuecat.tsx`): lazy configure; identity `logIn(String(user.id))` for **any** signed-in user — Employees already get their own RC App User ID (13), never the Owner's ✅. Purchase/restore/paywall in `purchase()`/`restore()`; entitlement drives `hasTraderSubscription`. Entitlement id from `EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID` (fallback `trader_subscription` — note: RC lookup key is "Trader Subscription"; the env var on real builds must match, verify at Phase C).

**Server** (`subscriptions.ts`): grant/revoke via `POST /subscriptions/revenuecat-sync` + RC webhook (both provider-confirmed; read path never mutates). Perks: `users.plan`, `trader_profiles.plan`, `is_featured`. `subscriptions` table: one row per `user_id` (unique), `plan_id`, `status`, period bounds, legacy NULL Stripe columns. Display prices: native = live RC/App Store strings; API fallback list hardcodes £9.99/£99.99 (`plan-pricing.ts`).

**Production data (read-only):** 6 owner memberships; **one company with employees** — trader_profile 6 "SERVICE PROVIDER LTD", 1 ACTIVE employee (the user's own test company); 1 accepted invite; premium solo plans on profiles 2,3,4,6. `subscriptions` summary query was masked (prod executeSql quirk) but nothing in this plan depends on it.

**Seats today:** cap = env `COMPANY_MAX_ACTIVE_MEMBERS`, default **10, plan-independent** (`company-membership.ts:52-59`). Counting = ACTIVE members + unexpired PENDING invites, create/resend inside a `pg_advisory_xact_lock` transaction (`company-team.ts:300-532`) ✅ race-safe pattern to keep.

---

## 3. Proposed database and API changes

**Schema (additive only, no destructive migration):**
1. `subscriptions.product_identifier text NULL` — persisted by revenuecat-sync + webhook on every grant/change; source of truth for tier mapping. (SQL push required dev→prod **before** the new server deploy.)
2. `company_members.status` gains value `'SUSPENDED'` (varchar — code-level constant only, no DDL). Suspended ≠ revoked: reversible, releases a seat, preserves history.

**New shared server helper — `getCompanyPlanContext(traderProfileId)`** (single choke point, like `getActiveMembership`):
- resolves the Owner, the Owner's subscription row, `product_identifier` → tier, seat limit, expiry/grace state;
- returns `{ effectiveBusinessPlan, employeeSeatLimit, activeEmployeeCount, pendingInviteCount, overLimit, active }`.
- Tier map (shared constant): `trader.monthly|yearly → premium_solo (0 seats)`, `team5.yearly → 5`, `team10.yearly → 10`, `team20.yearly → 20`; server clamps to absolute max 20. `COMPANY_MAX_ACTIVE_MEMBERS` becomes a hard ceiling/kill-switch only.

**Expanded `GET /api/company/team-context`** (back-compatible; keeps `enabled`, `role`):
`viewerRole, effectiveBusinessPlan, employeeSeatLimit, activeEmployeeCount, pendingInviteCount, viewerCanManageBilling, viewerCanInvite, viewerCanManageTeam` — all server-derived; the app must never infer access from the caller's personal RC entitlement.

**Explicit owner gate on billing routes** — new `subscriptionOwnerGate` (pattern (b) from the membership choke point, like `documentsOwnerGate`, flag-independent): any `company_members` row with role ≠ OWNER (any status) ⇒ `403 OWNER_ONLY`; owned profile ⇒ pass; pre-onboarding trader with no company ties ⇒ legacy pass. Applied to: `revenuecat-sync`, `cancel`, `resume`, `cancellation-request`, `demo-activate`, **and `GET /subscriptions/status`**. `GET /plans` stays public (static marketing data).

**Avatar/team identity:**
- `GET /api/company/team` adds `avatarUrl` per member (each member's own `users.avatarUrl`; никогда fallback to Owner's — initials client-side).
- `GET /api/customer/uploads/avatar-file` authorization extended: existing rules (self OR shared conversation) **plus** "caller and photo owner share an ACTIVE company membership". No public exposure.

**Invite/seat rule changes:** invite create + resend re-arm read the limit from `getCompanyPlanContext` inside the existing advisory-lock tx. Solo plan (0 seats) ⇒ `403 TEAM_PLAN_REQUIRED` with upgrade hint. Behind env flag `TEAM_BILLING_ENFORCED` (default off) until products exist — flag off keeps today's behaviour.

**Employee restricted mode (plan inactive / over-limit):** employee **writes** on shared surfaces (messages, quotes, bookings claims — the existing `getActiveMembership` + `canActOnJob` choke points) additionally check company plan state: inactive plan ⇒ `403 TEAM_PLAN_INACTIVE`; reads stay allowed; memberships and job history are never deleted. Owner is unaffected (keeps normal free/expired behaviour + renewal controls).

---

## 4. App Store Connect & RevenueCat product/entitlement plan

**Compatibility verdict: no structural incompatibility found.** One entitlement + one Apple subscription group supports replacement tiers cleanly. Caveats to verify in ASC (RC's API cannot see subscription groups): the two existing trader products must sit in **one** subscription group; the three new Team products must be added to the **same group** so Apple treats them as upgrades/downgrades (one active business subscription per Owner — never simultaneous).

New products (annual only):
| ASC product id | Tier | Seats | Provisional price (planning only) |
|---|---|---|---|
| `com.mylocaltrade.app.team5.yearly` | Team 5 | 5 | £179.99/yr |
| `com.mylocaltrade.app.team10.yearly` | Team 10 | 10 | £249.99/yr |
| `com.mylocaltrade.app.team20.yearly` | Team 20 | 20 | £399.99/yr |

- All three attach to the **existing** "Trader Subscription" entitlement (access on/off); the **tier** is derived server-side from `product_identifier` — never from a second entitlement.
- Offerings: add three custom packages (`team_5_annual`, `team_10_annual`, `team_20_annual`) to the `default` offering. Displayed prices always come from live RC/StoreKit localized strings; the provisional prices above are never hardcoded.
- Test Store: create matching `team5|10|20` test products so dev/simulator flows work (Test Store is debug-only).
- Apple group ranking: order Team 20 > Team 10 > Team 5 > Premium yearly > Premium monthly so up/downgrade semantics are right (upgrade = immediate with proration; downgrade = at renewal).
- Division of labour: ASC products + prices are created by the owner in App Store Connect (agent provides exact copy/ids); RC products/attachment/packages can be created by the agent via the connector **only after plan approval**.
- Employee RC identity stays personal (already true); the Owner's purchase is never transferred.

---

## 5. Screen-by-screen mobile changes

| Screen | Change |
|---|---|
| Home (`(tabs)/index.tsx`) | Consume team-context; `viewerRole === 'EMPLOYEE'` ⇒ hide promo banner + featured CTA (fail-closed while loading for employees). |
| Pricing (`(tabs)/pricing.tsx`) | Employee ⇒ full-screen dark-token block state: "Subscriptions are managed by your company owner" (no plans, no verification card, safe for deep links). Owner ⇒ current plans + Team tier cards (annual only, live localized prices, current-tier badge, seat counts), purchase/restore/upgrade/downgrade. |
| Billing (`trader-dashboard/billing.tsx`) | Employee ⇒ redirect/block; Owner ⇒ show tier, seats used (e.g. 3/5), renewal date, manage-in-App-Store. |
| Team (`trader-dashboard/team.tsx`) | Member avatars (authorized fetch, initials fallback); tap ⇒ dark member-detail modal (large photo, name, email, role badge, joined date, membership state); plan-derived seat display; at-cap ⇒ owner-only upgrade CTA; over-limit ⇒ seat-selection UI (Phase D). |
| Join-team (`(tabs)/auth/join-team.tsx`) | All 7 states restyled with `constants/colors.ts` tokens; no hardcoded palette. Also fix `key`-remount on token change (same stale-tab-screen class). |
| Account (`(tabs)/account.tsx`) | Remount content per `user.id` (fixes D2); employee "Team plan inactive" banner (Phase D). |
| Deep links | `/pricing`, `/trader-dashboard/billing` render the employee block state — server also rejects with `403 OWNER_ONLY` on any API mutation. |

## 6. Permissions matrix (server-enforced)

| Capability | Owner | Employee |
|---|---|---|
| See promos/paywalls/pricing | ✅ | ❌ (hidden + server `OWNER_ONLY`) |
| Purchase/restore/upgrade/downgrade/cancel | ✅ | ❌ |
| Billing screens/status | ✅ | ❌ |
| Edit company logo/profile/services/hours | ✅ (`canManageBusinessFields`) | ❌ (existing) |
| Verification documents | ✅ (`documentsOwnerGate`) | ❌ (existing) |
| Invite/remove/suspend members | ✅ | ❌ (existing) |
| Reply to reviews / change owner identity | ✅ | ❌ (existing) |
| Shared leads/jobs (claimed rules apply) | ✅ | ✅ while plan active; read-only when plan inactive/over-limit |
| Own personal account, password, photo, deletion | ✅ | ✅ always |
| Public trader listing | company-level, verification-driven (unchanged) | never a separate listing |

## 7. Seat lifecycle & concurrency

- Reservation: seat = ACTIVE members (excl. Owner) + unexpired PENDING invites (existing logic, kept).
- Release: invite expiry (lazy), cancel, member removal, suspension.
- All cap checks stay inside the `pg_advisory_xact_lock(traderProfileId)` transaction (create, resend re-arm, **accept**, and new suspension/reactivation) — concurrent invite/accept can never exceed the plan limit.
- Solo owner ⇒ first invite requires a Team tier (`TEAM_PLAN_REQUIRED`).
- Absolute self-service max: 20 employees, enforced server-side regardless of data.
- Downgrade below active count (incl. Apple-side downgrades detected via sync/webhook `PRODUCT_CHANGE`/renewal): **nobody is deleted or auto-revoked.** Company enters derived `overLimit` state ⇒ invites blocked, employee writes blocked, Owner's Team screen shows a deterministic selection flow: pick ≤ limit members to keep ACTIVE; the rest become `SUSPENDED` (reversible while seats free). Until the Owner chooses, all employees are read-only (deterministic, no silent selection).
- Expiry: same restricted mode; memberships, history and assigned jobs preserved; employees see "Your company's Team plan is inactive — contact the Owner"; renewal controls owner-only.

## 8. Migration, rollout & rollback

- Production today: exactly **one** company with an employee (the user's own test company, premium solo). Grandfathering: existing ACTIVE employees are never auto-locked at rollout; enforcement flag (`TEAM_BILLING_ENFORCED`) stays **off** until Team products are purchasable, then the test company either upgrades in sandbox or knowingly enters restricted mode. No real customers affected.
- Order of operations (per the schema-push lesson): 1) additive SQL push to prod, 2) publish server, 3) new TestFlight build. Each step is user-approved; the agent never publishes or builds.
- Rollback: revert commit(s); flags off restore today's behaviour bit-for-bit; RC/ASC products can sit dormant (hidden UI) — no data cleanup needed; `SUSPENDED` rows can be flipped back to ACTIVE by support tooling if ever needed.

## 9. Test plan (API vitest + mobile typecheck/manual)

1. `subscriptionOwnerGate`: every billing endpoint ⇒ 403 OWNER_ONLY for an employee token (incl. deep-link style direct calls); owner unaffected; pre-onboarding solo trader unaffected.
2. Avatar isolation: two users in one company independently upload/replace/delete; rows and objects never cross; `/auth/me` mapping per user.
3. Avatar serving: co-member allowed, outsider 404, revoked member 404; conversation rule untouched.
4. Team GET: per-member avatarUrl; no exposure via invite lookup.
5. Seat limits: tiers 5/10/20; pending-invite reservation; expiry/cancel/removal release; concurrent invite+accept races at the last seat (advisory-lock proof); absolute 20 cap; solo ⇒ TEAM_PLAN_REQUIRED.
6. Tier mapping: product_identifier → tier/seats incl. unknown-product fallback (fail to solo, log loud).
7. Expiry/downgrade: restricted mode gates employee writes only; owner unaffected; over-limit selection flow; suspension releases seats; reactivation.
8. Regression: existing solo trader behaviour byte-identical with flags off; job claiming/reassignment suites untouched and green.
9. Mobile: typecheck; manual QA checklist for the 7 invitation states + employee/owner screen matrix (no test framework on mobile).

## 10. Phases (each ends with full API suite + typecheck; nothing ships without approval)

- **Phase A — Defect fixes (no billing model changes, safe to ship first):** D1 hide surfaces for employees + `subscriptionOwnerGate`; D2 Account remount + isolation tests; D3 team avatars + member modal + serving authz; D4 dark-token invitation states. Deliverable: publish + new build (user-performed).
- **Phase B — Entitlement plumbing (dormant behind flag):** `product_identifier` column + persistence, tier map, `getCompanyPlanContext`, expanded team-context, plan-derived seat caps + `TEAM_PLAN_REQUIRED` (flag off ⇒ behaviour unchanged).
- **Phase C — Products & purchase UX (needs approval to create products):** ASC group changes (user) + RC products/packages (agent, post-approval), owner pricing UI with live prices, upgrade/downgrade, Test Store equivalents.
- **Phase D — Lifecycle & launch:** expiry restricted mode, over-limit suspension selection, PRODUCT_CHANGE/renewal webhook handling, grandfathering activation, legal updates + trader re-acceptance (if approved), App Store review notes, full test matrix.

## Legal & App Store review (assessment)

Updates likely required (drafts in Phase D, owner approves wording): Terms — owner-paid company access, annual auto-renewal, seat limits, downgrade/expiry effects, employee actions performed under the company; Privacy — member photo visibility (team screen + assigned-job contexts only); subscription disclosure screens — annual pricing; App Store review notes — explain that team access is backend-granted from the Owner's purchase (standard multi-seat model). The existing trader-only re-acceptance mechanism fits; recommendation: require re-acceptance for traders when Terms change ships. No legal guarantees are made; final wording is the owner's call.

## Open questions before implementation

1. **ASC subscription group:** are `trader.monthly` and `trader.yearly` in one subscription group? (Only visible in App Store Connect — needed for replacement-tier behaviour.)
2. **Solo = 0 employee seats** — confirm (existing test company will need a Team plan or sandbox equivalent to keep its employee write-active once enforcement turns on).
3. **`EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID`** on real builds — confirm it matches the RC entitlement lookup key ("Trader Subscription").
4. Phase A can proceed immediately after approval; Phases B–D each re-checkpoint with you.
