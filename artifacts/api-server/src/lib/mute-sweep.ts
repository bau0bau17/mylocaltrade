import { db } from "@workspace/db";
import { conversationsTable } from "@workspace/db/schema";
import { and, isNotNull, lte, or, sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Null out timed mute columns whose `*_muted_until` has elapsed. Indefinite
 * mutes (`mutedUntil IS NULL`) are left alone. Each side is cleared
 * independently so a one-sided expiry doesn't disturb the other side.
 *
 * The application's `isMuted(mutedAt, mutedUntil)` helper already treats an
 * expired row as not-muted, so this sweep is purely DB hygiene — no
 * user-visible behaviour change.
 */
export async function sweepExpiredMutes(): Promise<{ customerCleared: number; traderCleared: number }> {
  const now = new Date();

  const customerResult = await db
    .update(conversationsTable)
    .set({ customerMutedAt: null, customerMutedUntil: null, updatedAt: now })
    .where(
      and(
        isNotNull(conversationsTable.customerMutedUntil),
        lte(conversationsTable.customerMutedUntil, now),
      ),
    )
    .returning({ id: conversationsTable.id });

  const traderResult = await db
    .update(conversationsTable)
    .set({ traderMutedAt: null, traderMutedUntil: null, updatedAt: now })
    .where(
      and(
        isNotNull(conversationsTable.traderMutedUntil),
        lte(conversationsTable.traderMutedUntil, now),
      ),
    )
    .returning({ id: conversationsTable.id });

  return { customerCleared: customerResult.length, traderCleared: traderResult.length };
}
