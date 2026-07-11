import { db } from "@workspace/db";
import { conversationsTable, messagesTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

// Insert a system milestone message (e.g. offer accepted / work done / job
// cancelled / quote sent) and surface it to the chosen party by bumping their
// unread counter + last-message preview, so lifecycle actions notify whoever
// needs to act next.
// notify: which side should see it as unread. "trader" for customer-driven
// actions (accept/complete), "customer" when the trader acts (quote sent,
// marked done); for a cancellation we notify only the opposite party (the
// canceller already knows).
export async function postSystemMessage(
  conversationId: number,
  body: string,
  notify: "trader" | "customer" | "both" = "trader",
) {
  const now = new Date();
  await db.insert(messagesTable).values({
    conversationId,
    senderUserId: null,
    senderRole: "system",
    body,
    systemMessage: true,
  });
  await db
    .update(conversationsTable)
    .set({
      lastMessageAt: now,
      lastMessagePreview: body.slice(0, 200),
      ...(notify === "trader" || notify === "both"
        ? { traderUnreadCount: sql`${conversationsTable.traderUnreadCount} + 1` }
        : {}),
      ...(notify === "customer" || notify === "both"
        ? { customerUnreadCount: sql`${conversationsTable.customerUnreadCount} + 1` }
        : {}),
      updatedAt: now,
    })
    .where(eq(conversationsTable.id, conversationId));
}
