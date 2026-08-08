# Company Teams & Job Assignment — Implementation Plan

**Status: PLANNING ONLY — nothing implemented. Awaiting approval + answers to §12.**
Prepared 8 Aug 2026 from a full read-only inspection of the live codebase (schema, auth, trader accounts, verification, quotes, conversations, notifications, subscriptions, audit logs).

---

## 1. Current architecture findings

| Area | Finding |
|---|---|
| Identity | Single `users` table (role: customer/trader/admin). JWT bearer tokens (7-day, `{userId, role, tokenVersion}`); middleware re-checks `users.token_version` on every request, so `revokeUserSessions(userId)` (version bump) instantly kills all of a user's sessions. No session rows. |
| Company | `trader_profiles` **is** the company: business name, logo, services, areas, hours, verification, public listing. `trader_profiles.user_id` is `NOT NULL UNIQUE` → strictly **one login per business**. `businessRole` (OWNER/DIRECTOR/EMPLOYEE/…) is self-declared verification metadata, not access control. |
| Leads | `enquiries.trader_id → trader_profiles.id` — leads are **already company-scoped**, not person-scoped. The lead list resolves "my profile" from `userId`, then filters by profile id. |
| Conversations | `conversations` carry `customerId`, `traderUserId`, `traderProfileId`. Trader-side access checks are **already profile-scoped** (`actor.traderProfileId === conv.traderProfileId`); `traderUserId` is used for the customer-facing header identity (name/avatar) and notification targeting. |
| Quotes | `quotes` carry `traderUserId` (who submitted), `traderProfileId`, `customerId`. **Partial unique index: one PENDING quote per conversation** (DB-enforced, 23505 → 409). Revise/withdraw require `quote.traderUserId === caller`. |
| Bookings | One live booking per conversation (partial unique index). `proposedByUserId` / `confirmedByUserId` audit actors already recorded. |
| Messages | `senderUserId` + `senderRole` recorded per message. |
| Notifications | `push_tokens` per user (multi-device). New lead today: email + push to exactly `trader_profiles.userId` (the single owner). Lead-reminder prefs live on the trader profile. |
| Billing | `subscriptions` table keyed `UNIQUE(user_id)`; RevenueCat app-user-id = `users.id`. Premium perks are read per profile/owner. Stripe columns are dormant legacy. |
| Photos | Personal photo (`users.avatarUrl`): authenticated route, visible only to the owner or someone sharing a conversation. Business logo (`trader_profiles.logoUrl`): public route. Correct split already exists. |
| Audit | `trader_audit_log` (user-keyed, action enum, `performed_by`, JSON details, notes) + admin Audit Report page. `profile_change_request_events` is a good precedent for immutable event streams. |
| Reviews | Keyed by `trader_id` (profile) + `customer_id` + `enquiry_id`. **No record of which person did the work.** |
| Authz surface | ~**30 endpoint/helper choke points** assume user↔profile 1:1 (conversations, quotes, bookings, enquiries, profile, uploads/serving, reviews, phone OTP, profile-change requests, reports, stats). Centralized helpers exist (`traderOnly`, actor context, `canManageBusinessFields` — the latter was explicitly built to deny future employee roles server-side). |

**Good news:** leads, conversation access, quote identity, booking actors, and message senders are already structured correctly for teams. The work is: a membership table, invites, a membership-aware identity resolver replacing ~30 inline lookups, an assignment column, and notification fan-out — **not** a rebuild of the job pipeline.

---

## 2. Proposed database/schema changes (all additive)

**No new "companies" table** — `trader_profiles` remains the company entity; `trader_profiles.user_id` becomes "the owner" by convention.

### `company_members` (new)
| Column | Notes |
|---|---|
| id, created_at | |
| trader_profile_id | FK trader_profiles |
| user_id | FK users |
| role | `'OWNER' \| 'EMPLOYEE'` (varchar + constants, room for `'MANAGER'` later) |
| status | `'ACTIVE' \| 'REVOKED'` |
| invited_by_user_id, revoked_at, revoked_by_user_id | lifecycle audit |

Indexes: unique `(trader_profile_id, user_id)`; **partial unique `(user_id) WHERE status='ACTIVE'`** → a user belongs to at most one company (deliberate v1 rule, §12-Q1); **partial unique `(trader_profile_id) WHERE role='OWNER' AND status='ACTIVE'`** → exactly one owner.

