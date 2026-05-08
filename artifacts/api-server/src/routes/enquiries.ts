import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { enquiriesTable, usersTable, traderProfilesTable, conversationsTable, messagesTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { authMiddleware } from "../lib/auth";
import { CreateEnquiryBody } from "@workspace/api-zod";
import type { AuthenticatedRequest } from "../lib/types";
import { sendNewEnquiryEmail } from "../lib/email";
import { sendPushToUser } from "../lib/push-notifications";
import { detectContactInfo, contactViolationMessage } from "../lib/content-filter";
import { recordContactBlockAttempt } from "../lib/contact-block-tracker";

const router: IRouter = Router();

router.post("/enquiries", authMiddleware, async (req, res) => {
  try {
    const { userId, userRole } = req as AuthenticatedRequest;

    if (userRole !== "customer") {
      res.status(403).json({ error: "Only customers can submit enquiries" });
      return;
    }

    const { traderId, message, serviceRequired, preferredDate, phone } = CreateEnquiryBody.parse(req.body);

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
      (preferredDate ? `\n\nPreferred date: ${preferredDate}` : "");
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
          });
        }
      } catch (notifyErr) {
        req.log.warn({ err: notifyErr, enquiryId: enquiry.id }, "Failed to send new-enquiry email");
      }
      try {
        const customerName = customer?.fullName || "A customer";
        await sendPushToUser(trader.userId, {
          title: "New enquiry",
          body: `${customerName}: ${serviceRequired}`,
          data: {
            type: "new_enquiry",
            enquiryId: enquiry.id,
            conversationId,
          },
        });
      } catch (pushErr) {
        req.log.warn({ err: pushErr, enquiryId: enquiry.id }, "Failed to send new-enquiry push");
      }
    })();

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
        })
        .from(enquiriesTable)
        .innerJoin(usersTable, eq(enquiriesTable.customerId, usersTable.id))
        .innerJoin(traderProfilesTable, eq(enquiriesTable.traderId, traderProfilesTable.id))
        .where(eq(enquiriesTable.traderId, profile.id))
        .orderBy(desc(enquiriesTable.createdAt));
    } else {
      enquiries = await db
        .select({
          enquiry: enquiriesTable,
          customer: usersTable,
          trader: traderProfilesTable,
        })
        .from(enquiriesTable)
        .innerJoin(usersTable, eq(enquiriesTable.customerId, usersTable.id))
        .innerJoin(traderProfilesTable, eq(enquiriesTable.traderId, traderProfilesTable.id))
        .where(eq(enquiriesTable.customerId, userId))
        .orderBy(desc(enquiriesTable.createdAt));
    }

    const formatted = enquiries.map(({ enquiry: e, customer: c, trader: t }) => ({
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
      status: e.status,
      createdAt: e.createdAt.toISOString(),
    }));

    res.json({ enquiries: formatted, total: formatted.length });
  } catch (error) {
    req.log.error({ err: error }, "Get enquiries failed");
    res.status(500).json({ error: "Failed to get enquiries" });
  }
});

export default router;
