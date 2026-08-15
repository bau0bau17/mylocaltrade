import { and, eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db } from "@workspace/db";
import { companyMembersTable, traderProfilesTable } from "@workspace/db/schema";
import type { CompanyMemberRole } from "@workspace/db/schema";
import type { AuthenticatedRequest } from "./types";
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
 * Express gate for owner-only surfaces that are keyed by users.id and do NOT
 * resolve an owned trader_profiles row of their own (billing/subscriptions,
 * …). Same pattern as documentsOwnerGate in the documents router:
 *
 *  - caller owns a trader_profiles row → pass (the legacy owner path);
 *  - caller owns NO profile but has ANY company_members row (any status) →
 *    they are an invite-created employee → 403 OWNER_ONLY. REVOKED members
 *    stay locked out too — removal must permanently end company-surface
 *    access even with a live session token;
 *  - neither (customer, or a brand-new pre-onboarding trader with no company
 *    ties) → legacy pass.
 *
 * Deliberately NOT feature-flag gated: employee rows only exist once teams
 * ran, and those users must stay blocked even if the flag is later turned
 * off.
 */
export function companyOwnerGate(surface: string) {
  return async function ownerGate(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { userId } = req as AuthenticatedRequest;
      const [profile] = await db
        .select({ id: traderProfilesTable.id })
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.userId, userId))
        .limit(1);
      if (profile) {
        next();
        return;
      }
      const [membership] = await db
        .select({ id: companyMembersTable.id })
        .from(companyMembersTable)
        .where(eq(companyMembersTable.userId, userId))
        .limit(1);
      if (membership) {
        res.status(403).json(OWNER_ONLY_RESPONSE);
        return;
      }
      next();
    } catch (error) {
      req.log.error({ err: error }, `${surface} owner gate failed`);
      res.status(500).json({ error: "Request failed" });
    }
  };
}

/**
 * True when the two users belong to the same company: each side counts as
 * "in" a company when they own its trader_profiles row (owners may predate
 * their backfilled membership row) or hold an ACTIVE company_members row.
 * REVOKED members do not count. Used for membership-scoped serving (e.g.
 * colleagues loading each other's headshots on the Team screen), so it is
 * deliberately flag-independent like the other membership-scoped paths.
 */
export async function usersShareActiveCompany(
  userA: number,
  userB: number,
): Promise<boolean> {
  const companyIdsOf = async (uid: number): Promise<Set<number>> => {
    const [owned, member] = await Promise.all([
      db
        .select({ id: traderProfilesTable.id })
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.userId, uid)),
      db
        .select({ id: companyMembersTable.traderProfileId })
        .from(companyMembersTable)
        .where(
          and(
            eq(companyMembersTable.userId, uid),
            eq(companyMembersTable.status, "ACTIVE"),
          ),
        ),
    ]);
    return new Set([...owned, ...member].map((r) => r.id));
  };
  const [a, b] = await Promise.all([companyIdsOf(userA), companyIdsOf(userB)]);
  for (const id of a) if (b.has(id)) return true;
  return false;
}

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

/**
 * User ids of everyone on the trader side of a company: all ACTIVE members
 * plus (defensively) the profile owner, who counts as a member even if the
 * boot backfill hasn't created their row yet. Flag OFF → exactly the owner,
 * which is bit-for-bit the legacy notification target.
 */
export async function activeCompanyMemberUserIds(
  traderProfileId: number,
): Promise<number[]> {
  const [profile] = await db
    .select({ userId: traderProfilesTable.userId })
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.id, traderProfileId))
    .limit(1);
  if (!profile) return [];
  if (!companyTeamsEnabled()) return [profile.userId];
  const rows = await db
    .select({ userId: companyMembersTable.userId })
    .from(companyMembersTable)
    .where(
      and(
        eq(companyMembersTable.traderProfileId, traderProfileId),
        eq(companyMembersTable.status, "ACTIVE"),
      ),
    );
  const ids = new Set<number>(rows.map((r) => r.userId));
  ids.add(profile.userId);
  return [...ids];
}

/**
 * Notification routing for the trader side of a conversation.
 *
 *  - Flag OFF: exactly [traderUserId] — the legacy single recipient.
 *  - Flag ON, job claimed: the assigned member + the owner (deduped when the
 *    owner claimed it themselves). Non-assigned employees deliberately stop
 *    receiving routine notifications for the job.
 *  - Flag ON, unclaimed lead: every ACTIVE member — the whole team should
 *    hear about jobs nobody has picked up yet.
 */
export async function traderSideRecipientUserIds(conv: {
  traderProfileId: number;
  traderUserId: number;
  assignedTraderUserId: number | null;
}): Promise<number[]> {
  if (!companyTeamsEnabled()) return [conv.traderUserId];
  if (conv.assignedTraderUserId != null) {
    const [profile] = await db
      .select({ userId: traderProfilesTable.userId })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.id, conv.traderProfileId))
      .limit(1);
    const ownerUserId = profile?.userId ?? conv.traderUserId;
    return [...new Set([conv.assignedTraderUserId, ownerUserId])];
  }
  const members = await activeCompanyMemberUserIds(conv.traderProfileId);
  return members.length > 0 ? members : [conv.traderUserId];
}
