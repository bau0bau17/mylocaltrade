import { and, asc, eq, gt, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  companyInvitesTable,
  companyMembersTable,
  companySeatExemptionsTable,
  subscriptionsTable,
  traderAuditLogTable,
  traderProfilesTable,
} from "@workspace/db/schema";
import { companyTeamsEnabled, maxActiveMembersPerCompany } from "./company-membership";
import { logger } from "./logger";

/**
 * Team billing (Phase B) — DORMANT plumbing behind TEAM_BILLING_ENFORCED.
 *
 * With the flag OFF (the default, and the only state until Team products
 * exist in App Store Connect / RevenueCat), every behaviour in this module is
 * advisory: seat limits fall back to the legacy COMPANY_MAX_ACTIVE_MEMBERS
 * cap and no invite is ever refused for plan reasons. Turning the flag ON
 * makes the owner's store product (subscriptions.product_identifier) the
 * source of truth for how many employee seats the company may use.
 */

export function teamBillingEnforced(): boolean {
  return process.env["TEAM_BILLING_ENFORCED"] === "true";
}

/**
 * Advisory-lock namespace serialising EVERY seat-changing operation for one
 * company: invite create/resend/accept, owner suspend/reactivate, member
 * removal side effects and subscription-driven reconciliation. All of them
 * take pg_advisory_xact_lock(namespace, traderProfileId) INSIDE their
 * transaction, so two operations racing for the final seat are decided by
 * the database, never by interleaved reads. (Shared with company-team.ts —
 * historically its CAP_LOCK_NAMESPACE.)
 */
export const COMPANY_SEAT_LOCK_NAMESPACE = 812004101;

/** Business tier ids derived from the store product. */
export type BusinessPlanTier =
  | "premium_solo"
  | "team_5"
  | "team_10"
  | "team_20";

/** No self-service company may ever exceed this many employees. */
export const ABSOLUTE_MAX_EMPLOYEE_SEATS = 20;

const SOLO_TIER: { tier: BusinessPlanTier; seats: number } = {
  tier: "premium_solo",
  seats: 0,
};

/**
 * CONFIRMED production products (exist in App Store Connect today).
 * Both are Solo — no Team product exists in production yet.
 */
const PRODUCTION_PRODUCT_TIER_MAP: Readonly<
  Record<string, { tier: BusinessPlanTier; seats: number }>
> = {
  "com.mylocaltrade.app.trader.monthly": SOLO_TIER,
  "com.mylocaltrade.app.trader.yearly": SOLO_TIER,
};

/**
 * RevenueCat Test Store identifiers — debug builds only. This map is
 * ISOLATED from production: it is never consulted when NODE_ENV is
 * "production", so a Test Store id can never grant production seats.
 */
const TEST_STORE_TIER_MAP: Readonly<
  Record<string, { tier: BusinessPlanTier; seats: number }>
> = {
  monthly: SOLO_TIER,
  yearly: SOLO_TIER,
  team5: { tier: "team_5", seats: 5 },
  team10: { tier: "team_10", seats: 10 },
  team20: { tier: "team_20", seats: 20 },
};

const SEATS_TO_TIER: Readonly<Record<number, BusinessPlanTier>> = {
  5: "team_5",
  10: "team_10",
  20: "team_20",
};

/**
 * Future Team products (Phase C placeholder — INACTIVE by default).
 *
 * No Team product identifiers are hardcoded: the exact ids will only exist
 * once they are created and confirmed in App Store Connect. Until then this
 * resolves from TEAM_PRODUCT_SEAT_MAP, a JSON env var mapping a confirmed
 * product id to its seat count (allowed values: 5, 10, 20), e.g.
 *   TEAM_PRODUCT_SEAT_MAP={"com.mylocaltrade.app.<confirmed-id>":5}
 * Unset/empty (the default) means NO Team product is recognised, so every
 * non-Solo product fails closed to solo. Malformed JSON or a disallowed
 * seat value is logged and ignored (fail closed, never fail open).
 */
function configuredTeamProducts(): Record<
  string,
  { tier: BusinessPlanTier; seats: number }
