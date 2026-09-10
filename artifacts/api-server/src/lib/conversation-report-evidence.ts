import { db } from "@workspace/db";
import {
  conversationReportEvidenceTable,
  messagesTable,
  enquiriesTable,
  reportAppealsTable,
  conversationReportsTable,
} from "@workspace/db/schema";
import { and, eq, isNull } from "drizzle-orm";

type TxExecutor = Pick<typeof db, "select" | "insert" | "update">;
export const CONVERSATION_REPORT_APPEAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Captures only references to evidence that already exists. The source media
 * remains in private object storage; it is not duplicated.
 */
export async function captureConversationReportEvidence(
  tx: TxExecutor,
  input: {
    reportId: number;
    conversationId: number;
    enquiryId: number | null;
    customerId: number;
    messageId?: number | null;
  },
): Promise<void> {
  const messages = await tx
    .select({
      id: messagesTable.id,
      senderUserId: messagesTable.senderUserId,
      attachmentUrl: messagesTable.attachmentUrl,
      attachmentUrls: messagesTable.attachmentUrls,
    })
    .from(messagesTable)
    .where(
      input.messageId
        ? and(eq(messagesTable.conversationId, input.conversationId), eq(messagesTable.id, input.messageId))
        : eq(messagesTable.conversationId, input.conversationId),
    );

  const rows: Array<typeof conversationReportEvidenceTable.$inferInsert> = [];
  for (const message of messages) {
    rows.push({
      conversationReportId: input.reportId,
      conversationId: input.conversationId,
      messageId: message.id,
      ownerUserId: message.senderUserId ?? input.customerId,
      kind: "message",
      sourceRef: `message:${message.id}`,
    });
    const paths = Array.from(
      new Set([message.attachmentUrl, ...(message.attachmentUrls ?? [])].filter((path): path is string => !!path)),
    );
    for (const path of paths) {
      rows.push({
        conversationReportId: input.reportId,
        conversationId: input.conversationId,
        messageId: message.id,
        ownerUserId: message.senderUserId ?? input.customerId,
        kind: "message-attachment",
        sourceRef: path,
      });
    }
  }

  // The initial enquiry is conversation context for whole-conversation
  // reports. A targeted message report holds only the selected message.
  if (input.enquiryId && !input.messageId) {
    const [enquiry] = await tx
      .select({ attachmentUrls: enquiriesTable.attachmentUrls })
      .from(enquiriesTable)
      .where(eq(enquiriesTable.id, input.enquiryId))
      .limit(1);
    for (const path of enquiry?.attachmentUrls ?? []) {
      rows.push({
        conversationReportId: input.reportId,
        conversationId: input.conversationId,
        enquiryId: input.enquiryId,
        ownerUserId: input.customerId,
        kind: "enquiry-attachment",
        sourceRef: path,
      });
    }
  }

  if (rows.length > 0) await tx.insert(conversationReportEvidenceTable).values(rows);
}

/** Holds are case-bound. A newly opened permitted appeal makes the hold active again. */
export async function reopenConversationReportEvidenceHold(
  tx: TxExecutor,
  reportId: number,
): Promise<void> {
  await tx
    .update(conversationReportEvidenceTable)
    .set({ holdUntil: null, releasedAt: null })
    .where(eq(conversationReportEvidenceTable.conversationReportId, reportId));
}

export async function settleConversationReportEvidenceHold(
  tx: TxExecutor,
  reportId: number,
): Promise<void> {
  const [report] = await tx
    .select({
      status: conversationReportsTable.status,
      cseaEscalatedAt: conversationReportsTable.cseaEscalatedAt,
      cseaHandledAt: conversationReportsTable.cseaHandledAt,
    })
    .from(conversationReportsTable)
    .where(eq(conversationReportsTable.id, reportId))
    .limit(1);
  // CSEA completion can occur while ordinary moderation is still active.
  // Never shorten an ordinary or specialist investigation's indefinite hold.
  if (
    report?.status === "OPEN" ||
    (report?.cseaEscalatedAt != null && report.cseaHandledAt == null)
  ) return;
  const openAppeal = await tx
    .select({ id: reportAppealsTable.id })
    .from(reportAppealsTable)
    .where(
      and(
        eq(reportAppealsTable.conversationReportId, reportId),
        eq(reportAppealsTable.status, "OPEN"),
      ),
    )
    .limit(1);
  if (openAppeal.length > 0) return;
  await tx
    .update(conversationReportEvidenceTable)
    .set({
      releasedAt: null,
      holdUntil: new Date(Date.now() + CONVERSATION_REPORT_APPEAL_WINDOW_MS),
    })
    .where(
      and(
        eq(conversationReportEvidenceTable.conversationReportId, reportId),
        isNull(conversationReportEvidenceTable.releasedAt),
      ),
    );
}

/** Used only by account cleanup. A reference remains protected until a terminal
 * decision's enforced appeal window expires, or while an appeal is open. */
export async function isConversationEvidenceHeld(
  ownerUserId: number,
  objectPath: string,
): Promise<boolean> {
  const rows = await db
    .select({
      holdUntil: conversationReportEvidenceTable.holdUntil,
      releasedAt: conversationReportEvidenceTable.releasedAt,
    })
    .from(conversationReportEvidenceTable)
    .where(
      and(
        eq(conversationReportEvidenceTable.ownerUserId, ownerUserId),
        eq(conversationReportEvidenceTable.sourceRef, objectPath),
      ),
    );
  const now = Date.now();
  return rows.some(
    (row) =>
      row.releasedAt == null &&
      (row.holdUntil == null || row.holdUntil.getTime() > now),
  );
}