import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { enquiriesTable, usersTable, traderProfilesTable, conversationsTable, messagesTable } from "@workspace/db/schema";
import { eq, desc, and, isNull, isNotNull, inArray, sql } from "drizzle-orm";
import { authMiddleware } from "../lib/auth";
import { CreateEnquiryBody } from "@workspace/api-zod";
import type { AuthenticatedRequest } from "../lib/types";
import { sendNewEnquiryEmail, sendEnquirySentToCustomerEmail } from "../lib/email";
import { sendPushToUser } from "../lib/push-notifications";
import { scheduleLeadReminderForEnquiry } from "../lib/lead-reminders";
import { detectContactInfo, contactViolationMessage } from "../lib/content-filter";
import { recordContactBlockAttempt } from "../lib/contact-block-tracker";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();

// Validate that every attachment URL really belongs to the calling customer's
// own customer-uploads/<userId>/ namespace AND that the stored object meets
// our size/MIME policy (defends against clients lying in the upload-URL
// request). Returns the normalised paths or throws an Error whose message is
// safe to surface to the client.
async function validateEnquiryAttachments(rawUrls: string[] | undefined, userId: number): Promise<string[]> {
  if (!rawUrls || rawUrls.length === 0) return [];
  if (rawUrls.length > 3) {
    throw new Error("A maximum of 3 photos can be attached to an enquiry.");
  }
  return Promise.all(
    rawUrls.map((u) =>
      storage.verifyCustomerUploadObject(u, userId, {
        maxBytes: 8 * 1024 * 1024,
        allowedMimes: new Set([
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/heic",
          "image/heif",
        ]),
        label: "photo",
      }),
    ),
  );
}

