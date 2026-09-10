import { describe, expect, it, vi } from "vitest";
import {
  captureConversationReportEvidence,
  CONVERSATION_REPORT_APPEAL_WINDOW_MS,
  settleConversationReportEvidenceHold,
} from "./conversation-report-evidence";

function selectResult<T>(rows: T[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => rows),
    // Message queries intentionally do not use .limit(). Drizzle's query
    // promise is thenable, so the test double must be iterable via await too.
    then: (resolve: (value: T[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

describe("conversation report evidence manifest", () => {
  it("captures image-only and multi-attachment messages without changing their paths", async () => {
    const inserted: unknown[] = [];
    const tx = {
      select: vi.fn((selection: Record<string, unknown>) => {
        // The first select reads messages; enquiry context is absent in this
        // targeted-message case.
        if ("senderUserId" in selection) {
          return selectResult([
            {
              id: 41,
              senderUserId: 12,
              attachmentUrl: null,
              attachmentUrls: [
                "/objects/customer-uploads/12/v/photo-a",
                "/objects/customer-uploads/12/v/photo-b",
              ],
            },
          ]);
        }
        return selectResult([]);
      }),
      insert: vi.fn(() => ({
        values: async (rows: unknown[]) => {
          inserted.push(...rows);
        },
      })),
    } as any;

    await captureConversationReportEvidence(tx, {
      reportId: 7,
      conversationId: 9,
      enquiryId: null,
      customerId: 12,
      messageId: 41,
    });

    expect(inserted).toEqual([
      {
        conversationReportId: 7,
        conversationId: 9,
        messageId: 41,
        ownerUserId: 12,
        kind: "message",
        sourceRef: "message:41",
      },
      {
        conversationReportId: 7,
        conversationId: 9,
        messageId: 41,
        ownerUserId: 12,
        kind: "message-attachment",
        sourceRef: "/objects/customer-uploads/12/v/photo-a",
      },
      {
        conversationReportId: 7,
        conversationId: 9,
        messageId: 41,
        ownerUserId: 12,
        kind: "message-attachment",
        sourceRef: "/objects/customer-uploads/12/v/photo-b",
      },
    ]);
  });

  it("holds evidence for the current 30-day appeal window", async () => {
    const updated: Record<string, unknown>[] = [];
    const tx = {
      select: vi.fn(() => selectResult([])),
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => ({
          where: vi.fn(async () => {
            updated.push(values);
          }),
        })),
      })),
    } as any;

    await settleConversationReportEvidenceHold(tx, 99);
    expect(updated).toHaveLength(1);
    const holdUntil = updated[0].holdUntil as Date;
    expect(holdUntil.getTime()).toBeGreaterThan(Date.now() + CONVERSATION_REPORT_APPEAL_WINDOW_MS - 1000);
    expect(holdUntil.getTime()).toBeLessThanOrEqual(Date.now() + CONVERSATION_REPORT_APPEAL_WINDOW_MS + 1000);
  });
});