> {
  const raw = process.env["TEAM_PRODUCT_SEAT_MAP"];
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.error("TEAM_PRODUCT_SEAT_MAP is not valid JSON — ignoring it (fail closed).");
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    logger.error("TEAM_PRODUCT_SEAT_MAP must be a JSON object — ignoring it (fail closed).");
    return {};
  }
  const out: Record<string, { tier: BusinessPlanTier; seats: number }> = {};
  for (const [productId, seats] of Object.entries(parsed)) {
    if (productId in TEST_STORE_TIER_MAP) {
      // Test Store ids may ONLY resolve through the isolated non-production
      // map — configuring one here must never grant seats (in any env, so a
      // bad config is caught in dev before it reaches production).
      logger.error(
        { productId },
        "TEAM_PRODUCT_SEAT_MAP must not contain RevenueCat Test Store ids — skipping it (fail closed).",
      );
      continue;
    }
    const tier = typeof seats === "number" ? SEATS_TO_TIER[seats] : undefined;
    if (!tier || typeof seats !== "number") {
      logger.error(
        { productId, seats },
        "TEAM_PRODUCT_SEAT_MAP entry has a disallowed seat value (must be 5, 10 or 20) — skipping it (fail closed).",
      );
      continue;
    }
    out[productId] = { tier, seats };
  }
  return out;
}

/**
 * Resolve a store product to its tier. `null`/unknown products map to the
 * solo tier: legacy rows predate product persistence and every currently
 * sellable product IS solo, so this is correct today and fail-closed
 * tomorrow (no seats granted by an unrecognised product).
 */
export function resolveProductTier(productIdentifier: string | null): {
  tier: BusinessPlanTier;
  seats: number;
} {
  if (!productIdentifier) return { ...SOLO_TIER };
  const mapped =
    PRODUCTION_PRODUCT_TIER_MAP[productIdentifier] ??
    configuredTeamProducts()[productIdentifier] ??
    (process.env["NODE_ENV"] !== "production"
      ? TEST_STORE_TIER_MAP[productIdentifier]
      : undefined);
  if (!mapped) {
    logger.error(
      { productIdentifier },
      "Unknown store product in subscriptions.product_identifier — failing closed to solo tier (0 seats). Confirm the product id and add it to the product tier configuration.",
    );
    return { ...SOLO_TIER };
  }
  return {
    ...mapped,
    seats: Math.min(mapped.seats, ABSOLUTE_MAX_EMPLOYEE_SEATS),
  };
}

/**
 * Hard operational ceiling. When COMPANY_MAX_ACTIVE_MEMBERS is explicitly
 * set it acts as a kill-switch that clamps every plan; when unset, plans are
 * clamped only by the absolute max (the legacy default of 10 must NOT
 * silently cap a future Team 20 purchase).
 */
function operationalCeiling(): number {
  if (process.env["COMPANY_MAX_ACTIVE_MEMBERS"] === undefined) {
    return ABSOLUTE_MAX_EMPLOYEE_SEATS;
  }
  return maxActiveMembersPerCompany();
}

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Seat consumption for one company:
 *  - activeEmployees: ACTIVE EMPLOYEE members whose seat is NOT suspended —
 *    the only members who occupy a paid seat. (The OWNER is excluded by
 *    role: the owner never consumes a seat.)
 *  - suspendedEmployees: ACTIVE EMPLOYEE members whose seat IS suspended —
 *    still part of the company (read-only) but free of the allowance.
 *  - pendingInvites: unexpired PENDING invites — each reserves a seat.
 */
export async function countCompanySeats(
  traderProfileId: number,
  executor: DbExecutor = db,
): Promise<{ activeEmployees: number; suspendedEmployees: number; pendingInvites: number }> {
  const [members] = await executor
    .select({
      active: sql<number>`count(*) filter (where seat_suspended_at is null)::int`,
      suspended: sql<number>`count(*) filter (where seat_suspended_at is not null)::int`,
    })
    .from(companyMembersTable)
    .where(
      and(
        eq(companyMembersTable.traderProfileId, traderProfileId),
        eq(companyMembersTable.status, "ACTIVE"),
        eq(companyMembersTable.role, "EMPLOYEE"),
      ),
    );
  const [invites] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(companyInvitesTable)
    .where(
      and(
        eq(companyInvitesTable.traderProfileId, traderProfileId),
        eq(companyInvitesTable.status, "PENDING"),
        gt(companyInvitesTable.expiresAt, new Date()),
      ),
    );
  return {
    activeEmployees: members?.active ?? 0,
    suspendedEmployees: members?.suspended ?? 0,
    pendingInvites: invites?.n ?? 0,
  };
}

/**
 * The company's live grandfathering exemption, if any: unrevoked and not yet
 * expired. Seat limit is clamped to the absolute maximum on read — an
 * exemption can never authorise more than 20 employees no matter what was
 * stored.
 */
