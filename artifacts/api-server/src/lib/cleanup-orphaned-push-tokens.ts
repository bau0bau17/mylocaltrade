import { db } from "@workspace/db";
import { pushTokensTable, usersTable } from "@workspace/db/schema";
import { and, eq, inArray, isNotNull, like, or, type SQL } from "drizzle-orm";

/**
 * Orphaned push tokens = tokens whose owning account is already in a
 * terminal deletion state. The live deletion flows (request, anonymise,
 * complete) all purge tokens now, so this only matters for accounts deleted
 * BEFORE that purge existed. Kept as a shared predicate so the one-time
 * cleanup script and its tests can never drift apart.
 *
 * A user row is considered terminally deleted when ANY of:
 *  - deletionStatus is ANONYMISED or COMPLETED
 *  - deletedAt / anonymisedAt timestamp is set (only deletion flows set these)
 *  - email is a `.invalid` placeholder AND the account is deactivated —
 *    a placeholder email alone is deliberately NOT enough: registration
 *    validation does not forbid `.invalid` domains, so a (pathological but
 *    possible) active account with such an address must never match.
 *
 * Tokens of active users never match. Rows whose user was hard-deleted
 * cannot exist (FK is ON DELETE CASCADE).
 */
function deletedUserPredicate(): SQL {
  return or(
    inArray(usersTable.deletionStatus, ["ANONYMISED", "COMPLETED"]),
    isNotNull(usersTable.deletedAt),
    isNotNull(usersTable.anonymisedAt),
    and(like(usersTable.email, "%.invalid"), eq(usersTable.isActive, false)),
  )!;
}

export interface OrphanedPushToken {
  tokenId: number;
  userId: number;
  platform: string | null;
  deletionStatus: string | null;
}

/** Read-only: list the tokens the cleanup would remove. */
export async function findOrphanedPushTokens(): Promise<OrphanedPushToken[]> {
  const rows = await db
    .select({
      tokenId: pushTokensTable.id,
      userId: pushTokensTable.userId,
      platform: pushTokensTable.platform,
      deletionStatus: usersTable.deletionStatus,
    })
    .from(pushTokensTable)
    .innerJoin(usersTable, eq(usersTable.id, pushTokensTable.userId))
    .where(deletedUserPredicate());
  return rows;
}

/**
 * Delete orphaned tokens. Naturally idempotent — a second run finds nothing.
 * Returns the number of tokens removed.
 */
export async function cleanupOrphanedPushTokens(): Promise<number> {
  const orphans = await findOrphanedPushTokens();
  if (orphans.length === 0) return 0;
  await db.delete(pushTokensTable).where(
    inArray(
      pushTokensTable.id,
      orphans.map((o) => o.tokenId),
    ),
  );
  return orphans.length;
}
