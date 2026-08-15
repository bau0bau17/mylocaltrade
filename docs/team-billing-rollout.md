# Team billing — rollout & rollback (Phase D)

Server-controlled Team subscription lifecycle. Everything in this document is
**dormant until `TEAM_BILLING_ENFORCED=true`**; with the flag off (current
state in BOTH dev and prod) behaviour is byte-identical to legacy: the env cap
(`COMPANY_MAX_ACTIVE_MEMBERS`) governs invites, nobody is ever suspended, and
the new routes answer 404.

## The invariants (what the code guarantees)

1. **Downgrades never delete people or history.** Only `seatSuspendedAt` is
   set on `company_members`; the row stays `status=ACTIVE`, logins keep
   working, history remains readable. Revocation (`REMOVED`) exists only via
   the owner's explicit Remove action — unchanged.
2. **Deterministic suspension rule** (reconciliation, `team-billing.ts`):
   employees are ordered by `createdAt ASC, id ASC` (longest-standing first).
   When the company is over its allowance, the **newest** seated employees are
   suspended (`seatSuspensionSource='SYSTEM'`). When room opens up,
   SYSTEM-suspended employees are reactivated **longest-standing first**.
   OWNER-suspended seats are never auto-reactivated.
3. **Owner never occupies a seat**; allowance counts EMPLOYEE rows only, hard
   ceiling 20 everywhere.
4. **Effective allowance** = max(plan seats if subscription active, live seat
   exemption) clamped to 20. Unknown products fail closed to Solo (0 seats).
5. **Every seat-changing operation** (invite create/resend/accept, owner
   suspend/reactivate, reconciliation) runs inside a transaction holding
   `pg_advisory_xact_lock(812004101, traderProfileId)` — races for the last
   seat are decided by Postgres.
6. **Webhook hardening**: `revenuecat_events` unique event-id ledger inserted
   in the same transaction as the mutation (retries dedupe, crashes replay);
   `subscriptions.last_provider_event_at_ms` rejects out-of-order events;
   `BILLING_ISSUE` only records `billing_issue_detected_at` (revocation stays
   EXPIRATION's job, matching Apple grace handling); grants clear it.
   **Equal-timestamp tie-break** is deterministic: at an exact provider
   timestamp tie only a revoke may apply; a tied grant is skipped. Both
   delivery orders of a tied grant+revoke pair converge on "revoked" (the
   fail-safe state); a genuinely active entitlement self-heals on the next
   device sync, which reads live RevenueCat state.
7. **Durable reconciliation sweep** (hourly, `scheduler.ts` →
   `sweepCompanySeatReconciliation`): the safety net behind the event-driven
   reconciliation. It covers (a) time-bounded exemptions whose `expiresAt`
   lapses — no billing event fires for those — and (b) retries for
   post-commit reconciles that failed transiently (those are deliberately
   best-effort so a billing ack never fails on a reconcile hiccup). No-op
   unless both flags are on.
8. **Suspended-employee writes** are blocked server-side with
   `403 { code: "SEAT_SUSPENDED" }` at the shared job-action choke points
   (messages, quotes, bookings) — independent of any client build.

## Decisions of record

- **No push/email notifications for seat suspension/reactivation in Phase D.**
  The spec doesn't require them; suspension is surfaced in-app (owner Team
  screen + employee banner). Adding notifications later must follow the
  notification-fanout conventions (conditional UPDATE...RETURNING gating).
- **No forced legal re-acceptance.** The Terms additions describe a new
  optional product and *more protective* behaviour (retention instead of
  deletion); they impose no new obligations on existing users. Terms version
  is left unchanged, so no re-acceptance prompt fires.
- **Refund policy untouched** — billing remains Apple-owned; Team plans do
  not change cancellation/refund mechanics.
- **Known limitation (pre-existing, not introduced by Phase D): RevenueCat
  identity is the client-asserted numeric `app_user_id`.** The mobile app
  calls `Purchases.logIn(String(userId))` after auth; the webhook trusts the
  authenticated (Bearer-secret) RevenueCat payload's `app_user_id` to pick
  the local user. A compromised client could log its RC SDK in under another
  user's numeric id and direct billing events at that account. Mitigations
  today: webhook auth proves the event came from RevenueCat; the server-side
  sync route reads live RC state for the *authenticated* user only, so a
  victim's row self-heals on their next app sync; and events never delete
  data. Proper hardening (server-bound opaque RC app-user ids) requires a
  RevenueCat + mobile-build change and is explicitly out of Phase D scope —
  tracked as post-launch hardening.

