import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  conversationsTable,
  messagesTable,
  conversationReportsTable,
  usersTable,
  traderProfilesTable,
  enquiriesTable,
  reviewsTable,
  quotesTable,
  bookingsTable,
} from "@workspace/db/schema";
import { and, eq, desc, sql, inArray } from "drizzle-orm";
import { authMiddleware } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { sendNewMessageEmail } from "../lib/email";
import { sendPushToUser } from "../lib/push-notifications";
import { detectContactInfo, contactViolationMessage } from "../lib/content-filter";
import { recordContactBlockAttempt } from "../lib/contact-block-tracker";
import { ObjectStorageService } from "../lib/objectStorage";
import { jobReferenceOf } from "../lib/job-reference";
import { postSystemMessage } from "../lib/system-messages";
import { deriveStage } from "../lib/conversation-stage";
import { ensureHired } from "../lib/hire";
import { serializeQuote } from "../lib/quotes";
import { serializeBooking } from "../lib/bookings";
import { customerPhoneVerified, sendPhoneVerificationRequired } from "../lib/customer-phone-gate";

const router: IRouter = Router();
const storage = new ObjectStorageService();

const SendMessageBody = z.object({
  body: z.string().trim().min(1).max(4000),
});

const ReportBody = z.object({
  reason: z.string().trim().min(5).max(2000),
});

const CancelConversationBody = z.object({
  reason: z.string().trim().min(3).max(500),
});

const TraderStatusBody = z.object({
  traderStatus: z.enum(["NEW", "CONTACTED", "QUOTED", "COMPLETED"]),
});

const MuteBody = z.object({
  muted: z.boolean(),
  mutedUntil: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .optional(),
});

// A conversation is "effectively muted" for a given side when `mutedAt` is
// set AND either `mutedUntil` is null (indefinite) or still in the future.
function isMuted(
  mutedAt: Date | null,
  mutedUntil: Date | null,
  now: Date = new Date(),
): boolean {
  if (mutedAt == null) return false;
  if (mutedUntil == null) return true;
  return mutedUntil.getTime() > now.getTime();
}

type ConversationRow = typeof conversationsTable.$inferSelect;
type MessageRow = typeof messagesTable.$inferSelect;

function serializeConversation(
  c: ConversationRow,
  extras: {
    customerName?: string | null;
    customerId?: number;
    traderBusinessName?: string | null;
    traderVerified?: boolean;
    unreadCount: number;
    viewerRole: "customer" | "trader";
    hasReview?: boolean | null;
  },
) {
  const mutedAt =
    extras.viewerRole === "customer" ? c.customerMutedAt : c.traderMutedAt;
  const mutedUntil =
    extras.viewerRole === "customer"
      ? c.customerMutedUntil
      : c.traderMutedUntil;
  const muted = isMuted(mutedAt, mutedUntil);
  return {
    id: c.id,
    customerId: extras.customerId ?? c.customerId,
    customerName: extras.customerName ?? "Customer",
    traderProfileId: c.traderProfileId,
    traderBusinessName: extras.traderBusinessName ?? "",
    traderVerified: extras.traderVerified ?? false,
    enquiryId: c.enquiryId,
    serviceRequired: c.serviceRequired,
    postcode: c.postcode,
    status: c.status,
    traderStatus: c.traderStatus,
    stage: deriveStage(c),
    unreadCount: extras.unreadCount,
    muted,
    mutedUntil: muted && mutedUntil ? mutedUntil.toISOString() : null,
    lastMessageAt: c.lastMessageAt.toISOString(),
    lastMessagePreview: c.lastMessagePreview,
    closedAt: c.closedAt?.toISOString() ?? null,
    closedByRole: c.closedByRole,
    customerAcceptedAt: c.customerAcceptedAt?.toISOString() ?? null,
    customerCompletedAt: c.customerCompletedAt?.toISOString() ?? null,
    traderMarkedDoneAt: c.traderMarkedDoneAt?.toISOString() ?? null,
    cancelledAt: c.cancelledAt?.toISOString() ?? null,
    cancelledByRole: c.cancelledByRole,
    cancellationReason: c.cancellationReason,
    reviewUnlockedAt: c.reviewUnlockedAt?.toISOString() ?? null,
    jobReference: jobReferenceOf(c),
    hasReview: extras.hasReview ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

function serializeMessage(m: MessageRow) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderUserId: m.senderUserId,
    senderRole: m.senderRole,
    body: m.body,
    systemMessage: m.systemMessage,
    readAt: m.readAt?.toISOString() ?? null,
    editedAt: m.editedAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

async function getActorContext(userId: number, userRole: string) {
  if (userRole === "trader") {
    const [profile] = await db
      .select({ id: traderProfilesTable.id })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, userId))
      .limit(1);
    return { role: "trader" as const, traderProfileId: profile?.id ?? null };
  }
  return { role: userRole as "customer" | "admin", traderProfileId: null };
}

