import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  quotesTable,
  conversationsTable,
  traderProfilesTable,
  enquiriesTable,
} from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { authMiddleware } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { sendPushToUser } from "../lib/push-notifications";
import { postSystemMessage } from "../lib/system-messages";
import { ensureHired } from "../lib/hire";
import { serializeQuote, quoteSummaryLine, formatPence, priceTypeLabel } from "../lib/quotes";

const router: IRouter = Router();

// Mirrors the OpenAPI CreateQuoteRequest. validUntil arrives as an ISO string
// over the wire, hence the coercion here rather than the generated zod schema
// (which models it as a Date instance).
const QuoteBody = z.object({
  amountPence: z.number().int().min(1).max(100_000_000),
  priceType: z.enum(["FIXED", "ESTIMATE"]),
  description: z.string().trim().min(3).max(2000),
  notes: z.string().trim().max(1000).nullish(),
  validUntil: z.coerce.date().nullish(),
});

type ConversationRow = typeof conversationsTable.$inferSelect;
type QuoteRow = typeof quotesTable.$inferSelect;

async function traderProfileIdFor(userId: number): Promise<number | null> {
  const [profile] = await db
    .select({ id: traderProfilesTable.id })
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.userId, userId))
    .limit(1);
  return profile?.id ?? null;
}

// Quotes only make sense while the job can still proceed. Returns an error
// string (for a 409) or null when the conversation is open for quoting.
function conversationClosedReason(conv: ConversationRow): string | null {
  if (conv.cancelledAt) return "This job has been cancelled.";
  if (conv.customerCompletedAt) return "This job has already been completed.";
  if (conv.status === "CLOSED" || conv.status === "BLOCKED")
    return "This conversation is closed.";
  return null;
}

function validateValidUntil(validUntil: Date | null | undefined, res: Parameters<Parameters<IRouter["post"]>[1]>[1]): boolean {
  if (validUntil && validUntil.getTime() <= Date.now()) {
    res.status(400).json({ error: "The valid-until date must be in the future." });
    return false;
  }
  return true;
}

// Advance the trader-side pipeline status + linked enquiry the same way the
// manual "QUOTED" status update does, so review eligibility unlocks.
async function markConversationQuoted(conv: ConversationRow) {
  if (conv.traderStatus !== "COMPLETED") {
    await db
      .update(conversationsTable)
      .set({ traderStatus: "QUOTED", updatedAt: new Date() })
      .where(eq(conversationsTable.id, conv.id));
  }
  if (conv.enquiryId) {
    await db
      .update(enquiriesTable)
      .set({ status: "responded" })
      .where(and(eq(enquiriesTable.id, conv.enquiryId), eq(enquiriesTable.status, "pending")));
  }
}

async function loadQuoteWithConversation(quoteId: number): Promise<
  { quote: QuoteRow; conv: ConversationRow } | null
> {
  const [row] = await db
    .select({ quote: quotesTable, conv: conversationsTable })
    .from(quotesTable)
    .innerJoin(conversationsTable, eq(quotesTable.conversationId, conversationsTable.id))
    .where(eq(quotesTable.id, quoteId))
    .limit(1);
  return row ?? null;
}

function parseId(raw: unknown): number | null {
  const id = Number.parseInt(String(raw), 10);
  return Number.isFinite(id) ? id : null;
}

// The quotes_one_pending_per_conversation partial unique index is the
// DB-level guarantee behind "one live quote per conversation". Concurrent
// inserts that slip past the application-level check surface here as a
// Postgres 23505 and are reported as an ordinary conflict.
function isPendingQuoteConflict(error: unknown): boolean {
  const err = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const code = err?.code ?? err?.cause?.code;
  const constraint = err?.constraint ?? err?.cause?.constraint;
  return code === "23505" && (constraint == null || constraint === "quotes_one_pending_per_conversation");
}