export async function getLiveSeatExemption(
  traderProfileId: number,
  executor: DbExecutor = db,
): Promise<{ id: number; seatLimit: number; expiresAt: Date | null } | null> {
  const [row] = await executor
    .select({
      id: companySeatExemptionsTable.id,
      seatLimit: companySeatExemptionsTable.seatLimit,
      expiresAt: companySeatExemptionsTable.expiresAt,
    })
    .from(companySeatExemptionsTable)
    .where(
      and(
        eq(companySeatExemptionsTable.traderProfileId, traderProfileId),
        isNull(companySeatExemptionsTable.revokedAt),
        sql`(${companySeatExemptionsTable.expiresAt} IS NULL OR ${companySeatExemptionsTable.expiresAt} > now())`,
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    seatLimit: Math.min(row.seatLimit, ABSOLUTE_MAX_EMPLOYEE_SEATS),
    expiresAt: row.expiresAt ?? null,
  };
}

export interface CompanyPlanContext {
  /** Tier derived from the OWNER's subscription product. */
  effectiveBusinessPlan: BusinessPlanTier;
  /** Whether the owner's subscription row is currently active. */
  active: boolean;
  /** Employee seats included in the plan (post-clamp). */
  employeeSeatLimit: number;
  /**
   * The allowance seat operations actually enforce:
   * max(plan seats while the plan is active, live exemption seats), clamped
   * by the operational ceiling. A grandfathering exemption grants seats even
   * with no active subscription — that is its entire purpose.
   */
  effectiveSeatAllowance: number;
  /** Live grandfathering exemption, when one exists. */
  exemption: { seatLimit: number; expiresAt: Date | null } | null;
  /** Seated (non-suspended) ACTIVE employees. */
  activeEmployeeCount: number;
  /** ACTIVE employees whose seat is suspended (read-only members). */
  suspendedEmployeeCount: number;
  pendingInviteCount: number;
  /** Seats still free after seated employees + reserved invites. */
  availableSeats: number;
  /** More seated employees than the allowance (downgrade/expiry state). */
  overLimit: boolean;
}

/**
 * Single choke point resolving a company's billing-derived team state, keyed
 * by the trader profile. Mirrors getActiveMembership's role: every surface
 * that needs "how many seats / which tier / is the plan live" calls this —
 * never its own product mapping.
 *
 * Accepts an executor so invite-cap checks can run INSIDE the advisory-lock
 * transaction that serialises seat changes.
 */
export async function getCompanyPlanContext(
  traderProfileId: number,
  executor: DbExecutor = db,
): Promise<CompanyPlanContext> {
  const [profile] = await executor
    .select({ ownerUserId: traderProfilesTable.userId })
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.id, traderProfileId))
    .limit(1);

  let productIdentifier: string | null = null;
  let active = false;
  if (profile) {
    const [sub] = await executor
      .select({
        status: subscriptionsTable.status,
        productIdentifier: subscriptionsTable.productIdentifier,
      })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, profile.ownerUserId))
      .limit(1);
    if (sub) {
      productIdentifier = sub.productIdentifier ?? null;
      active = sub.status === "active";
    }
  }

  const { tier, seats } = resolveProductTier(productIdentifier);
  const ceiling = operationalCeiling();
  const employeeSeatLimit = Math.min(seats, ceiling);
  const exemption = await getLiveSeatExemption(traderProfileId, executor);
  const effectiveSeatAllowance = Math.min(
    Math.max(active ? employeeSeatLimit : 0, exemption?.seatLimit ?? 0),
    ceiling,
  );
  const counts = await countCompanySeats(traderProfileId, executor);

  return {
    effectiveBusinessPlan: tier,
    active,
    employeeSeatLimit,
    effectiveSeatAllowance,
    exemption: exemption ? { seatLimit: exemption.seatLimit, expiresAt: exemption.expiresAt } : null,
    activeEmployeeCount: counts.activeEmployees,
    suspendedEmployeeCount: counts.suspendedEmployees,
    pendingInviteCount: counts.pendingInvites,
    availableSeats: Math.max(
      0,
      effectiveSeatAllowance - counts.activeEmployees - counts.pendingInvites,
    ),
    overLimit: counts.activeEmployees > effectiveSeatAllowance,
  };
}

