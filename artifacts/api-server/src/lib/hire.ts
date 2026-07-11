import { db } from "@workspace/db";
import { conversationsTable } from "@workspace/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { formatJobReference } from "./job-reference";
import { postSystemMessage } from "./system-messages";

// Idempotent, race-safe hire: stamps customerAcceptedAt + jobReference exactly
// once per conversation (the conditional UPDATE only wins for the first
// caller) and posts the milestone system message only on the winning call.
// Shared by the legacy "Accept offer" flow and structured-quote acceptance so
// the hire semantics can never drift apart.
export async function ensureHired(conversationId: number): Promise<{ newlyHired: boolean }> {
  const now = new Date();
  const updated = await db
    .update(conversationsTable)
    .set({
      customerAcceptedAt: now,
      jobReference: sql`COALESCE(${conversationsTable.jobReference}, ${formatJobReference(conversationId)})`,
      updatedAt: now,
    })
    .where(
      and(
        eq(conversationsTable.id, conversationId),
        isNull(conversationsTable.customerAcceptedAt),
      ),
    )
    .returning({ id: conversationsTable.id });
  if (updated.length > 0) {
    await postSystemMessage(
      conversationId,
      "The customer accepted the offer and hired the trader.",
    );
    return { newlyHired: true };
  }
  return { newlyHired: false };
}