### `company_invites` (new)
id, trader_profile_id, email (canonical lower + display casing — existing email-case rules apply), role, **token_hash** (raw token never stored), status `PENDING/ACCEPTED/CANCELLED/EXPIRED`, expires_at (7 days), invited_by_user_id, accepted_by_user_id, accepted_at, created_at.
Partial unique `(trader_profile_id, lower(email)) WHERE status='PENDING'` — resend rotates token + expiry on the same row.

### `conversations` — two new nullable columns
`assigned_trader_user_id` (FK users) + `assigned_at`. **Deliberately a new column** — `traderUserId`'s existing semantics (joins for header/notifications) stay untouched during migration; backfill sets `assigned = traderUserId` for all existing conversations.

### Audit
Reuse `trader_audit_log` (fits the existing admin Audit Report UI): new action strings `MEMBER_INVITED / INVITE_ACCEPTED / INVITE_CANCELLED / MEMBER_REMOVED / MEMBER_ROLE_CHANGED / JOB_CLAIMED / JOB_REASSIGNED / QUOTE_SUBMITTED_BY_MEMBER / COMPANY_SETTING_CHANGED`. `user_id` = owner (company anchor), `performed_by` = acting member, human-readable `notes`, machine `details` JSON kept internal (admin UI already shows summary fields, not raw payloads — matches requirement 8).

**No changes** to `users`, `quotes`, `bookings`, `messages`, `subscriptions`, `reviews` (v1).

---

## 3. Backend/API changes

### New central helper — the single most important piece
`lib/company-membership.ts`:
- `getActiveMembership(userId)` → `{ traderProfileId, role } | null` (owner fallback: profile owned by user counts as OWNER membership even pre-backfill — this makes the flag-off path identical to today).
- `requireMember(...)` / `requireOwner(...)` Express helpers.

Then a **mechanical refactor of the ~30 choke points**: every `trader_profiles.user_id = userId` identity lookup goes through the helper. Single-login traders resolve exactly as today (owner membership), so behavior is provably unchanged until invites exist. `canManageBusinessFields()` gains the real employee-deny branch it was designed for.