// POST /api/conversations/:id/quotes — trader sends a structured quote
router.post("/conversations/:id/quotes", authMiddleware, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Invalid conversation id" });
      return;
    }
    const { userId, userRole } = req as AuthenticatedRequest;
    if (userRole !== "trader") {
      res.status(403).json({ error: "Only traders can send quotes" });
      return;
    }
    const body = QuoteBody.parse(req.body);
    if (!validateValidUntil(body.validUntil, res)) return;

    const traderProfileId = await traderProfileIdFor(userId);
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id))
      .limit(1);
    if (!conv || traderProfileId == null || conv.traderProfileId !== traderProfileId) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const closedReason = conversationClosedReason(conv);
    if (closedReason) {
      res.status(409).json({ error: closedReason });
      return;
    }

    const now = new Date();
    // One live quote per conversation. A stale PENDING row whose validUntil
    // has passed is finalised to EXPIRED here (lazily) so it never blocks a
    // fresh quote; a genuinely live one must be revised instead.
    const [existing] = await db
      .select()
      .from(quotesTable)
      .where(and(eq(quotesTable.conversationId, id), eq(quotesTable.status, "PENDING")))
      .limit(1);
    if (existing) {
      if (existing.validUntil != null && existing.validUntil.getTime() <= now.getTime()) {
        await db
          .update(quotesTable)
          .set({ status: "EXPIRED", updatedAt: now })
          .where(and(eq(quotesTable.id, existing.id), eq(quotesTable.status, "PENDING")));
      } else {
        res.status(409).json({
          error: "You already have a pending quote in this conversation. Revise it instead.",
        });
        return;
      }
    }

    const [quote] = await db
      .insert(quotesTable)
      .values({
        conversationId: id,
        enquiryId: conv.enquiryId,
        traderProfileId: conv.traderProfileId,
        traderUserId: userId,
        customerId: conv.customerId,
        amountPence: body.amountPence,
        priceType: body.priceType,
        description: body.description,
        notes: body.notes?.length ? body.notes : null,
        validUntil: body.validUntil ?? null,
        status: "PENDING",
      })
      .returning();

    await markConversationQuoted(conv);
    await postSystemMessage(id, `Quote sent: ${quoteSummaryLine(quote)}.`, "customer");

    void sendPushToUser(conv.customerId, {
      title: "New quote received",
      body: `${formatPence(quote.amountPence)} (${priceTypeLabel(quote.priceType)})${conv.serviceRequired ? ` — ${conv.serviceRequired}` : ""}`,
      data: { type: "quote_received", conversationId: id, quoteId: quote.id },
    }).catch((err) => req.log.warn({ err }, "Quote push failed"));

    res.status(201).json({ quote: serializeQuote(quote) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid quote", details: error.issues });
      return;
    }
    if (isPendingQuoteConflict(error)) {
      res.status(409).json({
        error: "You already have a pending quote in this conversation. Revise it instead.",
      });
      return;
    }
    req.log.error({ err: error }, "Create quote failed");
    res.status(500).json({ error: "Failed to send quote" });
  }
});

// POST /api/quotes/:id/revise — trader replaces their pending quote
router.post("/quotes/:id/revise", authMiddleware, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Invalid quote id" });
      return;
    }
    const { userId } = req as AuthenticatedRequest;
    const body = QuoteBody.parse(req.body);
    if (!validateValidUntil(body.validUntil, res)) return;

    const row = await loadQuoteWithConversation(id);
    if (!row || row.quote.traderUserId !== userId) {
      res.status(404).json({ error: "Quote not found" });
      return;
    }
    const closedReason = conversationClosedReason(row.conv);
    if (closedReason) {
      res.status(409).json({ error: closedReason });
      return;
    }

    // Revising is allowed while the stored status is PENDING — including a
    // lapsed (effectively EXPIRED) one, which is exactly how a trader
    // reissues an expired quote. The conditional UPDATE makes the swap
    // race-safe: only one revision can win.
    const created = await db.transaction(async (tx) => {
      const superseded = await tx
        .update(quotesTable)
        .set({ status: "REVISED", updatedAt: new Date() })
        .where(and(eq(quotesTable.id, id), eq(quotesTable.status, "PENDING")))
        .returning({ id: quotesTable.id });
      if (superseded.length === 0) return null;
      const [next] = await tx
        .insert(quotesTable)
        .values({
          conversationId: row.quote.conversationId,
          enquiryId: row.quote.enquiryId,
          traderProfileId: row.quote.traderProfileId,
          traderUserId: row.quote.traderUserId,
          customerId: row.quote.customerId,
          amountPence: body.amountPence,
          priceType: body.priceType,
          description: body.description,
          notes: body.notes?.length ? body.notes : null,
          validUntil: body.validUntil ?? null,
          status: "PENDING",
          revisionOfQuoteId: id,
        })
        .returning();
      return next;
    });
    if (!created) {
      res.status(409).json({ error: "Only pending quotes can be revised." });
      return;
    }

    await markConversationQuoted(row.conv);
    await postSystemMessage(
      row.quote.conversationId,
      `Quote revised: ${quoteSummaryLine(created)}.`,
      "customer",
    );
    void sendPushToUser(row.quote.customerId, {
      title: "Quote updated",
      body: `New price: ${formatPence(created.amountPence)} (${priceTypeLabel(created.priceType)})`,
      data: { type: "quote_revised", conversationId: row.quote.conversationId, quoteId: created.id },
    }).catch((err) => req.log.warn({ err }, "Quote push failed"));

    res.status(201).json({ quote: serializeQuote(created) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid quote", details: error.issues });
      return;
    }
    if (isPendingQuoteConflict(error)) {
      res.status(409).json({ error: "Only pending quotes can be revised." });
      return;
    }
    req.log.error({ err: error }, "Revise quote failed");
    res.status(500).json({ error: "Failed to revise quote" });
  }
});