/**
 * The seat limit invite create/resend must enforce, INSIDE the same
 * advisory-lock transaction as the seat count + write.
 *
 * Flag OFF → legacy env cap, plan ignored (today's behaviour, bit-identical).
 * Flag ON  → the effective seat allowance: plan seats while the plan is
 * active, or a live grandfathering exemption (whichever is higher, still
 * capped at the ceiling). An inactive plan with no exemption grants 0 seats.
 * Returns `requiresTeamPlan: true` when the blocker is the tier itself
 * (solo plan / no active plan / no exemption), so the route can answer
 * TEAM_PLAN_REQUIRED instead of MEMBER_LIMIT_REACHED.
 */
export async function resolveInviteSeatLimit(
  traderProfileId: number,
  executor: DbExecutor = db,
): Promise<{ max: number; requiresTeamPlan: boolean }> {
  if (!teamBillingEnforced()) {
    return { max: maxActiveMembersPerCompany(), requiresTeamPlan: false };
  }
  const ctx = await getCompanyPlanContext(traderProfileId, executor);
  const max = ctx.effectiveSeatAllowance;
  return { max, requiresTeamPlan: max === 0 };
}

export interface SeatReconciliationResult {
  changed: boolean;
  allowance: number;
  suspendedMemberUserIds: number[];
  reactivatedMemberUserIds: number[];
}

/**
 * Bring a company's seated employees in line with its effective seat
 * allowance. Called AFTER any event that can change the allowance commits:
 * subscription grant / product change / expiry / revocation (RevenueCat sync
 * and webhook) and exemption grant / revoke.
 *
 * DETERMINISTIC SUSPENSION RULE (documented + tested — do not change without
 * updating docs/team-billing-rollout.md):
 *   Seats belong to the LONGEST-STANDING employees. When the allowance
 *   shrinks below the number of seated employees, the NEWEST seated
 *   employees (by membership createdAt, id as tiebreak) are suspended first.
 *   When room returns, SYSTEM-suspended employees are reactivated
 *   longest-standing first. OWNER-suspended employees are NEVER auto-
 *   reactivated — only the owner reverses an explicit owner decision.
 *
 * Suspension is read-only and fully reversible: the membership row stays
 * ACTIVE, nothing is deleted, history and attribution survive. The OWNER
 * never occupies a seat and is never suspended by this function (EMPLOYEE
 * rows only, by role filter).
 *
 * Runs only with COMPANY_TEAMS_ENABLED and TEAM_BILLING_ENFORCED both on —
 * with either flag off it is a no-op, so legacy behaviour is byte-identical.
 * Serialised per company via the shared advisory lock, so it cannot race
 * invite acceptance or owner seat actions.
 */