### New routes (all owner-only except accept)
- `GET /api/company/members` — members + pending invites (members may read; management owner-only).
- `POST /api/company/invites` — validate email, create invite, send email with deep link (`/open` redirect page pattern already exists). Generic responses to prevent account enumeration.
- `POST /api/company/invites/resend` / `DELETE /api/company/invites/:id`.
- `POST /api/invites/accept` — token → validate hash/expiry/status; **new-email signup flow only in v1** (§12-Q2): creates user (role `trader`), ACTIVE EMPLOYEE membership, audit event. Existing-email → clear "this email already has an account" error.
- `DELETE /api/company/members/:id` — owner removes employee: membership → REVOKED, open assigned jobs auto-reassigned to owner (§12-Q9), `users.role → customer`, `revokeUserSessions()` (device force-logout already handled by the app's dead-session logic), audit + notification.
- `POST /api/company/jobs/:conversationId/reassign` — owner only, ACTIVE member target, audit, notifies old/new assignee.

### Claiming (atomic)
Claim = **first trader-side human action** in a conversation (send message *or* submit quote):
```sql
UPDATE conversations SET assigned_trader_user_id=$member, assigned_at=now()
WHERE id=$conv AND assigned_trader_user_id IS NULL RETURNING id
```
No row returned → already claimed → quote path also naturally guarded by the existing one-PENDING-per-conversation index (second quote gets 409 regardless of timing). Two employees racing = impossible to double-claim; DB primitives already exist for both paths.

### Post-claim action rules
- Assigned member + owner: full actions (messages, quotes incl. revise/withdraw — quote ownership checks widen from `quote.traderUserId === caller` to "caller is assignee or owner", owner overrides audited).
- Other employees: read-only + "Job claimed by {name}" banner (§12-Q5).
- Owner-only regardless: business fields/logo (existing choke point), members, subscription/billing, verification & docs, phone OTP for the business number, profile-change requests, working hours/availability (§12-Q4), review replies (§12-Q6), gallery.

### Notifications
- **New lead:** push → all ACTIVE members (respecting per-user push opt-out); email → owner only (v1; lead-reminder settings stay owner-managed) (§12-Q7).
- **Post-claim transitions** (quote accepted, booking, completion, review): assigned member + owner, deduped when same person; other employees silent. All sends stay behind the existing conditional-UPDATE…RETURNING transition gates — the established dedupe convention.
- **Customer notifications: unchanged** — single recipient, no duplication risk.

### Serving/privacy predicates
`avatar-file` route ("owner or shares a conversation") widens to include company assignment, so the customer can load the **assigned employee's** photo: viewer must share the conversation where that user is the assignee (or owner). Logo route unchanged (public).

---

## 4. Mobile and Admin UI changes

### Mobile (customer-facing)
- Search cards / public profile: **unchanged** — company logo (just shipped).
- Conversation header, pre-claim: company logo + business name + "A team member will reply". Post-claim: assigned person's photo + name, **company name kept underneath** (requirement 5). If assignee is reassigned, header follows.
- Quote/booking/completion cards: unchanged visuals; identity comes from the header.

### Mobile (trader-side)
- Account Settings → new **Team** section (natural slot exists in `account.tsx`): owner sees member list + Invite by email + cancel/resend + remove; employee sees "Member of {business}" card.
- Invite acceptance: deep link → accept screen → sign-up variant (name, password, personal photo prompt).
- Leads/dashboard/conversations: same screens, now membership-driven server-side; employees see shared leads.
- Claimed-job banner ("Quote submitted by / Job claimed by {name}") + read-only composer for non-assigned members.
- Hidden for employees (and server-enforced): Edit Business Profile, logo, gallery, verification/documents, Billing & Plan (no paywall — subscription is the owner's), business phone, working hours.

### Admin
- Trader Detail (`/traders/:userId`): new **Members** tab — members, roles, status, pending invites, and per-company audit trail (human-readable lines; raw JSON stays internal).
- Conversation inspection (Reviews/moderation dialog): show assigned member name next to trader messages.

---

## 5. Permission matrix (v1)

| Capability | Owner | Employee |
|---|---|---|
| See shared leads / new-lead push | ✅ | ✅ |
| Message in unclaimed conversation (claims it) | ✅ | ✅ |
| Submit company quote (claims job) | ✅ | ✅ |
| Act on claimed job (messages, quotes, bookings, complete) | ✅ (any job) | ✅ only own assigned |
| Read claimed jobs of others | ✅ | ✅ (read-only, §12-Q5) |
| Reassign jobs | ✅ | ❌ |
| Invite / remove members, change roles | ✅ | ❌ |
| Business profile, services, areas, hours | ✅ | ❌ (§12-Q4) |
| Logo & gallery | ✅ | ❌ |
| Verification & documents | ✅ | ❌ |
| Subscription / billing | ✅ | ❌ (never sees paywall) |
| Reply to reviews | ✅ | ❌ (§12-Q6) |
| Own personal photo & name | ✅ | ✅ |

**Manager role: later** (§12-Q3). The enum accommodates it now for free; shipping a third permission tier multiplies the test matrix before the basic model is proven. Revisit once real teams exist.

---

## 6. Job-claiming & reassignment rules

1. New enquiry → conversation starts **unassigned**; all members see it.
2. First member to message or quote → atomically assigned (rules above); audit `JOB_CLAIMED`.
3. Quote submitted → `QUOTE_SUBMITTED_BY_MEMBER` audit; other members see the banner.
4. Owner may reassign at any point **before completion** (incl. after hire — tradesperson swaps happen in reality); audited, both members + no customer notification (identity in header just updates) — §12-Q8.
5. Assignment persists through quote → hire → appointment → in-progress → completion → review → dispute. Admin inspection shows the assignee.
6. Removed/deactivated assignee → their open (not completed) jobs auto-reassign to owner + owner notified (§12-Q9). Completed history keeps the original actor ids (nothing rewritten).
7. Reviews: still attached to the company; optional "work done by {first name}" attribution deferred (§12-Q10).

---

## 7. Migration / backfill approach

**All additive; zero rewrite of existing rows' meaning.**
1. Create `company_members`, `company_invites`, conversations columns, new audit action strings.
2. Backfill in one transaction: one ACTIVE OWNER membership per existing `trader_profiles` row; `conversations.assigned_trader_user_id = trader_user_id` (existing jobs stay "assigned" to the sole trader — matches reality).
3. Server feature flag `COMPANY_TEAMS_ENABLED`: off → invite routes 404, UI hidden, membership helper resolves owners exactly as today. The refactor ships dark first.
4. **Deploy order (lockstep rule, prod schema before code):** ① prod DB migration → ② backend republish (flag off) → ③ regression on prod → ④ flag on + admin republish → ⑤ mobile TestFlight build.
5. **Rollback:** flag off restores today's behavior exactly (owner is the only member everywhere); tables sit dormant; no destructive path. Only hard-to-undo step is real invited employees existing — rollback then means freezing invites, not data loss.

**Required at rollout:** production DB migration ✅, backend republish ✅, admin republish ✅ (Members tab), new mobile build ✅ (Team UI + headers). Old app versions keep working against the new backend (owner-only behavior).

---

## 8. Concurrency & security risks

| Risk | Mitigation |
|---|---|
| **Authz broadening = IDOR class** (member of company A reaching company B, ex-member reaching anything) | Single membership helper, fail-closed; table-driven permission tests per endpoint (owner / employee / foreign trader / ex-member / customer). This is the #1 risk of the whole feature. |
| Double-claim race | Conditional UPDATE + existing partial unique quote index — DB-level, not app-level. |
| Personal-photo privacy leak via widened serving predicate | Predicate extension tested explicitly (customer of unrelated conversation must get 404). |
| Removed member retains access | Membership fail-closed per request + `tokenVersion` bump (instant global logout — mechanism already proven). |
| Invite token abuse / enumeration | Hash-only storage, single-use, 7-day expiry, generic API responses (established OTP anti-enumeration pattern). |
| RevenueCat identity corruption | Employees never touch RC (no paywall, no `logIn`); subscription stays keyed to owner. Memory of past RC identity races makes this a hard rule. |
| Notification spam/dupes | Fan-out only behind existing transition gates; assigned+owner dedupe; customer path untouched. |
| Stale `users.role` on accept/remove | Both transitions bump tokenVersion → forced token refresh. |

---

## 9. Testing & regression plan

- **API (new):** membership helper units; invite lifecycle (create/accept/expire/cancel/resend/case-variant email); permission matrix table-driven suite (~30 endpoints × 5 actor types); claim race (`Promise.all` parallel quote+message); removal (revocation + auto-reassign + role flip); avatar-serving predicate; notification targeting/dedupe.
- **API (regression):** the entire existing suite (284 green today) must pass **unmodified** after the choke-point refactor — the strongest proof single-login traders are unaffected. Run again with flag on + solo-owner backfill.
- **Admin:** Members tab tests (list/invite states/remove) added to the existing 37.
- **Mobile:** typecheck + scripted two-phone walkthrough (owner + employee): invite → accept → shared lead → race-claim → banner → customer header pre/post claim → reassign → remove.
- **Prod safety:** read-only prod DB checks before/after backfill (row counts, no orphan memberships), following the no-destructive-tests rule.

---

## 10. Recommended implementation phases

| Phase | Scope | Ships to users? |
|---|---|---|
| **0 — Foundation** | Schema + backfill + membership helper refactor of all choke points, flag off, full regression | Invisible (backend only) |
| **1 — Team management** | Invites/accept/remove/sessions + mobile Team section + admin Members tab + audit events | Owners can build teams |
| **2 — Shared jobs** | Lead fan-out, claim mechanics, banners, customer-facing identity (pre/post-claim headers), serving predicate | The core product value |
| **3 — Hardening** | Reassignment UI, removal auto-reassign, admin conversation attribution, review attribution (if approved), polish | Completeness |

Each phase independently shippable and testable; 0+1 must land together before any invite exists in prod.

## 11. Estimated complexity & highest-risk areas

**Overall: the largest structural change since launch — roughly comparable to the original quotes+bookings build, mostly backend.** Phase 0 is the widest diff (mechanical but touches ~30 authz points — highest regression risk); Phase 2 is the most product-sensitive (claiming UX, notifications, customer identity). Top three risks: (1) authz refactor regressions/IDOR, (2) personal-photo serving predicate, (3) notification correctness. All three are covered by the test plan; none require touching billing, verification, or the legal system.

## 12. Product decisions needed before implementation

1. **One company per user** (v1 blocks joining a second company) — confirm.
2. **Invites restricted to brand-new emails in v1** (existing customer accounts can't convert to employee yet — avoids messy dual identities). OK, or must customer conversion work at launch?
3. **Manager role later** (schema-ready now, UI/permissions later) — confirm.
4. Business profile, services, availability/hours: **owner-only** in v1?
5. Non-assigned employees on a claimed job: **read-only** (recommended) or fully blocked?
6. Review replies: owner-only in v1?
7. New-lead notifications: push to **all** active members (recommended) or owner + per-member opt-in?
8. Owner reassignment allowed **after hire** too (recommended) — confirm.
9. Removing a member auto-reassigns their open jobs **to the owner** (recommended) — confirm.
10. Should reviews/completed jobs show "work done by {first name}" to customers? (Deferred by default.)
11. Seats & billing: **no per-seat billing changes in v1**, soft cap of 10 members per company as an abuse guard — confirm cap (or none).