## Grandfathering (seat exemptions)

Admin-granted, audited, revocable overrides in `company_seat_exemptions`
(admin portal → Billing → Seat exemptions, or
`POST /api/admin/seat-exemptions`). One live exemption per company; rows are
never deleted; reason mandatory; `expiresAt` optional; max 20 seats.

**Migration procedure at enforcement flip** (run BEFORE setting the flag):

1. List companies with employees:
   `SELECT trader_profile_id, count(*) FROM company_members
    WHERE role='EMPLOYEE' AND status='ACTIVE' GROUP BY 1 HAVING count(*) > 0;`
2. For each company whose owner does NOT hold a Team plan covering that
   headcount, grant an exemption sized to the current headcount with reason
   `"grandfathered: N active employees at enforcement launch <date>"`
   (time-bounded if a sunset is agreed).
3. Flip `TEAM_BILLING_ENFORCED=true`. Event-driven reconciliation runs on
   billing events / admin actions, and the hourly sweep reconciles every
   company with employees — so exemptions must be pre-sized BEFORE the flip
   (step 2) to guarantee nobody is suspended when enforcement starts.
4. Removal: revoke the exemption (admin UI) — reconciliation runs immediately
   and applies the deterministic rule; the owner sees exactly who was
   suspended and can subscribe to a Team plan to reactivate them.

## Production rollout order (operator = Lucian; agent never touches prod)

1. **Schema push first** (breaks nothing while dormant, but new code REQUIRES
   the new columns/tables): apply to prod DB —
   `company_members.seat_suspended_at`, `company_members.seat_suspension_source`,
   `company_seat_exemptions`, `revenuecat_events`,
   `subscriptions.last_provider_event_at_ms`,
   `subscriptions.billing_issue_detected_at`
   (drizzle push from this commit, same as the dev push).
2. Deploy/publish the backend (this commit).
3. Team products already exist in App Store Connect (group "Trader
   Subscription", 22124207) and the RevenueCat `default` offering
   (`team_5_annual`, `team_10_annual`, `team_20_annual`) — confirmed in
   Phase C/D. Nothing to create.
4. Set prod env vars (exact value):
   - `TEAM_PRODUCT_SEAT_MAP={"com.mylocaltrade.app.trader.team5.yearly":5,"com.mylocaltrade.app.trader.team10.yearly":10,"com.mylocaltrade.app.trader.team20.yearly":20}`
     (allowed seat values 5/10/20 only — anything else is ignored, fail
     closed).
   - `COMPANY_TEAMS_ENABLED=true` (already true in prod).
   - Leave `TEAM_BILLING_ENFORCED` **unset/false**.
5. Ship the new iOS build (pricing screen, Team plans, seat UI).
6. Grandfathering pass (section above).
7. Flip `TEAM_BILLING_ENFORCED=true`.

## Rollback

- **Before the flag flip**: nothing to roll back — all code is dormant; the
  schema additions are nullable/additive and unused.
- **After the flip**: set `TEAM_BILLING_ENFORCED=false`. Enforcement, seat
  routes and reconciliation go dormant instantly. Existing suspensions stop
  mattering for the legacy paths (the write gate is the ONLY
  enforcement-independent piece; to clear leftover suspensions run:
  `UPDATE company_members SET seat_suspended_at=NULL, seat_suspension_source=NULL
   WHERE seat_suspended_at IS NOT NULL;` — safe, reversible, audit rows keep
  the record).
- Webhook dedupe/ordering hardening stays active regardless of the flag — it
  is a pure correctness fix and must NOT be rolled back with it.

## Test coverage map

- `routes/team-billing.test.ts` — tier resolution, plan context, allowance,
  reconciliation determinism, exemptions.
- `routes/subscriptions-revenuecat.test.ts` — webhook lifecycle matrix,
  duplicate event ids, out-of-order events, BILLING_ISSUE record/clear.
- `routes/company-team.test.ts` — invite/accept seat races, owner
  suspend/reactivate, flag-off legacy behaviour, seat-suspended write gate.
