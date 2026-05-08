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
} from "@workspace/db/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { authMiddleware } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { sendNewMessageEmail } from "../lib/email";
import { sendPushToUser } from "../lib/push-notifications";
import { detectContactInfo, contactViolationMessage } from "../lib/content-filter";
import { recordContactBlockAttempt } from "../lib/contact-block-tracker";

const router: IRouter = Router();

const SendMessageBody = z.object({
  body: z.string().trim().min(1).max(4000),
});

const ReportBody = z.object({
  reason: z.string().trim().min(5).max(2000),
});

const TraderStatusBody = z.object({
  traderStatus: z.enum(["NEW", "CONTACTED", "QUOTED", "COMPLETED"]),
});

const MuteBody = z.object({
  muted: z.boolean(),
});

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
  },
) {
  const muted =
    extras.viewerRole === "customer"
      ? c.customerMutedAt != null
      : c.traderMutedAt != null;
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
    unreadCount: extras.unreadCount,
    muted,
    lastMessageAt: c.lastMessageAt.toISOString(),
    lastMessagePreview: c.lastMessagePreview,
    closedAt: c.closedAt?.toISOString() ?? null,
    closedByRole: c.closedByRole,
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
        traderBusinessName: traderProfilesTable.businessName,
        traderVerificationStatus: traderProfilesTable.verificationStatus,
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
            sql`${messagesTable.id} = ANY(${unreadIds})`,
          ),
        );
      await db
        .update(conversationsTable)
        .set(isCustomer ? { customerUnreadCount: 0 } : { traderUnreadCount: 0 })
        .where(eq(conversationsTable.id, id));
    }

    res.json({
      conversation: serializeConversation(row.conv, {
        customerName: row.customerName,
        customerId: row.conv.customerId,
        traderBusinessName: row.traderBusinessName,
        traderVerified: row.traderVerificationStatus === "VERIFIED",
        unreadCount: 0,
        viewerRole: isCustomer ? "customer" : "trader",
      }),
      messages: messages.map(serializeMessage),
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

    // Attempt logging happens AFTER existence + participant authorization, so
    // a non-participant cannot pollute the moderation queue by hitting random
    // conversation ids with blocked content.
    if (violation) {
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
          });
        }
        const recipientMuted = isCustomer
          ? conv.traderMutedAt != null
          : conv.customerMutedAt != null;
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

    const at = body.muted ? new Date() : null;
    await db
      .update(conversationsTable)
      .set({
        ...(isCustomer ? { customerMutedAt: at } : { traderMutedAt: at }),
        updatedAt: new Date(),
      })
      .where(eq(conversationsTable.id, id));

    res.json({ ok: true, muted: body.muted });
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