// GET /api/conversations/unread-count — total unread across my conversations
router.get("/conversations/unread-count", authMiddleware, async (req, res) => {
  try {
    const { userId, userRole } = req as AuthenticatedRequest;
    const actor = await getActorContext(userId, userRole);

    if (actor.role === "admin") {
      res.json({ unreadCount: 0 });
      return;
    }

    if (actor.role === "trader" && !actor.traderProfileId) {
      res.json({ unreadCount: 0 });
      return;
    }

    const column =
      actor.role === "customer"
        ? conversationsTable.customerUnreadCount
        : conversationsTable.traderUnreadCount;
    const where =
      actor.role === "customer"
        ? eq(conversationsTable.customerId, userId)
        : eq(conversationsTable.traderProfileId, actor.traderProfileId!);

    const [row] = await db
      .select({ total: sql<number>`COALESCE(SUM(${column}), 0)::int` })
      .from(conversationsTable)
      .where(where);

    res.json({ unreadCount: row?.total ?? 0 });
  } catch (error) {
    req.log.error({ err: error }, "Get unread count failed");
    res.status(500).json({ error: "Failed to get unread count" });
  }
});

// GET /api/conversations — list mine
router.get("/conversations", authMiddleware, async (req, res) => {
  try {
    const { userId, userRole } = req as AuthenticatedRequest;
    const actor = await getActorContext(userId, userRole);

    if (actor.role === "admin") {
      res.status(403).json({ error: "Admins use /api/admin/conversation-reports" });
      return;
    }

    if (actor.role === "trader" && !actor.traderProfileId) {
      res.json({ conversations: [], total: 0 });
      return;
    }

    const where =
      actor.role === "customer"
        ? eq(conversationsTable.customerId, userId)
        : eq(conversationsTable.traderProfileId, actor.traderProfileId!);

    const rows = await db
      .select({
        conv: conversationsTable,
        customerName: usersTable.fullName,
        traderBusinessName: traderProfilesTable.businessName,
        traderVerificationStatus: traderProfilesTable.verificationStatus,
      })
      .from(conversationsTable)
      .innerJoin(usersTable, eq(conversationsTable.customerId, usersTable.id))
      .innerJoin(traderProfilesTable, eq(conversationsTable.traderProfileId, traderProfilesTable.id))
      .where(where)
      .orderBy(desc(conversationsTable.lastMessageAt));

    const conversations = rows.map(({ conv, customerName, traderBusinessName, traderVerificationStatus }) =>
      serializeConversation(conv, {
        customerName,
        customerId: conv.customerId,
        traderBusinessName,
        traderVerified: traderVerificationStatus === "VERIFIED",
        unreadCount: actor.role === "customer" ? conv.customerUnreadCount : conv.traderUnreadCount,
        viewerRole: actor.role === "customer" ? "customer" : "trader",
      }),
    );

    res.json({ conversations, total: conversations.length });
  } catch (error) {
    req.log.error({ err: error }, "List conversations failed");
    res.status(500).json({ error: "Failed to list conversations" });
  }
});