// POST /api/quotes/:id/withdraw — trader withdraws their pending quote
router.post("/quotes/:id/withdraw", authMiddleware, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Invalid quote id" });
      return;
    }
    const { userId } = req as AuthenticatedRequest;
    const row = await loadQuoteWithConversation(id);
    if (!row || row.quote.traderUserId !== userId) {
      res.status(404).json({ error: "Quote not found" });
      return;
    }

    const now = new Date();
    const [updated] = await db
      .update(quotesTable)
      .set({ status: "WITHDRAWN", withdrawnAt: now, updatedAt: now })
      .where(and(eq(quotesTable.id, id), eq(quotesTable.status, "PENDING")))
      .returning();
    if (!updated) {
      res.status(409).json({ error: "Only pending quotes can be withdrawn." });
      return;
    }

    await postSystemMessage(
      row.quote.conversationId,
      `The trader withdrew their quote of ${formatPence(updated.amountPence)}.`,
      "customer",
    );
    void sendPushToUser(row.quote.customerId, {
      title: "Quote withdrawn",
      body: `The quote of ${formatPence(updated.amountPence)} is no longer available.`,
      data: { type: "quote_withdrawn", conversationId: row.quote.conversationId, quoteId: id },
    }).catch((err) => req.log.warn({ err }, "Quote push failed"));

    res.json({ quote: serializeQuote(updated) });
  } catch (error) {
    req.log.error({ err: error }, "Withdraw quote failed");
    res.status(500).json({ error: "Failed to withdraw quote" });
  }
});

// POST /api/quotes/:id/accept — customer accepts a pending quote (hires)
router.post("/quotes/:id/accept", authMiddleware, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Invalid quote id" });
      return;
    }
    const { userId, userRole } = req as AuthenticatedRequest;
    const row = await loadQuoteWithConversation(id);
    if (!row || !(userRole === "customer" && row.quote.customerId === userId)) {
      res.status(404).json({ error: "Quote not found" });
      return;
    }
    const closedReason = conversationClosedReason(row.conv);
    if (closedReason) {
      res.status(409).json({ error: closedReason });
      return;
    }

    // Conditional UPDATE enforces both pending-ness and non-expiry atomically,
    // so a lapsed quote can never be accepted even under concurrent requests.
    const now = new Date();
    const [accepted] = await db
      .update(quotesTable)
      .set({ status: "ACCEPTED", acceptedAt: now, updatedAt: now })
      .where(
        and(
          eq(quotesTable.id, id),
          eq(quotesTable.status, "PENDING"),
          sql`(${quotesTable.validUntil} IS NULL OR ${quotesTable.validUntil} > ${now})`,
        ),
      )
      .returning();
    if (!accepted) {
      const lapsed =
        row.quote.status === "PENDING" &&
        row.quote.validUntil != null &&
        row.quote.validUntil.getTime() <= now.getTime();
      if (lapsed) {
        await db
          .update(quotesTable)
          .set({ status: "EXPIRED", updatedAt: now })
          .where(and(eq(quotesTable.id, id), eq(quotesTable.status, "PENDING")));
        res.status(409).json({ error: "This quote has expired. Ask the trader for a new one." });
      } else {
        res.status(409).json({ error: "This quote is no longer available to accept." });
      }
      return;
    }

    // Accepting a quote is hiring: reuse the exact same hire flow as the
    // legacy "Accept offer" button (job reference, milestone message).
    await ensureHired(row.conv.id);
    await postSystemMessage(
      row.conv.id,
      `The customer accepted the quote of ${formatPence(accepted.amountPence)}.`,
      "trader",
    );
    void sendPushToUser(row.quote.traderUserId, {
      title: "Quote accepted",
      body: `Your quote of ${formatPence(accepted.amountPence)} was accepted. You have been hired.`,
      data: { type: "quote_accepted", conversationId: row.conv.id, quoteId: id },
    }).catch((err) => req.log.warn({ err }, "Quote push failed"));

    res.json({ quote: serializeQuote(accepted) });
  } catch (error) {
    req.log.error({ err: error }, "Accept quote failed");
    res.status(500).json({ error: "Failed to accept quote" });
  }
});

// POST /api/quotes/:id/decline — customer declines a pending quote
router.post("/quotes/:id/decline", authMiddleware, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Invalid quote id" });
      return;
    }
    const { userId, userRole } = req as AuthenticatedRequest;
    const row = await loadQuoteWithConversation(id);
    if (!row || !(userRole === "customer" && row.quote.customerId === userId)) {
      res.status(404).json({ error: "Quote not found" });
      return;
    }

    const now = new Date();
    const [declined] = await db
      .update(quotesTable)
      .set({ status: "DECLINED", declinedAt: now, updatedAt: now })
      .where(and(eq(quotesTable.id, id), eq(quotesTable.status, "PENDING")))
      .returning();
    if (!declined) {
      res.status(409).json({ error: "This quote is no longer pending." });
      return;
    }

    await postSystemMessage(
      row.conv.id,
      `The customer declined the quote of ${formatPence(declined.amountPence)}.`,
      "trader",
    );
    void sendPushToUser(row.quote.traderUserId, {
      title: "Quote declined",
      body: `Your quote of ${formatPence(declined.amountPence)} was declined. You can send a new one.`,
      data: { type: "quote_declined", conversationId: row.conv.id, quoteId: id },
    }).catch((err) => req.log.warn({ err }, "Quote push failed"));

    res.json({ quote: serializeQuote(declined) });
  } catch (error) {
    req.log.error({ err: error }, "Decline quote failed");
    res.status(500).json({ error: "Failed to decline quote" });
  }
});

export default router;