export async function reconcileCompanySeats(
  traderProfileId: number,
  trigger: string,
): Promise<SeatReconciliationResult | null> {
  if (!companyTeamsEnabled() || !teamBillingEnforced()) return null;

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${COMPANY_SEAT_LOCK_NAMESPACE}, ${traderProfileId})`,
    );

    const [profile] = await tx
      .select({ ownerUserId: traderProfilesTable.userId })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.id, traderProfileId))
      .limit(1);
    if (!profile) {
      return { changed: false, allowance: 0, suspendedMemberUserIds: [], reactivatedMemberUserIds: [] };
    }

    const ctx = await getCompanyPlanContext(traderProfileId, tx);
    const allowance = ctx.effectiveSeatAllowance;

    // Longest-standing first — the canonical seat-priority order.
    const employees = await tx
      .select({
        id: companyMembersTable.id,
        userId: companyMembersTable.userId,
        seatSuspendedAt: companyMembersTable.seatSuspendedAt,
        seatSuspensionSource: companyMembersTable.seatSuspensionSource,
      })
      .from(companyMembersTable)
      .where(
        and(
          eq(companyMembersTable.traderProfileId, traderProfileId),
          eq(companyMembersTable.status, "ACTIVE"),
          eq(companyMembersTable.role, "EMPLOYEE"),
        ),
      )
      .orderBy(asc(companyMembersTable.createdAt), asc(companyMembersTable.id));

    const seated = employees.filter((e) => e.seatSuspendedAt === null);
    const suspendedMemberUserIds: number[] = [];
    const reactivatedMemberUserIds: number[] = [];
    const now = new Date();

    if (seated.length > allowance) {
      // Suspend the NEWEST seated employees beyond the allowance.
      for (const member of seated.slice(allowance)) {
        const [row] = await tx
          .update(companyMembersTable)
          .set({ seatSuspendedAt: now, seatSuspensionSource: "SYSTEM", updatedAt: now })
          .where(
            and(
              eq(companyMembersTable.id, member.id),
              eq(companyMembersTable.status, "ACTIVE"),
              isNull(companyMembersTable.seatSuspendedAt),
            ),
          )
          .returning({ userId: companyMembersTable.userId });
        if (row) suspendedMemberUserIds.push(row.userId);
      }
    } else if (seated.length < allowance) {
      // Room returned — reactivate SYSTEM-suspended employees, longest-
      // standing first. OWNER-suspended seats stay down.
      const room = allowance - seated.length;
      const systemSuspended = employees.filter(
        (e) => e.seatSuspendedAt !== null && e.seatSuspensionSource === "SYSTEM",
      );
      for (const member of systemSuspended.slice(0, room)) {
        const [row] = await tx
          .update(companyMembersTable)
          .set({ seatSuspendedAt: null, seatSuspensionSource: null, updatedAt: now })
          .where(
            and(
              eq(companyMembersTable.id, member.id),
              eq(companyMembersTable.status, "ACTIVE"),
              isNotNull(companyMembersTable.seatSuspendedAt),
              eq(companyMembersTable.seatSuspensionSource, "SYSTEM"),
            ),
          )
          .returning({ userId: companyMembersTable.userId });
        if (row) reactivatedMemberUserIds.push(row.userId);
      }
    }

    const changed = suspendedMemberUserIds.length > 0 || reactivatedMemberUserIds.length > 0;
    if (changed) {
      const auditRows: (typeof traderAuditLogTable.$inferInsert)[] = [
        ...suspendedMemberUserIds.map((memberUserId) => ({
          userId: profile.ownerUserId,
          action: "MEMBER_SEAT_SUSPENDED" as const,
          performedBy: null,
          details: { memberUserId, source: "SYSTEM", trigger },
        })),
        ...reactivatedMemberUserIds.map((memberUserId) => ({
          userId: profile.ownerUserId,
          action: "MEMBER_SEAT_REACTIVATED" as const,
          performedBy: null,
          details: { memberUserId, source: "SYSTEM", trigger },
        })),
        {
          userId: profile.ownerUserId,
          action: "COMPANY_SEATS_RECONCILED" as const,
          performedBy: null,
          details: {
            trigger,
            allowance,
            suspendedMemberUserIds,
            reactivatedMemberUserIds,
          },
        },
      ];
      await tx.insert(traderAuditLogTable).values(auditRows);
      logger.info(
        {
          event: "company_seats_reconciled",
          traderProfileId,
          trigger,
          allowance,
          suspendedMemberUserIds,
          reactivatedMemberUserIds,
        },
        "company seats reconciled",
      );
    }

    return { changed, allowance, suspendedMemberUserIds, reactivatedMemberUserIds };
  });
}

export interface SeatSweepResult {
  companies: number;
  changed: number;
  errors: number;
}

/**
 * Durable safety net for seat reconciliation (scheduler-driven, hourly).
 *
 * Two gaps the event-driven reconciliation alone cannot cover:
 *  1. Time-bounded exemptions: `expiresAt` lapsing changes the effective
 *     allowance without any subscription event or admin action firing, so
 *     nothing would ever suspend the now-over-allowance employees.
 *  2. Post-commit reconcile failures: subscription/exemption routes reconcile
 *     best-effort AFTER their own transaction commits; a transient DB error
 *     there is logged and swallowed by design (the billing ack must not
 *     fail). This sweep is the retry.
 *
 * Scans every company that has at least one ACTIVE EMPLOYEE membership
 * (seated or seat-suspended) and reconciles each under the usual per-company
 * advisory lock. With either feature flag off, reconcileCompanySeats is a
 * no-op, so the sweep is safe to run unconditionally.
 */
export async function sweepCompanySeatReconciliation(): Promise<SeatSweepResult> {
  if (!companyTeamsEnabled() || !teamBillingEnforced()) {
    return { companies: 0, changed: 0, errors: 0 };
  }

  const companies = await db
    .selectDistinct({ traderProfileId: companyMembersTable.traderProfileId })
    .from(companyMembersTable)
    .where(
      and(eq(companyMembersTable.role, "EMPLOYEE"), eq(companyMembersTable.status, "ACTIVE")),
    );

  let changed = 0;
  let errors = 0;
  for (const { traderProfileId } of companies) {
    try {
      const result = await reconcileCompanySeats(traderProfileId, "scheduler:seat-sweep");
      if (result?.changed) changed += 1;
    } catch (err) {
      errors += 1;
      logger.error({ err, traderProfileId }, "seat-reconciliation sweep failed for company");
    }
  }
  return { companies: companies.length, changed, errors };
}