router.post("/enquiries", authMiddleware, async (req, res) => {
  try {
    const { userId, userRole } = req as AuthenticatedRequest;

    if (userRole !== "customer") {
      res.status(403).json({ error: "Only customers can submit enquiries" });
      return;
    }

    const { traderId, message, serviceRequired, preferredDate, phone, attachmentUrls, specialistFields } = CreateEnquiryBody.parse(req.body);

    let normalisedAttachments: string[];
    try {
      normalisedAttachments = await validateEnquiryAttachments(attachmentUrls, userId);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    const violation =
      detectContactInfo(message) ??
      detectContactInfo(serviceRequired) ??
      (preferredDate ? detectContactInfo(preferredDate) : null);
    if (violation) {
      void recordContactBlockAttempt({
        userId,
        conversationId: null,
        violationKind: violation,
        source: "enquiry",
        snippet: `${serviceRequired}\n${message}`,
      });
      res.status(400).json({
        error: contactViolationMessage(violation),
        code: "CONTACT_INFO_BLOCKED",
        violation,
      });
      return;
    }

    const [trader] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.id, traderId))
      .limit(1);

    if (!trader || !trader.isActive || trader.verificationStatus !== "VERIFIED") {
      res.status(404).json({ error: "Trader not found" });
      return;
    }

    const [customer] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    // Phase 17: every enquiry from a logged-in customer also opens a
    // conversation thread, atomically. The original enquiry message becomes
    // the first message in that thread so customer + trader can chat.
    const previewBody =
      `Service: ${serviceRequired}\n\n${message}` +
      (preferredDate ? `\n\nPreferred date: ${preferredDate}` : "") +
      (normalisedAttachments.length > 0
        ? `\n\n[${normalisedAttachments.length} photo${normalisedAttachments.length === 1 ? "" : "s"} attached]`
        : "");
    const { enquiry, conversationId } = await db.transaction(async (tx) => {
      const [enq] = await tx
        .insert(enquiriesTable)
        .values({
          traderId,
          customerId: userId,
          message,
          serviceRequired,
          preferredDate: preferredDate || null,
          phone: phone || null,
          attachmentUrls: normalisedAttachments,
          specialistFields: specialistFields ?? null,
          status: "pending",
        })
        .returning();
      const [conv] = await tx
        .insert(conversationsTable)
        .values({
          customerId: userId,
          traderUserId: trader.userId,
          traderProfileId: trader.id,
          enquiryId: enq.id,
          serviceRequired,
          status: "AWAITING_TRADER_REPLY",
          traderStatus: "NEW",
          customerUnreadCount: 0,
          traderUnreadCount: 1,
          lastMessageAt: new Date(),
          lastMessagePreview: previewBody.slice(0, 200),
        })
        .returning({ id: conversationsTable.id });
      await tx.insert(messagesTable).values({
        conversationId: conv.id,
        senderUserId: userId,
        senderRole: "customer",
        body: previewBody,
      });
      return { enquiry: enq, conversationId: conv.id };
    });

    // Notify the trader — fire-and-forget so the API response is never
    // blocked on SMTP latency. Failures are logged, never surfaced.
    void (async () => {
      try {
        const [traderUser] = await db
          .select({ email: usersTable.email, fullName: usersTable.fullName })
          .from(usersTable)
          .where(eq(usersTable.id, trader.userId))
          .limit(1);
        if (traderUser?.email) {
          await sendNewEnquiryEmail({
            toEmail: traderUser.email,
            toName: traderUser.fullName || trader.businessName,
            customerName: customer?.fullName || "A customer",
            serviceRequired,
            message,
            preferredDate: preferredDate || null,
            phone: phone || null,
            specialistFields: specialistFields ?? null,
          });
        }
      } catch (notifyErr) {
        req.log.warn({ err: notifyErr, enquiryId: enquiry.id }, "Failed to send new-enquiry email");
      }
      try {
        if (customer?.email) {
          await sendEnquirySentToCustomerEmail({
            toEmail: customer.email,
            toName: customer.fullName ?? null,
            traderBusinessName: trader.businessName,
            serviceRequired,
            message,
          });
        }
      } catch (confirmErr) {
        req.log.warn({ err: confirmErr, enquiryId: enquiry.id }, "Failed to send enquiry confirmation email");
      }
      try {
        const customerName = customer?.fullName || "A customer";
        const isUrgent = specialistFields?.urgency === "urgent";
        await sendPushToUser(trader.userId, {
          title: isUrgent ? "New ASAP enquiry" : "New enquiry",
          body: isUrgent
            ? `ASAP — ${customerName}: ${serviceRequired}`
            : `${customerName}: ${serviceRequired}`,
          data: {
            type: "new_enquiry",
            enquiryId: enquiry.id,
            conversationId,
            ...(isUrgent ? { urgency: "urgent" } : {}),
          },
        });
      } catch (pushErr) {
        req.log.warn({ err: pushErr, enquiryId: enquiry.id }, "Failed to send new-enquiry push");
      }
    })();

    // Phase 18: if the trader hasn't opened this lead within ~60 minutes,
    // send a follow-up reminder push. The periodic sweep is the source of
    // truth (survives restarts); this in-process timer is just for latency.
    scheduleLeadReminderForEnquiry(enquiry.id, trader.leadReminderMinutes);

    res.status(201).json({
      id: enquiry.id,
      traderId: enquiry.traderId,
      customerId: enquiry.customerId,
      customerName: customer?.fullName || "Unknown",
      customerEmail: customer?.email || "",
      traderBusinessName: trader.businessName,
      message: enquiry.message,
      serviceRequired: enquiry.serviceRequired,
      preferredDate: enquiry.preferredDate,
      phone: enquiry.phone,
      attachmentUrls: enquiry.attachmentUrls ?? [],
      specialistFields: enquiry.specialistFields ?? null,
      status: enquiry.status,
      conversationId,
      createdAt: enquiry.createdAt.toISOString(),
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      res.status(400).json({ error: "Invalid enquiry data" });
      return;
    }
    req.log.error({ err: error }, "Create enquiry failed");
    res.status(500).json({ error: "Failed to create enquiry" });
  }
});

// GET /api/enquiries/new-count — number of leads the trader hasn't opened yet
router.get("/enquiries/new-count", authMiddleware, async (req, res) => {
  try {
    const { userId, userRole } = req as AuthenticatedRequest;
    if (userRole !== "trader") {
      res.json({ newCount: 0 });
      return;
    }
    const [profile] = await db
      .select({ id: traderProfilesTable.id })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, userId))
      .limit(1);
    if (!profile) {
      res.json({ newCount: 0 });
      return;
    }
    const [row] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.traderProfileId, profile.id),
          isNotNull(conversationsTable.enquiryId),
          isNull(conversationsTable.traderViewedAt),
        ),
      );
    res.json({ newCount: row?.count ?? 0 });
  } catch (error) {
    req.log.error({ err: error }, "Get new lead count failed");
    res.status(500).json({ error: "Failed to get new lead count" });
  }
});

