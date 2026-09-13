import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { companyMembersTable, traderProfilesTable } from "@workspace/db/schema";
import { companyTeamsEnabled } from "./company-membership";
import { getCompanyPlanContext } from "./team-billing";

/**
 * Safe notification recipients for a company's trader side.
 *
 * An owner is always eligible. Employees must be active, have a non-suspended
 * seat, and retain a currently effective Team entitlement. This mirrors the
 * request-time job-access gate so a provider-confirmed downgrade cannot leave
 * an employee receiving customer data while reconciliation catches up.
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

  const [plan, rows] = await Promise.all([
    getCompanyPlanContext(traderProfileId),
    db
      .select({
        userId: companyMembersTable.userId,
        role: companyMembersTable.role,
      })
      .from(companyMembersTable)
      .where(
        and(
          eq(companyMembersTable.traderProfileId, traderProfileId),
          eq(companyMembersTable.status, "ACTIVE"),
          isNull(companyMembersTable.seatSuspendedAt),
        ),
      ),
  ]);

  const ids = new Set<number>([profile.userId]);
  if (plan.effectiveSeatAllowance > 0) {
    for (const row of rows) {
      if (row.role === "EMPLOYEE") ids.add(row.userId);
    }
  }
  return [...ids];
}

/**
 * Notification routing for a conversation. Claimed jobs notify only the
 * owner and, when still eligible, their assigned employee. Unclaimed jobs
 * notify every eligible employee and the owner.
 */
export async function traderSideRecipientUserIds(conv: {
  traderProfileId: number;
  traderUserId: number;
  assignedTraderUserId: number | null;
}): Promise<number[]> {
  if (!companyTeamsEnabled()) return [conv.traderUserId];

  const members = await activeCompanyMemberUserIds(conv.traderProfileId);
  if (conv.assignedTraderUserId == null) {
    return members.length > 0 ? members : [conv.traderUserId];
  }

  const [profile] = await db
    .select({ userId: traderProfilesTable.userId })
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.id, conv.traderProfileId))
    .limit(1);
  const ownerUserId = profile?.userId ?? conv.traderUserId;
  return [...new Set([ownerUserId, ...members.filter((id) => id === conv.assignedTraderUserId)])];
}