import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { companyMembersTable, traderProfilesTable } from "@workspace/db/schema";
import type { CompanyMemberRole } from "@workspace/db/schema";
import { logger } from "./logger";

/**
 * Company Teams — the single resolver for "which trader business does this
 * user act for, and with what role?".
 *
 * Every trader-side route that used to look the caller's profile up with
 * `trader_profiles.user_id = userId` now goes through getActiveMembership()
 * instead. That makes membership the one place where multi-member access is
 * decided:
 *
 *  - Feature flag OFF (default): the resolver runs EXACTLY the legacy query
 *    (profile owned by the caller) and reports them as OWNER. Behaviour is
 *    bit-for-bit identical to the pre-teams code path.
 *  - Feature flag ON: an ACTIVE company_members row wins (EMPLOYEEs resolve
 *    to their company's profile); a profile owner without a membership row
 *    still resolves as OWNER (backfill safety), so a missed backfill can
 *    never lock a business out. Employees FAIL CLOSED — no membership row,
 *    no access.
 *
 * Invariant relied on by owner-gated routes that keep using `userId` keyed
 * queries internally: when role === "OWNER", membership.profile.userId ===
 * the caller's userId (owners are exactly the profile owners; the partial
 * unique index company_members_one_active_owner_idx plus the backfill keep
 * the two representations in lockstep).
 */

export type CompanyMembership = {
  traderProfileId: number;
  role: CompanyMemberRole;
  /** Full trader_profiles row of the company the caller acts for. */
  profile: typeof traderProfilesTable.$inferSelect;
};

/**
 * Feature flag: multi-member behaviour is disabled unless explicitly on.
 *
 * DO NOT enable in production before job claiming/assignment enforcement
 * (Phase 2) has shipped: with the flag on, every ACTIVE member counts as the
 * trader participant of the company's conversations, so without claiming
 * rules employees could act on any company job. Until then the flag exists
 * for tests and staged development only.
 */
export function companyTeamsEnabled(): boolean {
  return process.env["COMPANY_TEAMS_ENABLED"] === "true";
}

/**
 * Maximum ACTIVE members per company (abuse guard, not a billing seat).
 * Configurable via env so the cap is never scattered through the codebase.
 */
export function maxActiveMembersPerCompany(): number {
  const raw = Number(process.env["COMPANY_MAX_ACTIVE_MEMBERS"] ?? "10");
  return Number.isInteger(raw) && raw > 0 ? raw : 10;
}

/**
 * Standard 403 body for owner-only surfaces (business profile, documents,
 * billing, team management, …). Stable `code` so clients can branch on it.
 */
export const OWNER_ONLY_RESPONSE = {
  error: "Only the business owner can do this.",
  code: "OWNER_ONLY",
} as const;

/**
 * Resolve the company the user currently acts for, or null when they act for
 * none (no owned profile and, with the flag on, no ACTIVE membership).
 */
export async function getActiveMembership(
  userId: number,
): Promise<CompanyMembership | null> {
  if (companyTeamsEnabled()) {
    const [row] = await db
      .select({ member: companyMembersTable, profile: traderProfilesTable })
      .from(companyMembersTable)
      .innerJoin(
        traderProfilesTable,
        eq(companyMembersTable.traderProfileId, traderProfilesTable.id),
      )
      .where(
        and(
          eq(companyMembersTable.userId, userId),
          eq(companyMembersTable.status, "ACTIVE"),
        ),
      )
      .limit(1);
    if (row) {
      // ENFORCED invariant (not merely assumed): an OWNER membership is only
      // honoured when the caller actually owns the trader_profiles row. A
      // forged or corrupt OWNER row for someone else's business must never
      // grant owner powers — fail closed and log loudly.
      if (row.member.role === "OWNER" && row.profile.userId !== userId) {
        logger.error(
          {
            event: "company_membership_integrity_violation",
            userId,
            traderProfileId: row.profile.id,
            membershipId: row.member.id,
          },
          "ACTIVE OWNER membership does not match trader_profiles.user_id — failing closed",
        );
        return null;
      }
      return {
        traderProfileId: row.profile.id,
        role: row.member.role as CompanyMemberRole,
        profile: row.profile,
      };
    }
    // Fall through: a profile owner with no membership row (backfill not run
    // yet) must still resolve as OWNER. Non-owners correctly get null.
  }

  // Legacy resolution — identical to the pre-teams per-route lookup.
  const [profile] = await db
    .select()
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.userId, userId))
    .limit(1);
  if (!profile) return null;
  return { traderProfileId: profile.id, role: "OWNER", profile };
}