// GET /api/enquiries/compare — customer's enquiries grouped by job (serviceRequired)
// so they can compare quotes/responses from multiple traders side by side.
router.get("/enquiries/compare", authMiddleware, async (req, res) => {
  try {
    const { userId, userRole } = req as AuthenticatedRequest;
    if (userRole !== "customer") {
      res.status(403).json({ error: "Only customers can compare enquiries" });
      return;
    }

    const rows = await db
      .select({
        enquiryId: enquiriesTable.id,
        serviceRequired: enquiriesTable.serviceRequired,
        enquiryStatus: enquiriesTable.status,
        enquiryCreatedAt: enquiriesTable.createdAt,
        traderProfileId: traderProfilesTable.id,
        traderUserId: traderProfilesTable.userId,
        traderBusinessName: traderProfilesTable.businessName,
        traderTown: traderProfilesTable.town,
        traderRating: traderProfilesTable.rating,
        traderReviewCount: traderProfilesTable.reviewCount,
        conversationId: conversationsTable.id,
        traderStatus: conversationsTable.traderStatus,
        conversationStatus: conversationsTable.status,
        lastMessageAt: conversationsTable.lastMessageAt,
        lastMessagePreview: conversationsTable.lastMessagePreview,
      })
      .from(enquiriesTable)
      .innerJoin(traderProfilesTable, eq(enquiriesTable.traderId, traderProfilesTable.id))
      .leftJoin(conversationsTable, eq(conversationsTable.enquiryId, enquiriesTable.id))
      .where(eq(enquiriesTable.customerId, userId))
      .orderBy(desc(enquiriesTable.createdAt));

    // Pull the latest trader message per conversation so the customer sees the
    // actual response (the conversation preview can be the customer's own
    // message if the trader hasn't replied).
    const conversationIds = rows.map((r) => r.conversationId).filter((c): c is number => c != null);
    const latestTraderByConv = new Map<
      number,
      { body: string; createdAt: Date }
    >();
    if (conversationIds.length > 0) {
      const traderMessages = await db
        .select({
          conversationId: messagesTable.conversationId,
          body: messagesTable.body,
          createdAt: messagesTable.createdAt,
        })
        .from(messagesTable)
        .where(
          and(
            eq(messagesTable.senderRole, "trader"),
            inArray(messagesTable.conversationId, conversationIds),
          ),
        )
        .orderBy(desc(messagesTable.createdAt));
      for (const m of traderMessages) {
        if (m.conversationId == null) continue;
        if (!latestTraderByConv.has(m.conversationId)) {
          latestTraderByConv.set(m.conversationId, {
            body: m.body,
            createdAt: m.createdAt,
          });
        }
      }
    }

    type Offer = {
      enquiryId: number;
      enquiryStatus: string;
      enquiryCreatedAt: string;
      traderProfileId: number;
      traderUserId: number;
      traderBusinessName: string;
      traderTown: string | null;
      traderRating: number | null;
      traderReviewCount: number;
      conversationId: number | null;
      traderStatus: string | null;
      conversationStatus: string | null;
      lastMessageAt: string | null;
      lastTraderReplyPreview: string | null;
      lastTraderReplyAt: string | null;
      hasTraderReply: boolean;
    };

    const groups = new Map<string, { serviceRequired: string; offers: Offer[] }>();
    for (const r of rows) {
      const key = r.serviceRequired.trim().toLowerCase();
      if (!groups.has(key)) {
        groups.set(key, { serviceRequired: r.serviceRequired, offers: [] });
      }
      const traderReply = r.conversationId != null ? latestTraderByConv.get(r.conversationId) : undefined;
      groups.get(key)!.offers.push({
        enquiryId: r.enquiryId,
        enquiryStatus: r.enquiryStatus,
        enquiryCreatedAt: r.enquiryCreatedAt.toISOString(),
        traderProfileId: r.traderProfileId,
        traderUserId: r.traderUserId,
        traderBusinessName: r.traderBusinessName,
        traderTown: r.traderTown ?? null,
        traderRating: r.traderRating != null ? Number(r.traderRating) : null,
        traderReviewCount: r.traderReviewCount ?? 0,
        conversationId: r.conversationId ?? null,
        traderStatus: r.traderStatus ?? null,
        conversationStatus: r.conversationStatus ?? null,
        lastMessageAt: r.lastMessageAt ? r.lastMessageAt.toISOString() : null,
        lastTraderReplyPreview: traderReply?.body.slice(0, 240) ?? null,
        lastTraderReplyAt: traderReply ? traderReply.createdAt.toISOString() : null,
        hasTraderReply: !!traderReply,
      });
    }

    const result = Array.from(groups.values())
      // Newest job first (by most recent enquiry in the group)
      .map((g) => ({
        ...g,
        offers: g.offers.sort((a, b) => {
          // Replies first, then by recency
          if (a.hasTraderReply !== b.hasTraderReply) return a.hasTraderReply ? -1 : 1;
          const at = a.lastTraderReplyAt ?? a.enquiryCreatedAt;
          const bt = b.lastTraderReplyAt ?? b.enquiryCreatedAt;
          return bt.localeCompare(at);
        }),
      }))
      .sort((a, b) => {
        const aLatest = a.offers[0]?.enquiryCreatedAt ?? "";
        const bLatest = b.offers[0]?.enquiryCreatedAt ?? "";
        return bLatest.localeCompare(aLatest);
      });

    res.json({ groups: result, totalGroups: result.length });
  } catch (error) {
    req.log.error({ err: error }, "Compare enquiries failed");
    res.status(500).json({ error: "Failed to load comparison" });
  }
});

