import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { usersTable, subscriptionsTable } from "@workspace/db/schema";
import { and, eq, isNull } from "drizzle-orm";

// --- Canonical RevenueCat customer identity ---
//
// The RevenueCat App User ID used to be the numeric users.id as a string —
// guessable and client-influenced (a tampered client could log the SDK in
// as any user's id and attach purchases/refunds to that account). The
// canonical identity is now a server-generated opaque token:
//
//     rc_<32 lowercase hex chars>   (crypto-random, 128 bits)
//
// Rules:
//   - Generated ONLY here, never by the client. The mobile app receives it
//     exclusively from authenticated responses (/auth/me, /auth/login) and
//     passes it verbatim to Purchases.logIn().
//   - Immutable once assigned (guarded UPDATE ... WHERE revenuecat_id IS
//     NULL); unique per user (users_revenuecat_id_unique).
//   - Existing rows are backfilled lazily on first exposure — no bulk
//     migration script is needed, and production picks the ids up as users
//     sign in after the schema push.
//   - Legacy migration alias: RevenueCat customers created before this
//     hardening are keyed by the numeric users.id string. The webhook
//     accepts that form as a DOCUMENTED alias (see resolution logic in
//     routes/subscriptions.ts); the sync route queries canonical-first.
//     Sandbox/TestFlight entitlements re-attach to the canonical id via
//     "Restore purchases" (RevenueCat receipt-transfer behaviour).

export const RC_ID_PATTERN = /^rc_[0-9a-f]{32}$/;

export function generateRevenueCatId(): string {
  return `rc_${randomBytes(16).toString("hex")}`;
}

/**
 * Return the user's canonical RevenueCat customer id, assigning one if the
 * row predates the column. Concurrency-safe: the guarded UPDATE only wins
 * when the column is still NULL, and the loser re-reads the winner's value.
 * Throws for unknown users (callers must already have authenticated them).
 */
export async function getOrCreateRevenueCatId(userId: number): Promise<string> {
  const [row] = await db
    .select({ revenuecatId: usersTable.revenuecatId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!row) throw new Error(`getOrCreateRevenueCatId: user ${userId} not found`);
  if (row.revenuecatId) return row.revenuecatId;

  // Two attempts guard against the (astronomically unlikely) unique-index
  // collision on the random id; a concurrent assignment by another request
  // is resolved by re-reading.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const updated = await db
        .update(usersTable)
        .set({ revenuecatId: generateRevenueCatId(), updatedAt: new Date() })
        .where(and(eq(usersTable.id, userId), isNull(usersTable.revenuecatId)))
        .returning({ revenuecatId: usersTable.revenuecatId });
      if (updated.length > 0 && updated[0].revenuecatId) return updated[0].revenuecatId;
      break; // zero rows: a concurrent request won — fall through to re-read
    } catch (err) {
      const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
        (err as { code?: string })?.code;
      if (code === "23505" && attempt === 0) continue; // random collision — retry once
      throw err;
    }
  }
  const [again] = await db
    .select({ revenuecatId: usersTable.revenuecatId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (again?.revenuecatId) return again.revenuecatId;
  throw new Error(`getOrCreateRevenueCatId: failed to assign id for user ${userId}`);
}

/**
 * Resolve an inbound RevenueCat app_user_id (webhook) to a local user id.
 *
 * Accepted forms — anything else fails closed (returns null):
 *   1. Canonical "rc_<32hex>" → users.revenuecat_id exact match.
 *   2. DOCUMENTED MIGRATION ALIAS: all-digits string → users.id, and ONLY
 *      when that user already has a local subscription row. RevenueCat
 *      customers created before the identity hardening carry the numeric id
 *      (it also survives forever as original_app_user_id on transferred
 *      receipts) — and every such customer necessarily has a subscription
 *      row from the purchase that created them. The gate turns "any
 *      guessable numeric id" into "only accounts with pre-existing billing
 *      history", closing the alias as a way to attach NEW subscription
 *      state to arbitrary accounts via an attacker-aliased SDK login.
 *      Remove entirely once all pre-hardening sandbox customers are gone.
 *
 * Returns { userId, legacyAlias } on success, null when the id has a valid
 * shape but matches no user (caller must treat that as an integrity signal).
 */
export async function resolveRevenueCatAppUserId(
  candidate: string,
): Promise<{ userId: number; legacyAlias: boolean } | null> {
  if (RC_ID_PATTERN.test(candidate)) {
    const [row] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.revenuecatId, candidate))
      .limit(1);
    return row ? { userId: row.id, legacyAlias: false } : null;
  }
  if (/^\d{1,10}$/.test(candidate)) {
    const numeric = Number(candidate);
    if (!Number.isInteger(numeric) || numeric <= 0) return null;
    const [row] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .innerJoin(subscriptionsTable, eq(subscriptionsTable.userId, usersTable.id))
      .where(eq(usersTable.id, numeric))
      .limit(1);
    return row ? { userId: row.id, legacyAlias: true } : null;
  }
  return null;
}

/** True for RevenueCat anonymous SDK identities — unmappable by design. */
export function isAnonymousRevenueCatId(candidate: string): boolean {
  return candidate.startsWith("$RCAnonymousID:");
}
