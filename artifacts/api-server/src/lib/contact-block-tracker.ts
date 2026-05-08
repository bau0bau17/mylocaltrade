import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  contactBlockAttemptsTable,
  conversationReportsTable,
  conversationsTable,
  type ContactBlockSource,
  type ContactViolationKind,
} from "@workspace/db/schema";

export const CONTACT_BYPASS_THRESHOLD = 3;
export const CONTACT_BYPASS_WINDOW_MS = 24 * 60 * 60 * 1000;
const SNIPPET_MAX = 280;

export interface RecordAttemptArgs {
  userId: number;
  conversationId?: number | null;
  violationKind: ContactViolationKind;
  source: ContactBlockSource;
  snippet: string;
}

/**
 * Logs one CONTACT_INFO_BLOCKED attempt and, when it pushes the conversation
 * over the threshold within the rolling window, auto-flags the conversation
 * for admin review by inserting a system-generated conversation_report and
 * marking the conversation as REPORTED.
 *
 * Best-effort: never throws. Moderation logging must not break user flows.
 */
export async function recordContactBlockAttempt(args: RecordAttemptArgs): Promise<void> {
  try {
    const snippet = args.snippet.slice(0, SNIPPET_MAX);
    await db.insert(contactBlockAttemptsTable).values({
      userId: args.userId,
      conversationId: args.conversationId ?? null,
      violationKind: args.violationKind,
      source: args.source,
      snippet,
    });

    if (!args.conversationId) return;

    const since = new Date(Date.now() - CONTACT_BYPASS_WINDOW_MS);
    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contactBlockAttemptsTable)
      .where(
        and(
          eq(contactBlockAttemptsTable.conversationId, args.conversationId),
          gte(contactBlockAttemptsTable.createdAt, since),
        ),
      );

    if (count < CONTACT_BYPASS_THRESHOLD) return;

    // Already an OPEN report? Don't duplicate.
    const [existing] = await db
      .select({ id: conversationReportsTable.id })
      .from(conversationReportsTable)
      .where(
        and(
          eq(conversationReportsTable.conversationId, args.conversationId),
          eq(conversationReportsTable.status, "OPEN"),
        ),
      )
      .limit(1);
    if (existing) return;

    const [conv] = await db
      .select({ status: conversationsTable.status })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, args.conversationId))
      .limit(1);
    if (!conv || conv.status === "BLOCKED" || conv.status === "CLOSED") return;

    const reason =
      `Auto-flagged: ${count} contact-info bypass attempts in the last 24h ` +
      `(latest: ${args.violationKind}). Most recent attempt: "${snippet}"`;

    await db.insert(conversationReportsTable).values({
      conversationId: args.conversationId,
      reportedByUserId: args.userId,
      reportedByRole: "system",
      reason,
      status: "OPEN",
    });

    if (conv.status !== "REPORTED") {
      await db
        .update(conversationsTable)
        .set({ status: "REPORTED", updatedAt: new Date() })
        .where(eq(conversationsTable.id, args.conversationId));
    }
  } catch {
    // Swallow: logging contact-bypass attempts must never break the request.
  }
}

export interface ConversationAttemptStats {
  total: number;
  recent: number;
  lastAt: string | null;
}

/**
 * Returns counts of CONTACT_INFO_BLOCKED attempts for a single conversation.
 * `recent` covers the rolling threshold window.
 */
export async function getConversationAttemptStats(
  conversationId: number,
): Promise<ConversationAttemptStats> {
  const since = new Date(Date.now() - CONTACT_BYPASS_WINDOW_MS);
  const [totalRow] = await db
    .select({
      total: sql<number>`count(*)::int`,
      lastAt: sql<Date | null>`max(${contactBlockAttemptsTable.createdAt})`,
    })
    .from(contactBlockAttemptsTable)
    .where(eq(contactBlockAttemptsTable.conversationId, conversationId));
  const [recentRow] = await db
    .select({ recent: sql<number>`count(*)::int` })
    .from(contactBlockAttemptsTable)
    .where(
      and(
        eq(contactBlockAttemptsTable.conversationId, conversationId),
        gte(contactBlockAttemptsTable.createdAt, since),
      ),
    );
  const lastAt = totalRow?.lastAt ? new Date(totalRow.lastAt).toISOString() : null;
  return {
    total: totalRow?.total ?? 0,
    recent: recentRow?.recent ?? 0,
    lastAt,
  };
}

/**
 * Returns per-conversation attempt counts for a set of conversation ids.
 * Used by admin list endpoints to surface a "contact-bypass attempts" badge.
 */
export async function getAttemptCountsByConversation(
  conversationIds: number[],
): Promise<Map<number, { total: number; recent: number }>> {
  const result = new Map<number, { total: number; recent: number }>();
  if (conversationIds.length === 0) return result;
  const since = new Date(Date.now() - CONTACT_BYPASS_WINDOW_MS);
  const rows = await db
    .select({
      conversationId: contactBlockAttemptsTable.conversationId,
      total: sql<number>`count(*)::int`,
      recent: sql<number>`count(*) FILTER (WHERE ${contactBlockAttemptsTable.createdAt} >= ${since})::int`,
    })
    .from(contactBlockAttemptsTable)
    .where(sql`${contactBlockAttemptsTable.conversationId} = ANY(${conversationIds})`)
    .groupBy(contactBlockAttemptsTable.conversationId);
  for (const r of rows) {
    if (r.conversationId == null) continue;
    result.set(r.conversationId, { total: r.total ?? 0, recent: r.recent ?? 0 });
  }
  return result;
}

/**
 * Recent attempts for a conversation, for admin detail view.
 */
export async function listRecentAttemptsForConversation(
  conversationId: number,
  limit = 20,
) {
  return db
    .select()
    .from(contactBlockAttemptsTable)
    .where(eq(contactBlockAttemptsTable.conversationId, conversationId))
    .orderBy(desc(contactBlockAttemptsTable.createdAt))
    .limit(limit);
}