router.get("/enquiries", authMiddleware, async (req, res) => {
  try {
    const { userId, userRole } = req as AuthenticatedRequest;

    let enquiries;

    if (userRole === "trader") {
      const [profile] = await db
        .select()
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.userId, userId))
        .limit(1);

      if (!profile) {
        res.json({ enquiries: [], total: 0 });
        return;
      }

      enquiries = await db
        .select({
          enquiry: enquiriesTable,
          customer: usersTable,
          trader: traderProfilesTable,
          conversationId: conversationsTable.id,
          traderViewedAt: conversationsTable.traderViewedAt,
        })
        .from(enquiriesTable)
        .innerJoin(usersTable, eq(enquiriesTable.customerId, usersTable.id))
        .innerJoin(traderProfilesTable, eq(enquiriesTable.traderId, traderProfilesTable.id))
        .leftJoin(conversationsTable, eq(conversationsTable.enquiryId, enquiriesTable.id))
        .where(eq(enquiriesTable.traderId, profile.id))
        .orderBy(desc(enquiriesTable.createdAt));
    } else {
      enquiries = await db
        .select({
          enquiry: enquiriesTable,
          customer: usersTable,
          trader: traderProfilesTable,
          conversationId: conversationsTable.id,
          traderViewedAt: conversationsTable.traderViewedAt,
        })
        .from(enquiriesTable)
        .innerJoin(usersTable, eq(enquiriesTable.customerId, usersTable.id))
        .innerJoin(traderProfilesTable, eq(enquiriesTable.traderId, traderProfilesTable.id))
        .leftJoin(conversationsTable, eq(conversationsTable.enquiryId, enquiriesTable.id))
        .where(eq(enquiriesTable.customerId, userId))
        .orderBy(desc(enquiriesTable.createdAt));
    }

    const formatted = enquiries.map(({ enquiry: e, customer: c, trader: t, conversationId, traderViewedAt }) => ({
      id: e.id,
      traderId: e.traderId,
      customerId: e.customerId,
      customerName: c.fullName,
      customerEmail: c.email,
      traderBusinessName: t.businessName,
      message: e.message,
      serviceRequired: e.serviceRequired,
      preferredDate: e.preferredDate,
      phone: e.phone,
      attachmentUrls: e.attachmentUrls ?? [],
      specialistFields: e.specialistFields ?? null,
      status: e.status,
      conversationId: conversationId ?? null,
      viewedByTrader: traderViewedAt != null,
      createdAt: e.createdAt.toISOString(),
    }));

    res.json({ enquiries: formatted, total: formatted.length });
  } catch (error) {
    req.log.error({ err: error }, "Get enquiries failed");
    res.status(500).json({ error: "Failed to get enquiries" });
  }
});

export default router;