// GET /api/conversations/:id — detail (also marks as read for the viewer)
router.get("/conversations/:id", authMiddleware, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid conversation id" });
      return;
    }
    const { userId, userRole } = req as AuthenticatedRequest;
    const actor = await getActorContext(userId, userRole);

    const [row] = await db
      .select({
        conv: conversationsTable,
        customerName: usersTable.fullName,
        customerPhone: usersTable.phone,
        customerEmail: usersTable.email,
        traderBusinessName: traderProfilesTable.businessName,
        traderVerificationStatus: traderProfilesTable.verificationStatus,
        traderContactName: traderProfilesTable.contactName,
        traderPhone: traderProfilesTable.phone,
        traderEmail: traderProfilesTable.email,
      })
      .from(conversationsTable)
      .innerJoin(usersTable, eq(conversationsTable.customerId, usersTable.id))
      .innerJoin(traderProfilesTable, eq(conversationsTable.traderProfileId, traderProfilesTable.id))
      .where(eq(conversationsTable.id, id))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const isCustomer = actor.role === "customer" && row.conv.customerId === userId;
    const isTrader = actor.role === "trader" && actor.traderProfileId === row.conv.traderProfileId;
    if (!isCustomer && !isTrader) {
      res.status(403).json({ error: "You do not have access to this conversation" });
      return;
    }

    const messages = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, id))
      .orderBy(messagesTable.createdAt);

    // Mark unread messages from the other side as read for the viewer.
    const otherRole = isCustomer ? "trader" : "customer";
    const unreadIds = messages
      .filter((m) => m.readAt == null && m.senderRole === otherRole)
      .map((m) => m.id);
    if (unreadIds.length > 0) {
      await db
        .update(messagesTable)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(messagesTable.conversationId, id),
            inArray(messagesTable.id, unreadIds),
          ),
        );
    }
    // Always clear the viewer's unread counter when they open the conversation,
    // not only when message rows needed flipping. If the counter ever drifts
    // out of sync with message read state (e.g. a stuck count with no matching
    // unread rows) gating the reset on unreadIds would leave the badge red
    // forever. Resetting whenever the counter is non-zero is idempotent and
    // self-heals any drift for both customers and traders.
    const viewerUnread = isCustomer
      ? row.conv.customerUnreadCount
      : row.conv.traderUnreadCount;
    if (viewerUnread > 0) {
      await db
        .update(conversationsTable)
        .set(isCustomer ? { customerUnreadCount: 0 } : { traderUnreadCount: 0 })
        .where(eq(conversationsTable.id, id));
    }

    // Phase 19: stamp the first time the trader opens this lead so the
    // dashboard "new leads" badge can clear. Once set, never overwritten —
    // later customer messages bump traderUnreadCount but don't make the lead
    // "new" again.
    if (isTrader && row.conv.traderViewedAt == null) {
      await db
        .update(conversationsTable)
        .set({ traderViewedAt: new Date() })
        .where(eq(conversationsTable.id, id));
    }

    // Whether the customer has already left a review for this job, so the
    // thread can show "Leave a review" vs "Review submitted".
    let hasReview = false;
    let enquiryAttachments: string[] = [];
    if (row.conv.enquiryId) {
      const [rev] = await db
        .select({ id: reviewsTable.id })
        .from(reviewsTable)
        .where(eq(reviewsTable.enquiryId, row.conv.enquiryId))
        .limit(1);
      hasReview = !!rev;

      // Surface the customer's original enquiry photos in the thread. They are
      // stored as private object paths on the enquiry; both parties to this
      // conversation are already authorised (checked above), so hand back
      // short-lived signed GET URLs they can render/open directly.
      const [enq] = await db
        .select({ attachmentUrls: enquiriesTable.attachmentUrls })
        .from(enquiriesTable)
        .where(eq(enquiriesTable.id, row.conv.enquiryId))
        .limit(1);
      const rawPaths = enq?.attachmentUrls ?? [];
      if (rawPaths.length > 0) {
        const signed = await Promise.all(
          rawPaths.map(async (p) => {
            try {
              return await storage.getObjectEntityReadURL(p, 900);
            } catch (signErr) {
              req.log.warn({ err: signErr, conversationId: id }, "Failed to sign enquiry attachment");
              return null;
            }
          }),
        );
        enquiryAttachments = signed.filter((u): u is string => u != null);
      }
    }

    // Structured quotes (newest first, including revision history). Both
    // parties are already authorised above.
    const quoteRows = await db
      .select()
      .from(quotesTable)
      .where(eq(quotesTable.conversationId, id))
      .orderBy(desc(quotesTable.createdAt));

    // Live appointment (PROPOSED or CONFIRMED), if any. Cancelled/superseded
    // bookings are history only — their story is told by system messages.
    const [liveBooking] = await db
      .select()
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.conversationId, id),
          inArray(bookingsTable.status, ["PROPOSED", "CONFIRMED"]),
        ),
      )
      .limit(1);

    // Contact reveal (Part 7): only after the customer accepted a quote /
    // hired the trader (backend hire state is the source of truth), and only
    // to the two participants of THIS conversation — both already verified
    // above. Before hire, no phone/email crosses the API boundary. The values
    // are read live from the owning records, so an admin-approved phone
    // change automatically reaches hired conversations and a pending value
    // never does.
    const hired = row.conv.customerAcceptedAt != null;
    const contactDetails = hired
      ? {
          trader: {
            name: row.traderContactName,
            businessName: row.traderBusinessName,
            phone: row.traderPhone || null,
            email: row.traderEmail || null,
          },
          customer: {
            name: row.customerName,
            phone: row.customerPhone || null,
            email: row.customerEmail || null,
          },
        }
      : null;

    res.json({
      conversation: serializeConversation(row.conv, {
        customerName: row.customerName,
        customerId: row.conv.customerId,
        traderBusinessName: row.traderBusinessName,
        traderVerified: row.traderVerificationStatus === "VERIFIED",
        unreadCount: 0,
        viewerRole: isCustomer ? "customer" : "trader",
        hasReview,
      }),
      messages: messages.map(serializeMessage),
      enquiryAttachments,
      quotes: quoteRows.map((q) => serializeQuote(q)),
      contactDetails,
      booking: liveBooking ? serializeBooking(liveBooking) : null,
    });
  } catch (error) {
    req.log.error({ err: error }, "Get conversation failed");
    res.status(500).json({ error: "Failed to get conversation" });
  }
});

