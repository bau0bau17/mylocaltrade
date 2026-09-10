import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = fs.readFileSync(path.join(__dirname, "ConversationReports.tsx"), "utf8");
const apiSource = fs.readFileSync(
  path.resolve(__dirname, "../../../api-server/src/routes/admin.ts"),
  "utf8",
);

describe("conversation report image evidence safety", () => {
  it("renders only server-supplied signed URLs with a usable unavailable state", () => {
    expect(pageSource).toContain("enquiryAttachments?: AdminConvAttachment[]");
    expect(pageSource).toContain("attachments: AdminConvAttachment[]");
    expect(pageSource).toContain("Original enquiry");
    expect(pageSource).toContain("message-image-${m.id}-${index}");
    expect(pageSource).toContain("m.attachments");
    expect(pageSource).toContain('src={attachment.url}');
    expect(pageSource).toContain('target="_blank"');
    expect(pageSource).toContain('rel="noopener noreferrer"');
    expect(pageSource).toContain("Image unavailable");
    expect(pageSource).not.toContain("attachment.objectPath");
  });

  it("keeps private attachment paths out of the response and signs only active-moderation evidence", () => {
    expect(apiSource).toContain("if (canReadMessages && row.conv.enquiryId)");
    expect(apiSource).toContain("await storage.getObjectEntityFile(path)");
    expect(apiSource).toContain("storage.getObjectEntityReadURL(path, 300)");
    expect(apiSource).toContain("enquiryAttachments,");
    expect(apiSource).toContain("messagesWithAttachments");
    expect(apiSource).toContain("message.attachmentUrls");
    expect(apiSource).toContain(".orderBy(asc(messagesTable.createdAt), asc(messagesTable.id))");
    expect(apiSource).not.toContain("enquiryAttachmentPaths");
  });
});