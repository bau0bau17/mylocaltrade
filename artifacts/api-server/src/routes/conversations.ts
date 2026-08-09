import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  getActiveMembership,
  companyTeamsEnabled,
  traderSideRecipientUserIds,
  activeCompanyMemberUserIds,
} from "../lib/company-membership";
import {
  claimOrRequireAssigned,
  canActOnJob,
  JobClaimedByOtherError,
  jobClaimedByOtherBody,
  logJobClaimed,
  requireAssignedInTx,
  reassignJobTx,
  ReassignmentError,
  logJobReassigned,
  jobIsActive,
} from "../lib/job-assignment";
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
import { and, eq, desc, sql, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

// Second reference to users for joining the TRADER user on a conversation
// (the primary usersTable join is the customer).
const traderUsers = alias(usersTable, "trader_users");
const assignedUsers = alias(usersTable, "assigned_users");
import { authMiddleware } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import {
  sendNewMessageEmail,
  sendWorkMarkedCompleteEmail,
  sendReviewInviteEmail,
} from "../lib/email";
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

const ReassignConversationBody = z.object({
  toUserId: z.number().int().positive(),
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
    // Personal profile photo of the trader user handling this conversation.
    // Only supplied by the DETAIL route (list responses leave it null) so the
    // chat header can show the individual person alongside the business name.
    traderAvatarUrl?: string | null;
    traderVerified?: boolean;
    unreadCount: number;
    viewerRole: "customer" | "trader";
    hasReview?: boolean | null;
    // Company Teams (Phase 2) — all additive, flag-aware:
    // company logo for the pre-claim customer header (flag ON only).
    traderLogoUrl?: string | null;
    // Full name of the assigned member for headers/banners (flag ON only).
    assignedTraderName?: string | null;
    // Whether the TRADER viewer may act on this job (claimed by them or still
    // unclaimed). Customers always get null. Flag OFF → always true.
    viewerCanAct?: boolean | null;
    // Phase 3: whether the viewer may REASSIGN this job — owner only, flag ON,
    // live job with a current assignee. Customers get null; flag OFF → false.
    viewerCanReassign?: boolean | null;
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
    traderAvatarUrl: extras.traderAvatarUrl ?? null,
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
    // Flag OFF reports the legacy single trader as assigned (mirroring keeps
    // assignedTraderUserId = traderUserId, but coalesce defensively for rows
    // created between boots) so older payload consumers see no behaviour
    // change and newer UIs never show an "unclaimed" state while teams are
    // disabled.
    assignedTraderUserId: companyTeamsEnabled()
      ? c.assignedTraderUserId
      : (c.assignedTraderUserId ?? c.traderUserId),
    assignedTraderName: extras.assignedTraderName ?? null,
    traderLogoUrl: extras.traderLogoUrl ?? null,
    viewerCanAct:
      extras.viewerRole === "trader" ? (extras.viewerCanAct ?? true) : null,
    viewerCanReassign:
      extras.viewerRole === "trader" ? (extras.viewerCanReassign ?? false) : null,
    createdAt: c.createdAt.toISOString(),
  };
}

// viewerCanAct for a trader-side viewer: with teams enabled, a claimed job is
// actionable only by its assignee; unclaimed jobs are actionable (acting will
// claim them). Flag OFF is always true — legacy behaviour.
function traderViewerCanAct(c: ConversationRow, viewerUserId: number): boolean {
  if (!companyTeamsEnabled()) return true;
  return (
    c.assignedTraderUserId == null || c.assignedTraderUserId === viewerUserId
  );
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
    // Company Teams: resolve the profile the caller ACTS FOR (owner or, with
    // the flag on, an active member) — not merely the profile they own.
    const membership = await getActiveMembership(userId);
    return {
      role: "trader" as const,
      traderProfileId: membership?.traderProfileId ?? null,
      membershipRole: membership?.role ?? null,
    };
  }
  return {
    role: userRole as "customer" | "admin",
    traderProfileId: null,
    membershipRole: null,
  };
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
        assignedTraderName: assignedUsers.fullName,
      })
      .from(conversationsTable)
      .innerJoin(usersTable, eq(conversationsTable.customerId, usersTable.id))
      .innerJoin(traderProfilesTable, eq(conversationsTable.traderProfileId, traderProfilesTable.id))
      .leftJoin(assignedUsers, eq(conversationsTable.assignedTraderUserId, assignedUsers.id))
      .where(where)
      .orderBy(desc(conversationsTable.lastMessageAt));

    const teamsOn = companyTeamsEnabled();
    const conversations = rows.map(({ conv, customerName, traderBusinessName, traderVerificationStatus, assignedTraderName }) =>
      serializeConversation(conv, {
        customerName,
        customerId: conv.customerId,
        traderBusinessName,
        traderVerified: traderVerificationStatus === "VERIFIED",
        unreadCount: actor.role === "customer" ? conv.customerUnreadCount : conv.traderUnreadCount,
        viewerRole: actor.role === "customer" ? "customer" : "trader",
        assignedTraderName: teamsOn ? assignedTraderName : null,
        viewerCanAct:
          actor.role === "trader" ? traderViewerCanAct(conv, userId) : null,
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
        traderAvatarUrl: traderUsers.avatarUrl,
      })
      .from(conversationsTable)
      .innerJoin(usersTable, eq(conversationsTable.customerId, usersTable.id))
      .innerJoin(traderProfilesTable, eq(conversationsTable.traderProfileId, traderProfilesTable.id))
      .leftJoin(traderUsers, eq(conversationsTable.traderUserId, traderUsers.id))
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

    // Company Teams identity (Phase 2, all additive): with the flag ON the
    // customer-facing person is the ASSIGNED member — before a claim the
    // header shows the company identity (business name + logo) and no
    // personal photo. Flag OFF the payload is bit-identical to legacy.
    let assignedTraderName: string | null = null;
    let assignedAvatarUrl: string | null = null;
    let traderLogoUrl: string | null = null;
    if (companyTeamsEnabled()) {
      const [tpIdentity] = await db
        .select({ logoUrl: traderProfilesTable.logoUrl })
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.id, row.conv.traderProfileId))
        .limit(1);
      traderLogoUrl = tpIdentity?.logoUrl ?? null;
      if (row.conv.assignedTraderUserId != null) {
        const [assigned] = await db
          .select({ fullName: usersTable.fullName, avatarUrl: usersTable.avatarUrl })
          .from(usersTable)
          .where(eq(usersTable.id, row.conv.assignedTraderUserId))
          .limit(1);
        assignedTraderName = assigned?.fullName ?? null;
        assignedAvatarUrl = assigned?.avatarUrl ?? null;
      }
    }

    res.json({
      conversation: serializeConversation(row.conv, {
        customerName: row.customerName,
        customerId: row.conv.customerId,
        traderBusinessName: row.traderBusinessName,
        traderAvatarUrl: companyTeamsEnabled()
          ? assignedAvatarUrl
          : row.traderAvatarUrl,
        traderVerified: row.traderVerificationStatus === "VERIFIED",
        unreadCount: 0,
        viewerRole: isCustomer ? "customer" : "trader",
        hasReview,
        assignedTraderName,
        traderLogoUrl,
        viewerCanAct: isTrader ? traderViewerCanAct(row.conv, userId) : null,
        // Owner-only reassignment control (Phase 3): live job, has a current
        // assignee, viewer is the company OWNER, flag ON. The serializer
        // forces false/null for everyone else.
        viewerCanReassign:
          isTrader &&
          companyTeamsEnabled() &&
          actor.membershipRole === "OWNER" &&
          row.conv.assignedTraderUserId != null &&
          jobIsActive(row.conv),
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
    let claimedNow = false;
    const created = await db.transaction(async (tx) => {
      // Company job claiming (Phase 2): the FIRST trader-side reply claims
      // the job for this member; on an already-claimed job only the assignee
      // may send. Runs INSIDE the message transaction and BEFORE the insert,
      // so a losing racer's message rolls back and never reaches the
      // customer. Customer sends and system messages never claim.
      if (isTrader) {
        claimedNow = (await claimOrRequireAssigned(tx, conv, userId)).claimedNow;
      }
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

    // Audit the claim AFTER the transaction committed (fire-and-forget — an
    // audit hiccup must never fail a delivered message).
    if (claimedNow) {
      void logJobClaimed({ conv, actorUserId: userId, via: "message" });
    }

    // Fire-and-forget email + push to the other side. Customer→trader
    // notifications fan out per Company Teams routing (assigned member +
    // owner once claimed; every active member while unclaimed; exactly the
    // legacy single trader with the flag OFF).
    void (async () => {
      try {
        const recipientUserIds = isCustomer
          ? await traderSideRecipientUserIds(conv)
          : [conv.customerId];
        const recipients = await db
          .select({ id: usersTable.id, email: usersTable.email, fullName: usersTable.fullName })
          .from(usersTable)
          .where(inArray(usersTable.id, recipientUserIds));
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
        // Email is best-effort and must NEVER block the push below — a Brevo
        // outage or a bad address previously aborted the whole notify block,
        // which is exactly how traders "stopped getting" message pushes.
        for (const recipient of recipients) {
          if (!recipient.email) continue;
          try {
            await sendNewMessageEmail({
              toEmail: recipient.email,
              toName: recipient.fullName ?? "there",
              senderName,
              senderRole,
              preview,
              conversationId: id,
              serviceRequired: conv.serviceRequired ?? null,
            });
          } catch (emailErr) {
            req.log.warn({ err: emailErr, conversationId: id }, "Failed to send new-message email");
          }
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
        // The mute is per conversation-SIDE, so it applies to every
        // trader-side recipient alike.
        if (!recipientMuted) {
          for (const recipient of recipients) {
            try {
              await sendPushToUser(recipient.id, {
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
    if (error instanceof JobClaimedByOtherError) {
      res.status(409).json(jobClaimedByOtherBody(error.assignedName));
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
    // Company Teams: a job claimed by a colleague is read-only for everyone
    // else on the trader side (owner included, until Phase 3 reassignment).
    if (isTrader) {
      const act = await canActOnJob(conv, userId);
      if (!act.ok) {
        res.status(409).json(jobClaimedByOtherBody(act.assignedName));
        return;
      }
    }

    await db.transaction(async (tx) => {
      // Re-verify assignment under the row lock — a reassignment may have
      // committed since the canActOnJob pre-check above.
      if (isTrader) await requireAssignedInTx(tx, id, userId);
      await tx
        .update(conversationsTable)
        .set({
          status: "CLOSED",
          closedAt: new Date(),
          closedByRole: isCustomer ? "customer" : "trader",
          updatedAt: new Date(),
        })
        .where(eq(conversationsTable.id, id));
    });

    res.json({ ok: true });
  } catch (error) {
    if (error instanceof JobClaimedByOtherError) {
      res.status(409).json(jobClaimedByOtherBody(error.assignedName));
      return;
    }
    req.log.error({ err: error }, "Close conversation failed");
    res.status(500).json({ error: "Failed to close conversation" });
  }
});

// POST /api/conversations/:id/reassign — Company Teams Phase 3. OWNER only,
// flag ON only (fails closed as 404 when off). Moves a LIVE job to another
// ACTIVE member of the same company (or back to the owner). Everything the
// customer already has — messages, quotes, hire state, appointments, history,
// review eligibility — is untouched; only the assignee (and assignedAt)
// changes. The customer sees ONE system message and gets one notification.
router.post("/conversations/:id/reassign", authMiddleware, async (req, res) => {
  try {
    if (!companyTeamsEnabled()) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid conversation id" });
      return;
    }
    const body = ReassignConversationBody.parse(req.body);
    const { userId, userRole } = req as AuthenticatedRequest;
    if (userRole !== "trader") {
      res.status(403).json({ error: "Only the business owner can reassign jobs.", code: "OWNER_ONLY" });
      return;
    }
    const membership = await getActiveMembership(userId);
    if (!membership || membership.role !== "OWNER") {
      // Employees (and traders with no active membership) can never reassign.
      res.status(403).json({ error: "Only the business owner can reassign jobs.", code: "OWNER_ONLY" });
      return;
    }
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id))
      .limit(1);
    // Same-404 policy as the other conversation routes: unknown ids and other
    // companies' jobs are indistinguishable.
    if (!conv || conv.traderProfileId !== membership.traderProfileId) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    if (!jobIsActive(conv)) {
      res.status(409).json({ error: "Only active jobs can be reassigned.", code: "JOB_NOT_ACTIVE" });
      return;
    }
    // Target must be an ACTIVE member of THIS company (owner included).
    // Pending invitees, removed members, other companies' staff and arbitrary
    // user ids all fail this one membership check.
    const memberIds = await activeCompanyMemberUserIds(conv.traderProfileId);
    if (!memberIds.includes(body.toUserId)) {
      res.status(400).json({ error: "Choose an active member of your team.", code: "INVALID_ASSIGNEE" });
      return;
    }

    // Atomic flip under the conversation row lock; stage + current assignee
    // are re-checked inside. Throws ReassignmentError on ALREADY_ASSIGNED
    // (also the idempotent answer for retries/double-taps) or JOB_NOT_ACTIVE.
    const { prevAssignedUserId } = await reassignJobTx({
      conversationId: id,
      toUserId: body.toUserId,
    });

    // ---- Side effects: only the committed winner ever reaches here ----
    const [tp] = await db
      .select({ businessName: traderProfilesTable.businessName })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.id, conv.traderProfileId))
      .limit(1);
    const businessName = tp?.businessName ?? "the company";
    const [assignee] = await db
      .select({ fullName: usersTable.fullName })
      .from(usersTable)
      .where(eq(usersTable.id, body.toUserId))
      .limit(1);
    const assigneeName = assignee?.fullName ?? "A team member";
    const assigneeFirstName = assigneeName.trim().split(/\s+/)[0];

    // Exactly ONE customer-visible system message (no roles, no internal ids).
    await postSystemMessage(
      id,
      `Your job is now being handled by ${assigneeFirstName} from ${businessName}.`,
      "customer",
    );

    const ref = jobReferenceOf(conv);
    void (async () => {
      // Customer: one notification.
      await sendPushToUser(conv.customerId, {
        title: "Your job has a new contact",
        body: `${assigneeFirstName} from ${businessName} is now handling your job.`,
        data: { type: "job_reassigned", conversationId: id },
      }).catch((err) => req.log.warn({ err }, "Reassign push failed"));
      // New assignee — skip when the owner reassigned to themselves.
      if (body.toUserId !== userId) {
        await sendPushToUser(body.toUserId, {
          title: "Job assigned to you",
          body: `You're now handling ${ref ? `job ${ref}` : "a job"}${conv.serviceRequired ? ` — ${conv.serviceRequired}` : ""}.`,
          data: { type: "job_reassigned", conversationId: id },
        }).catch((err) => req.log.warn({ err }, "Reassign push failed"));
      }
      // Previous assignee: internal heads-up, only while still an active
      // member and never when they are the actor or the new assignee.
      if (
        prevAssignedUserId != null &&
        prevAssignedUserId !== body.toUserId &&
        prevAssignedUserId !== userId &&
        memberIds.includes(prevAssignedUserId)
      ) {
        await sendPushToUser(prevAssignedUserId, {
          title: "Job reassigned",
          body: `${ref ? `Job ${ref}` : "A job"} is now being handled by ${assigneeName}.`,
          data: { type: "job_reassigned", conversationId: id },
        }).catch((err) => req.log.warn({ err }, "Reassign push failed"));
      }
    })();

    void logJobReassigned({
      conv,
      actorUserId: userId,
      fromUserId: prevAssignedUserId,
      toUserId: body.toUserId,
    }).catch((err) => req.log.warn({ err }, "Reassign audit failed"));

    res.json({ ok: true, assignedTraderUserId: body.toUserId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid reassignment request", details: error.issues });
      return;
    }
    if (error instanceof ReassignmentError) {
      if (error.code === "ALREADY_ASSIGNED") {
        res.status(409).json({
          error: "This job is already assigned to that team member.",
          code: "ALREADY_ASSIGNED",
        });
      } else if (error.code === "INVALID_ASSIGNEE") {
        // The target's membership was revoked between the route's pre-check
        // and the transaction's locked re-check.
        res.status(400).json({ error: "Choose an active member of your team.", code: "INVALID_ASSIGNEE" });
      } else {
        res.status(409).json({ error: "Only active jobs can be reassigned.", code: "JOB_NOT_ACTIVE" });
      }
      return;
    }
    req.log.error({ err: error }, "Reassign conversation failed");
    res.status(500).json({ error: "Failed to reassign the job" });
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
    // Claimed job: only the assigned member may drive the pipeline status —
    // it feeds review eligibility, so a non-assigned colleague must not be
    // able to flip it (flag OFF this always passes; legacy unchanged).
    const act = await canActOnJob(conv, userId);
    if (!act.ok) {
      res.status(409).json(jobClaimedByOtherBody(act.assignedName));
      return;
    }

    await db.transaction(async (tx) => {
      // Re-verify under the conversation row lock — a reassignment or
      // removal handover may have committed since the pre-check above.
      await requireAssignedInTx(tx, id, userId);
      await tx
        .update(conversationsTable)
        .set({ traderStatus: body.traderStatus, updatedAt: new Date() })
        .where(eq(conversationsTable.id, id));

      // Any trader engagement (CONTACTED/QUOTED/COMPLETED) advances the linked
      // enquiry past "pending" so the existing review-eligibility logic — which
      // gates on enquiry.status !== "pending" — unlocks for the customer.
      if (body.traderStatus !== "NEW" && conv.enquiryId) {
        await tx
          .update(enquiriesTable)
          .set({ status: "responded" })
          .where(and(eq(enquiriesTable.id, conv.enquiryId), eq(enquiriesTable.status, "pending")));
      }
    });

    res.json({ ok: true, traderStatus: body.traderStatus });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid status", details: error.issues });
      return;
    }
    if (error instanceof JobClaimedByOtherError) {
      res.status(409).json(jobClaimedByOtherBody(error.assignedName));
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
      // Conditional update makes the transition atomic: concurrent requests
      // race on `customer_completed_at IS NULL` and only ONE wins, so the
      // notification fanout below can never double-send.
      const updated = await db
        .update(conversationsTable)
        .set({
          customerCompletedAt: now,
          reviewUnlockedAt: now,
          traderStatus: "COMPLETED",
          updatedAt: now,
        })
        .where(and(eq(conversationsTable.id, id), isNull(conversationsTable.customerCompletedAt)))
        .returning({ id: conversationsTable.id });
      if (updated.length === 0) {
        // Another request completed the transition first.
        res.json({ ok: true });
        return;
      }
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

      // Milestone push to the trader + review invite (push/email) to the
      // customer. Gated on the customerCompletedAt transition above, so
      // repeat calls can never double-send.
      void (async () => {
        try {
          const [tp] = await db
            .select({
              businessName: traderProfilesTable.businessName,
              traderUserId: traderProfilesTable.userId,
            })
            .from(traderProfilesTable)
            .where(eq(traderProfilesTable.id, conv.traderProfileId))
            .limit(1);
          const refPart = conv.jobReference ? `job ${conv.jobReference}` : "your job";
          // Company Teams routing: assigned member + owner (deduped when the
          // owner did the job). Flag OFF this is exactly the legacy single
          // trader recipient.
          const traderRecipients = await traderSideRecipientUserIds(conv);
          for (const traderRecipientId of traderRecipients) {
            try {
              await sendPushToUser(traderRecipientId, {
                title: "Job completed",
                body: `Your customer confirmed ${refPart} as complete. Another completed job has been added to your MyLocalTrade history.`,
                data: { type: "job_completed", conversationId: id },
              });
            } catch (pushErr) {
              req.log.warn({ err: pushErr, conversationId: id }, "Completion push to trader failed");
            }
          }
          // Review invite to the customer (immediate post-completion only —
          // no scheduled reminders).
          try {
            await sendPushToUser(conv.customerId, {
              title: "Leave a review",
              body: `Thanks for confirming ${refPart} is complete. Share how it went to help other customers.`,
              data: { type: "review_invite", conversationId: id },
            });
          } catch (pushErr) {
            req.log.warn({ err: pushErr, conversationId: id }, "Review-invite push failed");
          }
          const [customer] = await db
            .select({ email: usersTable.email, fullName: usersTable.fullName })
            .from(usersTable)
            .where(eq(usersTable.id, conv.customerId))
            .limit(1);
          if (customer?.email && tp) {
            await sendReviewInviteEmail({
              toEmail: customer.email,
              toName: customer.fullName ?? "there",
              businessName: tp.businessName,
              traderProfileId: conv.traderProfileId,
              conversationId: id,
            });
          }
        } catch (err) {
          req.log.warn({ err, conversationId: id }, "Completion notifications failed");
        }
      })();
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
    // Company Teams: only the member the job is assigned to may mark it done.
    {
      const act = await canActOnJob(conv, userId);
      if (!act.ok) {
        res.status(409).json(jobClaimedByOtherBody(act.assignedName));
        return;
      }
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
      // Atomic transition — only the request that flips NULL→now sends the
      // notifications below (guards against concurrent double-taps).
      const updated = await db.transaction(async (tx) => {
        // Re-verify assignment under the row lock (reassignment may race).
        await requireAssignedInTx(tx, id, userId);
        return await tx
          .update(conversationsTable)
          .set({ traderMarkedDoneAt: now, updatedAt: now })
          .where(and(eq(conversationsTable.id, id), isNull(conversationsTable.traderMarkedDoneAt)))
          .returning({ id: conversationsTable.id });
      });
      if (updated.length === 0) {
        res.json({ ok: true });
        return;
      }
      await postSystemMessage(
        id,
        "The trader marked the work as completed. Please confirm the job is done to leave a review, or reply here if there's a problem.",
        "customer",
      );

      // Notify the customer with push + email. Gated on the traderMarkedDoneAt
      // transition above, so repeat calls can never double-send.
      void (async () => {
        try {
          const [tp] = await db
            .select({ businessName: traderProfilesTable.businessName })
            .from(traderProfilesTable)
            .where(eq(traderProfilesTable.id, conv.traderProfileId))
            .limit(1);
          const businessName = tp?.businessName ?? "Your trader";
          const refPart = conv.jobReference ? ` job ${conv.jobReference}` : " your job";
          try {
            await sendPushToUser(conv.customerId, {
              title: "Work marked as completed",
              body: `${businessName} marked${refPart} as complete. Review the job and confirm when ready.`,
              data: { type: "work_marked_complete", conversationId: id },
            });
          } catch (pushErr) {
            req.log.warn({ err: pushErr, conversationId: id }, "Mark-done push failed");
          }
          const [customer] = await db
            .select({ email: usersTable.email, fullName: usersTable.fullName })
            .from(usersTable)
            .where(eq(usersTable.id, conv.customerId))
            .limit(1);
          if (customer?.email) {
            await sendWorkMarkedCompleteEmail({
              toEmail: customer.email,
              toName: customer.fullName ?? "there",
              businessName,
              jobReference: conv.jobReference,
              conversationId: id,
            });
          }
        } catch (err) {
          req.log.warn({ err, conversationId: id }, "Mark-done notifications failed");
        }
      })();
    }

    res.json({ ok: true });
  } catch (error) {
    if (error instanceof JobClaimedByOtherError) {
      res.status(409).json(jobClaimedByOtherBody(error.assignedName));
      return;
    }
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
    // Company Teams: a colleague's claimed job is read-only for other members
    // (customers are unaffected). An UNCLAIMED lead may be cancelled by any
    // active member — cancelling is deliberately a non-claiming action.
    if (isTrader) {
      const act = await canActOnJob(conv, userId);
      if (!act.ok) {
        res.status(409).json(jobClaimedByOtherBody(act.assignedName));
        return;
      }
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
    await db.transaction(async (tx) => {
      // Re-verify assignment under the row lock (reassignment may race).
      if (isTrader) await requireAssignedInTx(tx, id, userId);
      await tx
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
    });
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
    if (error instanceof JobClaimedByOtherError) {
      res.status(409).json(jobClaimedByOtherBody(error.assignedName));
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