// POST /api/conversations/:id/messages — send a message
router.post("/conversations/:id/messages", authMiddleware, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid conversation id" });
      return;
    }
    const body = SendMessageBody.parse(req.body);
    const { userId, userRole } = req as AuthenticatedRequest;
    const violation = detectContactInfo(body.body);
    const actor = await getActorContext(userId, userRole);

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id))
      .limit(1);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const isCustomer = actor.role === "customer" && conv.customerId === userId;
    const isTrader = actor.role === "trader" && actor.traderProfileId === conv.traderProfileId;
    if (!isCustomer && !isTrader) {
      res.status(403).json({ error: "You do not have access to this conversation" });
      return;
    }
    if (conv.status === "CLOSED" || conv.status === "BLOCKED") {
      res.status(409).json({ error: "This conversation is closed" });
      return;
    }

    // Account-level suspension (admin moderation): suspended users cannot
    // send messages. Checked after participant authorization so outsiders
    // learn nothing about the account state.
    const [sender] = await db
      .select({ suspendedAt: usersTable.suspendedAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (sender?.suspendedAt) {
      res.status(403).json({
        error: "Your account has been suspended. You cannot send messages.",
        code: "ACCOUNT_SUSPENDED",
      });
      return;
    }

    // Attempt logging happens AFTER existence + participant authorization, so
    // a non-participant cannot pollute the moderation queue by hitting random
    // conversation ids with blocked content.
    //
    // Contact-sharing is only blocked BEFORE hire (Part 9): once the customer
    // has accepted a quote / hired the trader, the two parties are allowed to
    // exchange contact details to coordinate the job.
    const hired = conv.customerAcceptedAt != null;
    if (violation && !hired) {
      void recordContactBlockAttempt({
        userId,
        conversationId: id,
        violationKind: violation,
        source: "conversation_message",
        snippet: body.body,
      });
      res.status(400).json({
        error: contactViolationMessage(violation),
        code: "CONTACT_INFO_BLOCKED",
        violation,
      });
      return;
    }

    const senderRole = isCustomer ? "customer" : "trader";
    const preview = body.body.slice(0, 200);
    const newStatus = isCustomer ? "AWAITING_TRADER_REPLY" : "AWAITING_CUSTOMER_REPLY";

    // Atomic: insert the message AND advance conversation counters/status
    // together, so a partial failure can never leave a stored message with
    // stale unread counters or status.
    const created = await db.transaction(async (tx) => {
      const [msg] = await tx
        .insert(messagesTable)
        .values({
          conversationId: id,
          senderUserId: userId,
          senderRole,
          body: body.body,
        })
        .returning();
      await tx
        .update(conversationsTable)
        .set({
          lastMessageAt: new Date(),
          lastMessagePreview: preview,
          status: conv.status === "REPORTED" ? "REPORTED" : newStatus,
          customerUnreadCount: isCustomer
            ? conv.customerUnreadCount
            : sql`${conversationsTable.customerUnreadCount} + 1`,
          traderUnreadCount: isTrader
            ? conv.traderUnreadCount
            : sql`${conversationsTable.traderUnreadCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(conversationsTable.id, id));
      return msg;
    });

    // Fire-and-forget email to the other party.
    void (async () => {
      try {
        const recipientUserId = isCustomer ? conv.traderUserId : conv.customerId;
        const [recipient] = await db
          .select({ email: usersTable.email, fullName: usersTable.fullName })
          .from(usersTable)
          .where(eq(usersTable.id, recipientUserId))
          .limit(1);
        const [sender] = await db
          .select({ fullName: usersTable.fullName })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1);
        let senderName = sender?.fullName ?? (isCustomer ? "A customer" : "A trader");
        if (isTrader) {
          const [tp] = await db
            .select({ businessName: traderProfilesTable.businessName })
            .from(traderProfilesTable)
            .where(eq(traderProfilesTable.id, conv.traderProfileId))
            .limit(1);
          senderName = tp?.businessName ?? senderName;
        }
        if (recipient?.email) {
          await sendNewMessageEmail({
            toEmail: recipient.email,
            toName: recipient.fullName ?? "there",
            senderName,
            senderRole,
            preview,
            conversationId: id,
            serviceRequired: conv.serviceRequired ?? null,
          });
        }
        // Recipient mute check honours per-side timed mutes. If a timed mute
        // has expired by the time we fan out, opportunistically clear the
        // stored timestamps so the "Muted" UI indicator flips off on the
        // recipient's next conversation refresh.
        const now = new Date();
        const recipientMutedAt = isCustomer ? conv.traderMutedAt : conv.customerMutedAt;
        const recipientMutedUntil = isCustomer ? conv.traderMutedUntil : conv.customerMutedUntil;
        const recipientMuted = isMuted(recipientMutedAt, recipientMutedUntil, now);
        if (
          recipientMutedAt != null &&
          recipientMutedUntil != null &&
          recipientMutedUntil.getTime() <= now.getTime()
        ) {
          await db
            .update(conversationsTable)
            .set(
              isCustomer
                ? { traderMutedAt: null, traderMutedUntil: null }
                : { customerMutedAt: null, customerMutedUntil: null },
            )
            .where(eq(conversationsTable.id, id));
        }
        if (!recipientMuted) {
          try {
            await sendPushToUser(recipientUserId, {
              title: senderName,
              body: preview,
              data: {
                type: "new_message",
                conversationId: id,
                messageId: created.id,
              },
            });
          } catch (pushErr) {
            req.log.warn({ err: pushErr, conversationId: id }, "Failed to send new-message push");
          }
        }
      } catch (notifyErr) {
        req.log.warn({ err: notifyErr, conversationId: id }, "Failed to send new-message email");
      }
    })();

    res.status(201).json(serializeMessage(created));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid message", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Send message failed");
    res.status(500).json({ error: "Failed to send message" });
  }
});

// POST /api/conversations/:id/close
router.post("/conversations/:id/close", authMiddleware, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid conversation id" });
      return;
    }
    const { userId, userRole } = req as AuthenticatedRequest;
    const actor = await getActorContext(userId, userRole);

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id))
      .limit(1);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const isCustomer = actor.role === "customer" && conv.customerId === userId;
    const isTrader = actor.role === "trader" && actor.traderProfileId === conv.traderProfileId;
    if (!isCustomer && !isTrader) {
      res.status(403).json({ error: "You do not have access to this conversation" });
      return;
    }

    await db
      .update(conversationsTable)
      .set({
        status: "CLOSED",
        closedAt: new Date(),
        closedByRole: isCustomer ? "customer" : "trader",
        updatedAt: new Date(),
      })
      .where(eq(conversationsTable.id, id));

    res.json({ ok: true });
  } catch (error) {
    req.log.error({ err: error }, "Close conversation failed");
    res.status(500).json({ error: "Failed to close conversation" });
  }
});

// PATCH /api/conversations/:id/trader-status — trader only
router.patch("/conversations/:id/trader-status", authMiddleware, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid conversation id" });
      return;
    }
    const body = TraderStatusBody.parse(req.body);
    const { userId, userRole } = req as AuthenticatedRequest;
    if (userRole !== "trader") {
      res.status(403).json({ error: "Only traders can update trader status" });
      return;
    }
    const actor = await getActorContext(userId, userRole);
    if (!actor.traderProfileId) {
      res.status(403).json({ error: "Trader profile not found" });
      return;
    }

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id))
      .limit(1);
    if (!conv || conv.traderProfileId !== actor.traderProfileId) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    await db
      .update(conversationsTable)
      .set({ traderStatus: body.traderStatus, updatedAt: new Date() })
      .where(eq(conversationsTable.id, id));

    // Any trader engagement (CONTACTED/QUOTED/COMPLETED) advances the linked
    // enquiry past "pending" so the existing review-eligibility logic — which
    // gates on enquiry.status !== "pending" — unlocks for the customer.
    if (body.traderStatus !== "NEW" && conv.enquiryId) {
      await db
        .update(enquiriesTable)
        .set({ status: "responded" })
        .where(and(eq(enquiriesTable.id, conv.enquiryId), eq(enquiriesTable.status, "pending")));
    }

    res.json({ ok: true, traderStatus: body.traderStatus });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid status", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Update trader status failed");
    res.status(500).json({ error: "Failed to update trader status" });
  }
});

// POST /api/conversations/:id/accept — customer accepts the trader's offer
router.post("/conversations/:id/accept", authMiddleware, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid conversation id" });
      return;
    }
    const { userId, userRole } = req as AuthenticatedRequest;
    const actor = await getActorContext(userId, userRole);

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id))
      .limit(1);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    if (!(actor.role === "customer" && conv.customerId === userId)) {
      res.status(403).json({ error: "Only the customer can accept the offer" });
      return;
    }
    if (conv.status === "CLOSED" || conv.status === "BLOCKED") {
      res.status(409).json({ error: "This conversation is closed." });
      return;
    }
    if (conv.cancelledAt) {
      res.status(409).json({ error: "This job has been cancelled." });
      return;
    }
    if (conv.customerCompletedAt) {
      res.status(409).json({ error: "This job has already been completed." });
      return;
    }

    // There must actually BE an offer to accept: the trader has to have
    // engaged with the enquiry — either by replying in the conversation or by
    // sending a structured quote. Without this, a customer could "hire" a
    // trader who has never responded (phantom offer).
    const [traderReply] = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.conversationId, id),
          eq(messagesTable.senderRole, "trader"),
        ),
      )
      .limit(1);
    if (!traderReply) {
      const [anyQuote] = await db
        .select({ id: quotesTable.id })
        .from(quotesTable)
        .where(eq(quotesTable.conversationId, id))
        .limit(1);
      if (!anyQuote) {
        res.status(409).json({
          error:
            "The trader hasn't replied or sent a quote yet, so there is no offer to accept.",
          code: "NO_OFFER_YET",
        });
        return;
      }
    }

    // Contact gate: accepting an offer (hiring) requires an SMS-verified
    // mobile, same as sending an enquiry or accepting a structured quote.
    if (!(await customerPhoneVerified(userId))) {
      sendPhoneVerificationRequired(res);
      return;
    }

    // Race-safe, idempotent hire shared with structured-quote acceptance.
    await ensureHired(id);

    res.json({ ok: true });
  } catch (error) {
    req.log.error({ err: error }, "Accept offer failed");
    res.status(500).json({ error: "Failed to accept offer" });
  }
});

// POST /api/conversations/:id/complete — customer marks the job complete
router.post("/conversations/:id/complete", authMiddleware, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid conversation id" });
      return;
    }
    const { userId, userRole } = req as AuthenticatedRequest;
    const actor = await getActorContext(userId, userRole);

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id))
      .limit(1);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    if (!(actor.role === "customer" && conv.customerId === userId)) {
      res.status(403).json({ error: "Only the customer can complete the job" });
      return;
    }
    if (conv.status === "CLOSED" || conv.status === "BLOCKED") {
      res.status(409).json({ error: "This conversation is closed." });
      return;
    }
    if (conv.cancelledAt) {
      res.status(409).json({ error: "This job has been cancelled and cannot be completed." });
      return;
    }
    if (!conv.customerAcceptedAt) {
      res.status(409).json({ error: "Accept the offer before confirming the job is done." });
      return;
    }

    if (!conv.customerCompletedAt) {
      const now = new Date();
      // customerCompletedAt = customer confirmed done; reviewUnlockedAt records
      // the single moment review submission becomes eligible. The trader marking
      // work done never reaches this branch — only the customer can.
      await db
        .update(conversationsTable)
        .set({
          customerCompletedAt: now,
          reviewUnlockedAt: now,
          traderStatus: "COMPLETED",
          updatedAt: now,
        })
        .where(eq(conversationsTable.id, id));
      // Keep the linked enquiry past "pending" so review eligibility holds.
      if (conv.enquiryId) {
        await db
          .update(enquiriesTable)
          .set({ status: "responded" })
          .where(and(eq(enquiriesTable.id, conv.enquiryId), eq(enquiriesTable.status, "pending")));
      }
      await postSystemMessage(
        id,
        "The customer confirmed the job is done. You can now be reviewed.",
      );
    }

    res.json({ ok: true });
  } catch (error) {
    req.log.error({ err: error }, "Complete job failed");
    res.status(500).json({ error: "Failed to complete job" });
  }
});

// POST /api/conversations/:id/trader-mark-done — trader signals the work is
// finished. This ONLY notifies the customer to confirm or report a problem; it
// never finalises the job or unlocks the review (that requires customer
// confirmation via /complete).
router.post("/conversations/:id/trader-mark-done", authMiddleware, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid conversation id" });
      return;
    }
    const { userId, userRole } = req as AuthenticatedRequest;
    const actor = await getActorContext(userId, userRole);

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id))
      .limit(1);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    if (!(actor.role === "trader" && actor.traderProfileId === conv.traderProfileId)) {
      res.status(403).json({ error: "Only the assigned trader can mark the work as done" });
      return;
    }
    if (conv.status === "CLOSED" || conv.status === "BLOCKED") {
      res.status(409).json({ error: "This conversation is closed." });
      return;
    }
    if (conv.cancelledAt) {
      res.status(409).json({ error: "This job has been cancelled." });
      return;
    }
    if (!conv.customerAcceptedAt) {
      res.status(409).json({ error: "The customer must hire you before you can mark the work done." });
      return;
    }
    if (conv.customerCompletedAt) {
      res.status(409).json({ error: "The customer has already confirmed this job is done." });
      return;
    }

    if (!conv.traderMarkedDoneAt) {
      const now = new Date();
      await db
        .update(conversationsTable)
        .set({ traderMarkedDoneAt: now, updatedAt: now })
        .where(eq(conversationsTable.id, id));
      await postSystemMessage(
        id,
        "The trader marked the work as completed. Please confirm the job is done to leave a review, or reply here if there's a problem.",
        "customer",
      );
    }

    res.json({ ok: true });
  } catch (error) {
    req.log.error({ err: error }, "Trader mark done failed");
    res.status(500).json({ error: "Failed to mark the work as done" });
  }
});

// POST /api/conversations/:id/cancel — either party cancels the job before it is
// completed. A short reason is required. Cancelled jobs are never review-eligible
// and the conversation is closed to further messaging. Full audit trail recorded
// (cancelledAt, cancelledByRole, cancellationReason).
router.post("/conversations/:id/cancel", authMiddleware, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid conversation id" });
      return;
    }
    const body = CancelConversationBody.parse(req.body);
    const { userId, userRole } = req as AuthenticatedRequest;
    const actor = await getActorContext(userId, userRole);

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id))
      .limit(1);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const isCustomer = actor.role === "customer" && conv.customerId === userId;
    const isTrader = actor.role === "trader" && actor.traderProfileId === conv.traderProfileId;
    if (!isCustomer && !isTrader) {
      res.status(403).json({ error: "You do not have access to this conversation" });
      return;
    }
    if (conv.cancelledAt) {
      res.status(409).json({ error: "This job has already been cancelled." });
      return;
    }
    if (conv.customerCompletedAt) {
      res.status(409).json({ error: "A completed job cannot be cancelled." });
      return;
    }
    if (conv.status === "CLOSED" || conv.status === "BLOCKED") {
      res.status(409).json({ error: "This conversation is already closed." });
      return;
    }

    const now = new Date();
    const cancelledByRole = isCustomer ? "customer" : "trader";
    await db
      .update(conversationsTable)
      .set({
        cancelledAt: now,
        cancelledByRole,
        cancellationReason: body.reason,
        status: "CLOSED",
        closedAt: now,
        closedByRole: cancelledByRole,
        updatedAt: now,
      })
      .where(eq(conversationsTable.id, id));
    await postSystemMessage(
      id,
      `The ${cancelledByRole} cancelled this job. Reason: ${body.reason}`,
      // Notify only the other party — the canceller already knows.
      isCustomer ? "trader" : "customer",
    );

    res.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "A short reason is required to cancel.", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Cancel job failed");
    res.status(500).json({ error: "Failed to cancel the job" });
  }
});

// PATCH /api/conversations/:id/mute — toggle per-user push mute
router.patch("/conversations/:id/mute", authMiddleware, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid conversation id" });
      return;
    }
    const body = MuteBody.parse(req.body);
    const { userId, userRole } = req as AuthenticatedRequest;
    const actor = await getActorContext(userId, userRole);

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id))
      .limit(1);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const isCustomer = actor.role === "customer" && conv.customerId === userId;
    const isTrader = actor.role === "trader" && actor.traderProfileId === conv.traderProfileId;
    if (!isCustomer && !isTrader) {
      res.status(403).json({ error: "You do not have access to this conversation" });
      return;
    }

    const now = new Date();
    const at = body.muted ? now : null;
    // mutedUntil is only meaningful when muting; clamp invalid (past) values
    // to null so we never store an "already-expired" timed mute.
    let until: Date | null = null;
    if (body.muted && body.mutedUntil) {
      const parsed = new Date(body.mutedUntil);
      if (Number.isFinite(parsed.getTime()) && parsed.getTime() > now.getTime()) {
        until = parsed;
      }
    }
    await db
      .update(conversationsTable)
      .set({
        ...(isCustomer
          ? { customerMutedAt: at, customerMutedUntil: until }
          : { traderMutedAt: at, traderMutedUntil: until }),
        updatedAt: now,
      })
      .where(eq(conversationsTable.id, id));

    res.json({
      ok: true,
      muted: body.muted,
      mutedUntil: until ? until.toISOString() : null,
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid mute request", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Mute conversation failed");
    res.status(500).json({ error: "Failed to update mute setting" });
  }
});

// POST /api/conversations/:id/report
router.post("/conversations/:id/report", authMiddleware, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid conversation id" });
      return;
    }
    const body = ReportBody.parse(req.body);
    const { userId, userRole } = req as AuthenticatedRequest;
    const actor = await getActorContext(userId, userRole);

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id))
      .limit(1);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const isCustomer = actor.role === "customer" && conv.customerId === userId;
    const isTrader = actor.role === "trader" && actor.traderProfileId === conv.traderProfileId;
    if (!isCustomer && !isTrader) {
      res.status(403).json({ error: "You do not have access to this conversation" });
      return;
    }

    await db.insert(conversationReportsTable).values({
      conversationId: id,
      reportedByUserId: userId,
      reportedByRole: isCustomer ? "customer" : "trader",
      reason: body.reason,
      status: "OPEN",
    });

    await db
      .update(conversationsTable)
      .set({ status: "REPORTED", updatedAt: new Date() })
      .where(eq(conversationsTable.id, id));

    res.status(201).json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid report", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Report conversation failed");
    res.status(500).json({ error: "Failed to report conversation" });
  }
});

export default router;
