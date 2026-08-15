import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  companyInvitesTable,
  companyMembersTable,
  subscriptionsTable,
  traderProfilesTable,
} from "@workspace/db/schema";
import { maxActiveMembersPerCompany } from "./company-membership";
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

/** Business tier ids derived from the store product. */
export type BusinessPlanTier =
  | "premium_solo"
  | "team_5"
  | "team_10"
  | "team_20";

/** No self-service company may ever exceed this many employees. */
export const ABSOLUTE_MAX_EMPLOYEE_SEATS = 20;

/**
 * product_identifier → tier/seats. Single shared constant — never duplicate
 * per surface. Includes the RevenueCat Test Store equivalents (debug builds)
 * alongside the App Store product ids. Unknown products FAIL CLOSED to the
 * solo tier (0 seats) with a loud log — a typo in a future product id must
 * never silently grant seats.
 */
const PRODUCT_TIER_MAP: Readonly<
  Record<string, { tier: BusinessPlanTier; seats: number }>
> = {
  // App Store
  "com.mylocaltrade.app.trader.monthly": { tier: "premium_solo", seats: 0 },
  "com.mylocaltrade.app.trader.yearly": { tier: "premium_solo", seats: 0 },
  "com.mylocaltrade.app.team5.yearly": { tier: "team_5", seats: 5 },
  "com.mylocaltrade.app.team10.yearly": { tier: "team_10", seats: 10 },
  "com.mylocaltrade.app.team20.yearly": { tier: "team_20", seats: 20 },
  // RevenueCat Test Store (debug-only builds)
  monthly: { tier: "premium_solo", seats: 0 },
  yearly: { tier: "premium_solo", seats: 0 },
  team5: { tier: "team_5", seats: 5 },
  team10: { tier: "team_10", seats: 10 },
  team20: { tier: "team_20", seats: 20 },
};

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
  if (!productIdentifier) return { tier: "premium_solo", seats: 0 };
  const mapped = PRODUCT_TIER_MAP[productIdentifier];
  if (!mapped) {
    logger.error(
      { productIdentifier },
      "Unknown store product in subscriptions.product_identifier — failing closed to solo tier (0 seats). Update PRODUCT_TIER_MAP.",
    );
    return { tier: "premium_solo", seats: 0 };
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

/** ACTIVE members (excl. nobody — the OWNER row is excluded by role) + unexpired PENDING invites. */
export async function countCompanySeats(
  traderProfileId: number,
  executor: DbExecutor = db,
): Promise<{ activeEmployees: number; pendingInvites: number }> {
  const [members] = await executor
    .select({ n: sql<number>`count(*)::int` })
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
    activeEmployees: members?.n ?? 0,
    pendingInvites: invites?.n ?? 0,
  };
}

export interface CompanyPlanContext {
  /** Tier derived from the OWNER's subscription product. */
  effectiveBusinessPlan: BusinessPlanTier;
  /** Whether the owner's subscription row is currently active. */
  active: boolean;
  /** Employee seats included in the plan (post-clamp). */
  employeeSeatLimit: number;
  activeEmployeeCount: number;
  pendingInviteCount: number;
  /** More ACTIVE employees than the plan allows (downgrade/expiry state). */
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
  const employeeSeatLimit = Math.min(seats, operationalCeiling());
  const counts = await countCompanySeats(traderProfileId, executor);

  return {
    effectiveBusinessPlan: tier,
    active,
    employeeSeatLimit,
    activeEmployeeCount: counts.activeEmployees,
    pendingInviteCount: counts.pendingInvites,
    overLimit: counts.activeEmployees > employeeSeatLimit,
  };
}

/**
 * The seat limit invite create/resend must enforce, INSIDE the same
 * advisory-lock transaction as the seat count + write.
 *
 * Flag OFF → legacy env cap, plan ignored (today's behaviour, bit-identical).
 * Flag ON  → the plan's employee seat limit; an inactive plan grants 0 seats.
 * Returns `requiresTeamPlan: true` when the blocker is the tier itself
 * (solo plan / no active plan), so the route can answer TEAM_PLAN_REQUIRED
 * instead of MEMBER_LIMIT_REACHED.
 */
export async function resolveInviteSeatLimit(
  traderProfileId: number,
  executor: DbExecutor = db,
): Promise<{ max: number; requiresTeamPlan: boolean }> {
  if (!teamBillingEnforced()) {
    return { max: maxActiveMembersPerCompany(), requiresTeamPlan: false };
  }
  const ctx = await getCompanyPlanContext(traderProfileId, executor);
  const max = ctx.active ? ctx.employeeSeatLimit : 0;
  return { max, requiresTeamPlan: max === 0 };
}
