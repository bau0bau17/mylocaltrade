import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { getActiveMembership } from "../lib/company-membership";
import { enquiriesTable, usersTable, traderProfilesTable, conversationsTable, messagesTable, quotesTable } from "@workspace/db/schema";
import {
  companyTeamsEnabled,
  activeCompanyMemberUserIds,
} from "../lib/company-membership";
import { eq, desc, and, isNull, isNotNull, inArray, sql, gte } from "drizzle-orm";
import { deriveStage } from "../lib/conversation-stage";
import { jobReferenceOf } from "../lib/job-reference";
import { serializeQuote, type SerializedQuote } from "../lib/quotes";
import { computeResponseTimes } from "../lib/response-times";
import { authMiddleware } from "../lib/auth";
import { CreateEnquiryBody } from "@workspace/api-zod";
import type { AuthenticatedRequest } from "../lib/types";
import { sendNewEnquiryEmail, sendEnquirySentToCustomerEmail } from "../lib/email";
import { sendPushToUser } from "../lib/push-notifications";
import { scheduleLeadReminderForEnquiry } from "../lib/lead-reminders";
import { detectContactInfo, contactViolationMessage } from "../lib/content-filter";
import { recordContactBlockAttempt } from "../lib/contact-block-tracker";
import { ObjectStorageService } from "../lib/objectStorage";
import { sendPhoneVerificationRequired } from "../lib/customer-phone-gate";

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

    // Account-level suspension (admin moderation): suspended users cannot
    // create enquiries.
    if (customer?.suspendedAt) {
      res.status(403).json({
        error: "Your account has been suspended. You cannot send new enquiries.",
        code: "ACCOUNT_SUSPENDED",
      });
      return;
    }

    // Contact gate: a customer must have SMS-verified a UK mobile before
    // their first enquiry. The app reads `code` and routes to verify-phone.
    if (!customer?.phoneVerified) {
      sendPhoneVerificationRequired(res);
      return;
    }

    // Phase 17: every enquiry from a logged-in customer also opens a
    // conversation thread, atomically. The original enquiry message becomes
    // the first message in that thread so customer + trader can chat.
    const previewBody =
      `Service: ${serviceRequired}\n\n${message}` +
      (preferredDate ? `\n\nPreferred date: ${preferredDate}` : "") +
      (normalisedAttachments.length > 0
        ? `\n\n[${normalisedAttachments.length} photo${normalisedAttachments.length === 1 ? "" : "s"} attached]`
        : "");
    // Group enquiries that came from the same original request so Compare
    // Offers can show them side by side. Heuristic: same customer asking for
    // the same (normalised) service within 30 days joins the existing group;
    // otherwise a fresh group id is minted.
    const serviceKey = serviceRequired.trim().toLowerCase();
    const groupWindowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [recentGroup] = await db
      .select({ gid: enquiriesTable.requestGroupId })
      .from(enquiriesTable)
      .where(
        and(
          eq(enquiriesTable.customerId, userId),
          isNotNull(enquiriesTable.requestGroupId),
          sql`lower(btrim(${enquiriesTable.serviceRequired})) = ${serviceKey}`,
          gte(enquiriesTable.createdAt, groupWindowStart),
        ),
      )
      .orderBy(desc(enquiriesTable.createdAt))
      .limit(1);
    const requestGroupId = recentGroup?.gid ?? randomUUID();

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
          requestGroupId,
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
          // Company Teams (Phase 2): with the flag ON a new lead is SHARED —
          // unassigned until a member claims it by replying/quoting. Flag OFF
          // it is born assigned to the owner AT CREATION (never dependent on
          // the boot-time mirror), which is exactly the legacy model.
          assignedTraderUserId: companyTeamsEnabled() ? null : trader.userId,
          assignedAt: companyTeamsEnabled() ? null : new Date(),
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
            // Stage gate: the customer's phone is not shared at the lead stage.
            // It is revealed in-app only once the customer hires the trader.
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
        // Company Teams: a new lead is a SHARED opportunity — push every
        // ACTIVE member (email above stays owner-only by design). Flag OFF
        // this is exactly [owner], the legacy behaviour.
        const pushRecipients = await activeCompanyMemberUserIds(trader.id);
        for (const recipientId of pushRecipients) {
          try {
            await sendPushToUser(recipientId, {
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
        }
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
      // The creator is always the customer, who sees their own details.
      contactUnlocked: true,
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
    const membership = await getActiveMembership(userId);
    if (!membership) {
      res.json({ newCount: 0 });
      return;
    }
    const profile = { id: membership.traderProfileId };
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
        requestGroupId: enquiriesTable.requestGroupId,
        traderProfileId: traderProfilesTable.id,
        traderUserId: traderProfilesTable.userId,
        traderBusinessName: traderProfilesTable.businessName,
        traderTown: traderProfilesTable.town,
        traderRating: traderProfilesTable.rating,
        traderReviewCount: traderProfilesTable.reviewCount,
        traderVerificationStatus: traderProfilesTable.verificationStatus,
        conv: conversationsTable,
      })
      .from(enquiriesTable)
      .innerJoin(traderProfilesTable, eq(enquiriesTable.traderId, traderProfilesTable.id))
      .leftJoin(conversationsTable, eq(conversationsTable.enquiryId, enquiriesTable.id))
      .where(eq(enquiriesTable.customerId, userId))
      .orderBy(desc(enquiriesTable.createdAt));

    const conversationIds = rows
      .map((r) => r.conv?.id)
      .filter((c): c is number => c != null);

    // Latest structured quote per conversation (revisions are inserted last,
    // so the newest row IS the current version of the quote chain).
    const latestQuoteByConv = new Map<number, SerializedQuote>();
    if (conversationIds.length > 0) {
      const quoteRows = await db
        .select()
        .from(quotesTable)
        .where(inArray(quotesTable.conversationId, conversationIds))
        .orderBy(desc(quotesTable.createdAt));
      for (const q of quoteRows) {
        if (!latestQuoteByConv.has(q.conversationId)) {
          latestQuoteByConv.set(q.conversationId, serializeQuote(q));
        }
      }
    }

    // Whether the trader has replied at all (drives "Awaiting reply" states),
    // plus the latest reply preview kept for older installed app builds that
    // still render free-text replies as offers.
    const latestTraderByConv = new Map<number, { body: string; createdAt: Date }>();
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
          latestTraderByConv.set(m.conversationId, { body: m.body, createdAt: m.createdAt });
        }
      }
    }

    // "Replies fast" badge data, same median metric as trader search.
    const responseTimes = await computeResponseTimes(
      Array.from(new Set(rows.map((r) => r.traderProfileId))),
    );

    type Offer = ReturnType<typeof toOffer>;
    function toOffer(r: (typeof rows)[number]) {
      const traderReply = r.conv ? latestTraderByConv.get(r.conv.id) : undefined;
      return {
        enquiryId: r.enquiryId,
        enquiryStatus: r.enquiryStatus,
        enquiryCreatedAt: r.enquiryCreatedAt.toISOString(),
        traderProfileId: r.traderProfileId,
        traderUserId: r.traderUserId,
        traderBusinessName: r.traderBusinessName,
        traderTown: r.traderTown ?? null,
        traderRating: r.traderRating != null ? Number(r.traderRating) : null,
        traderReviewCount: r.traderReviewCount ?? 0,
        traderVerified: r.traderVerificationStatus === "VERIFIED",
        traderResponseTimeMinutes: responseTimes.get(r.traderProfileId) ?? null,
        conversationId: r.conv?.id ?? null,
        traderStatus: r.conv?.traderStatus ?? null,
        conversationStatus: r.conv?.status ?? null,
        stage: r.conv ? deriveStage(r.conv) : null,
        lastMessageAt: r.conv?.lastMessageAt?.toISOString() ?? null,
        quote: r.conv ? latestQuoteByConv.get(r.conv.id) ?? null : null,
        hasTraderReply: !!traderReply,
        // Legacy fields consumed by app builds that predate structured
        // quotes; not part of the current API contract.
        lastTraderReplyPreview: traderReply?.body.slice(0, 240) ?? null,
        lastTraderReplyAt: traderReply ? traderReply.createdAt.toISOString() : null,
      };
    }

    // Group strictly by requestGroupId. Rows that somehow missed the startup
    // backfill fall back to a per-enquiry group so nothing disappears.
    const groups = new Map<string, { requestGroupId: string; serviceRequired: string; offers: Offer[] }>();
    for (const r of rows) {
      const key = r.requestGroupId ?? `enq-${r.enquiryId}`;
      if (!groups.has(key)) {
        groups.set(key, { requestGroupId: key, serviceRequired: r.serviceRequired, offers: [] });
      }
      groups.get(key)!.offers.push(toOffer(r));
    }

    const quoteRank = (o: Offer) => {
      if (!o.quote) return 3;
      if (o.quote.status === "PENDING" || o.quote.status === "ACCEPTED") return 0;
      if (o.quote.status === "EXPIRED") return 1;
      return 2; // declined / withdrawn / revised tail
    };

    const result = Array.from(groups.values())
      .map((g) => ({
        ...g,
        // Actionable quotes first, then quoted-but-lapsed, then replies
        // without a quote, then silence — each bucket newest first.
        offers: g.offers.sort((a, b) => {
          const qr = quoteRank(a) - quoteRank(b);
          if (qr !== 0) return qr;
          if (a.hasTraderReply !== b.hasTraderReply) return a.hasTraderReply ? -1 : 1;
          const at = a.quote?.createdAt ?? a.lastMessageAt ?? a.enquiryCreatedAt;
          const bt = b.quote?.createdAt ?? b.lastMessageAt ?? b.enquiryCreatedAt;
          return bt.localeCompare(at);
        }),
      }))
      // Newest job first (by most recent enquiry in the group)
      .sort((a, b) => {
        const aLatest = Math.max(...a.offers.map((o) => Date.parse(o.enquiryCreatedAt)));
        const bLatest = Math.max(...b.offers.map((o) => Date.parse(o.enquiryCreatedAt)));
        return bLatest - aLatest;
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
      const membership = await getActiveMembership(userId);

      if (!membership) {
        res.json({ enquiries: [], total: 0 });
        return;
      }
      const profile = membership.profile;

      enquiries = await db
        .select({
          enquiry: enquiriesTable,
          customer: usersTable,
          trader: traderProfilesTable,
          conv: conversationsTable,
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
          conv: conversationsTable,
        })
        .from(enquiriesTable)
        .innerJoin(usersTable, eq(enquiriesTable.customerId, usersTable.id))
        .innerJoin(traderProfilesTable, eq(enquiriesTable.traderId, traderProfilesTable.id))
        .leftJoin(conversationsTable, eq(conversationsTable.enquiryId, enquiriesTable.id))
        .where(eq(enquiriesTable.customerId, userId))
        .orderBy(desc(enquiriesTable.createdAt));
    }

    // Company Teams: resolve assigned-member names in one batch so the leads
    // list can show "Claimed by …" chips (flag ON only — legacy payload keeps
    // the owner implicitly assigned and no name).
    const teamsOn = companyTeamsEnabled();
    const assignedNameById = new Map<number, string>();
    if (teamsOn) {
      const assignedIds = [
        ...new Set(
          enquiries
            .map((r) => r.conv?.assignedTraderUserId)
            .filter((v): v is number => v != null),
        ),
      ];
      if (assignedIds.length > 0) {
        const assignedRows = await db
          .select({ id: usersTable.id, fullName: usersTable.fullName })
          .from(usersTable)
          .where(inArray(usersTable.id, assignedIds));
        for (const u of assignedRows) {
          if (u.fullName) assignedNameById.set(u.id, u.fullName);
        }
      }
    }

    const viewerIsTrader = userRole === "trader";
    const formatted = enquiries.map(({ enquiry: e, customer: c, trader: t, conv }) => {
      // Stage gate: a trader only sees the customer's contact details once the
      // customer has hired them (customerAcceptedAt set = HIRED stage). Before
      // that, they communicate via in-app messaging only. Deterministic and
      // auditable — tied to a concrete lifecycle timestamp, not a trust score.
      // Customers always see their own details.
      const contactUnlocked = !viewerIsTrader || conv?.customerAcceptedAt != null;
      return {
        id: e.id,
        traderId: e.traderId,
        customerId: e.customerId,
        customerName: c.fullName,
        customerEmail: contactUnlocked ? c.email : null,
        traderBusinessName: t.businessName,
        message: e.message,
        serviceRequired: e.serviceRequired,
        preferredDate: e.preferredDate,
        phone: contactUnlocked ? e.phone : null,
        attachmentUrls: e.attachmentUrls ?? [],
        specialistFields: e.specialistFields ?? null,
        status: e.status,
        conversationId: conv?.id ?? null,
        viewedByTrader: conv?.traderViewedAt != null,
        contactUnlocked,
        // Lead-lifecycle context so the trader's Enquiries & Leads list can
        // show the real job status (New/Responded/Quoted/Hired/Completed)
        // and the Job Reference after hire. Read-only projections of
        // existing conversation state — no new workflow.
        traderStatus: conv?.traderStatus ?? null,
        stage: conv ? deriveStage(conv) : null,
        jobReference: conv ? jobReferenceOf(conv) : null,
        // Company Teams (additive): who the lead's job is assigned to. Flag
        // OFF reports the legacy trader as assigned so UIs never render an
        // "unclaimed" state while teams are disabled.
        assignedTraderUserId: conv
          ? teamsOn
            ? conv.assignedTraderUserId
            : (conv.assignedTraderUserId ?? conv.traderUserId)
          : null,
        assignedTraderName:
          teamsOn && conv?.assignedTraderUserId != null
            ? (assignedNameById.get(conv.assignedTraderUserId) ?? null)
            : null,
        createdAt: e.createdAt.toISOString(),
      };
    });

    res.json({ enquiries: formatted, total: formatted.length });
  } catch (error) {
    req.log.error({ err: error }, "Get enquiries failed");
    res.status(500).json({ error: "Failed to get enquiries" });
  }
});

export default router;
