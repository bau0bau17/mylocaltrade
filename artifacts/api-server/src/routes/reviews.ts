import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  reviewsTable,
  enquiriesTable,
  traderProfilesTable,
  usersTable,
} from "@workspace/db/schema";
import { and, eq, ne, sql, desc, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { authMiddleware, adminOnly, customerOnly, traderOnly } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { logAudit } from "../lib/trader-status";
import { sendReviewApprovedEmail, sendReviewReplyEmail } from "../lib/email";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Statuses considered publicly discoverable for review retrieval. Mirrors the
// visibility used by the public trader detail endpoint.
const PUBLIC_TRADER_STATUSES: readonly string[] = [
  "VERIFIED",
  "UNDER_REVIEW",
  "PENDING_DOCUMENTS",
];

const CreateReviewBody = z.object({
  traderId: z.number().int().positive(),
  enquiryId: z.number().int().positive(),
  rating: z.number().int().min(1).max(5),
  text: z.string().min(10).max(2000),
});

const ModerateBody = z.object({
  action: z.enum(["approve", "reject", "flag"]),
  notes: z.string().max(1000).optional(),
});

const ReplyBody = z.object({
  reply: z.string().trim().min(1).max(2000),
});

type ReviewRow = typeof reviewsTable.$inferSelect;

async function serializeReview(r: ReviewRow, customerName?: string) {
  let name = customerName;
  if (!name) {
    const [c] = await db
      .select({ fullName: usersTable.fullName })
      .from(usersTable)
      .where(eq(usersTable.id, r.customerId))
      .limit(1);
    name = c?.fullName ?? "Customer";
  }
  return {
    id: r.id,
    traderId: r.traderId,
    customerId: r.customerId,
    customerName: name,
    enquiryId: r.enquiryId,
    rating: r.rating,
    text: r.text,
    status: r.status,
    traderReply: r.traderReply,
    traderReplyAt: r.traderReplyAt?.toISOString() ?? null,
    moderatedAt: r.moderatedAt?.toISOString() ?? null,
    moderationNotes: r.moderationNotes,
    createdAt: r.createdAt.toISOString(),
  };
}

async function recomputeTraderRating(traderId: number) {
  const [agg] = await db
    .select({
      avg: sql<string | null>`AVG(${reviewsTable.rating})::text`,
      count: sql<string>`COUNT(*)::text`,
    })
    .from(reviewsTable)
    .where(and(eq(reviewsTable.traderId, traderId), eq(reviewsTable.status, "APPROVED")));
  const avg = agg?.avg != null ? Number.parseFloat(agg.avg) : null;
  const count = agg?.count != null ? Number.parseInt(agg.count, 10) : 0;
  await db
    .update(traderProfilesTable)
    .set({
      rating: avg,
      reviewCount: count,
      updatedAt: new Date(),
    })
    .where(eq(traderProfilesTable.id, traderId));
}

// POST /api/reviews — submit a new review (customer only, gated on enquiry)
router.post("/reviews", authMiddleware, customerOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const body = CreateReviewBody.parse(req.body);

    // Enquiry must exist, belong to this customer, target this trader,
    // and be past the initial "pending" stage (i.e. trader has engaged).
    const [enq] = await db
      .select()
      .from(enquiriesTable)
      .where(eq(enquiriesTable.id, body.enquiryId))
      .limit(1);
    if (
      !enq ||
      enq.customerId !== userId ||
      enq.traderId !== body.traderId ||
      enq.status === "pending"
    ) {
      res.status(403).json({
        error: "You can only review a trader after they have responded to your enquiry.",
      });
      return;
    }

    // One review per enquiry.
    const [existing] = await db
      .select({ id: reviewsTable.id })
      .from(reviewsTable)
      .where(eq(reviewsTable.enquiryId, body.enquiryId))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "You have already left a review for this job." });
      return;
    }

    const [trader] = await db
      .select({ userId: traderProfilesTable.userId })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.id, body.traderId))
      .limit(1);
    if (!trader) {
      res.status(404).json({ error: "Trader not found" });
      return;
    }

    const [created] = await db
      .insert(reviewsTable)
      .values({
        traderId: body.traderId,
        customerId: userId,
        enquiryId: body.enquiryId,
        rating: body.rating,
        text: body.text,
        status: "PENDING",
      })
      .returning();

    await logAudit({
      userId: trader.userId,
      action: "REVIEW_SUBMITTED",
      performedBy: userId,
      details: { reviewId: created.id, rating: body.rating, enquiryId: body.enquiryId },
    });

    res.status(201).json(await serializeReview(created));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid review data", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Create review failed");
    res.status(500).json({ error: "Failed to submit review" });
  }
});

// GET /api/reviews/eligible — customer's enquiries that can be reviewed
router.get("/reviews/eligible", authMiddleware, customerOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const rows = await db
      .select({
        enquiryId: enquiriesTable.id,
        traderId: enquiriesTable.traderId,
        traderBusinessName: traderProfilesTable.businessName,
        serviceRequired: enquiriesTable.serviceRequired,
        createdAt: enquiriesTable.createdAt,
        existingReviewId: reviewsTable.id,
      })
      .from(enquiriesTable)
      .innerJoin(traderProfilesTable, eq(enquiriesTable.traderId, traderProfilesTable.id))
      .leftJoin(reviewsTable, eq(reviewsTable.enquiryId, enquiriesTable.id))
      .where(
        and(
          eq(enquiriesTable.customerId, userId),
          ne(enquiriesTable.status, "pending"),
        ),
      )
      .orderBy(desc(enquiriesTable.createdAt));

    const enquiries = rows
      .filter((r) => r.existingReviewId == null)
      .map((r) => ({
        enquiryId: r.enquiryId,
        traderId: r.traderId,
        traderBusinessName: r.traderBusinessName,
        serviceRequired: r.serviceRequired,
        createdAt: r.createdAt.toISOString(),
      }));
    res.json({ enquiries });
  } catch (error) {
    req.log.error({ err: error }, "List eligible enquiries failed");
    res.status(500).json({ error: "Failed to list eligible enquiries" });
  }
});

// GET /api/traders/:id/reviews — public (approved only).
// Returns a redacted DTO that omits customerId and moderation metadata —
// public callers must never see internal moderation context.
router.get("/traders/:id/reviews", async (req, res) => {
  try {
    const traderId = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(traderId)) {
      res.status(400).json({ error: "Invalid trader id" });
      return;
    }

    const [trader] = await db
      .select({
        id: traderProfilesTable.id,
        isActive: traderProfilesTable.isActive,
        verificationStatus: traderProfilesTable.verificationStatus,
        revalidationOverdue: traderProfilesTable.revalidationOverdue,
        deletionStatus: usersTable.deletionStatus,
        deletedAt: usersTable.deletedAt,
      })
      .from(traderProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, traderProfilesTable.userId))
      .where(eq(traderProfilesTable.id, traderId))
      .limit(1);
    // Hide reviews for any trader not publicly discoverable — including those
    // whose periodic re-validation lapsed (revalidationOverdue) — so the
    // reviews endpoint can't be used to retrieve hidden profiles by ID.
    if (
      !trader ||
      !trader.isActive ||
      trader.revalidationOverdue ||
      trader.deletionStatus ||
      trader.deletedAt ||
      !PUBLIC_TRADER_STATUSES.includes(trader.verificationStatus)
    ) {
      res.status(404).json({ error: "Trader not found" });
      return;
    }

    const rows = await db
      .select({ review: reviewsTable, customerName: usersTable.fullName })
      .from(reviewsTable)
      .innerJoin(usersTable, eq(reviewsTable.customerId, usersTable.id))
      .where(and(eq(reviewsTable.traderId, traderId), eq(reviewsTable.status, "APPROVED")))
      .orderBy(desc(reviewsTable.createdAt));

    const reviews = rows.map(({ review: r, customerName }) => ({
      id: r.id,
      traderId: r.traderId,
      customerName,
      rating: r.rating,
      text: r.text,
      traderReply: r.traderReply,
      traderReplyAt: r.traderReplyAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
    const totalCount = reviews.length;
    const averageRating =
      totalCount > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / totalCount : null;
    res.json({ reviews, totalCount, averageRating });
  } catch (error) {
    req.log.error({ err: error }, "Get trader reviews failed");
    res.status(500).json({ error: "Failed to get reviews" });
  }
});

// GET /api/trader/reviews — trader sees all reviews (any status) for their profile
router.get("/trader/reviews", authMiddleware, traderOnly, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const [profile] = await db
      .select({ id: traderProfilesTable.id })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, userId))
      .limit(1);
    if (!profile) {
      res.json({ reviews: [], totalCount: 0, averageRating: null });
      return;
    }
    const rows = await db
      .select({ review: reviewsTable, customerName: usersTable.fullName })
      .from(reviewsTable)
      .innerJoin(usersTable, eq(reviewsTable.customerId, usersTable.id))
      .where(eq(reviewsTable.traderId, profile.id))
      .orderBy(desc(reviewsTable.createdAt));
    const reviews = await Promise.all(rows.map((r) => serializeReview(r.review, r.customerName)));
    const approved = reviews.filter((r) => r.status === "APPROVED");
    const averageRating =
      approved.length > 0 ? approved.reduce((s, r) => s + r.rating, 0) / approved.length : null;
    res.json({ reviews, totalCount: approved.length, averageRating });
  } catch (error) {
    req.log.error({ err: error }, "Get my trader reviews failed");
    res.status(500).json({ error: "Failed to get reviews" });
  }
});

// POST /api/trader/reviews/:id/reply — trader replies to a review on their profile
router.post("/trader/reviews/:id/reply", authMiddleware, traderOnly, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid review id" });
      return;
    }
    const body = ReplyBody.parse(req.body);
    const { userId } = req as AuthenticatedRequest;

    const [profile] = await db
      .select({ id: traderProfilesTable.id })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, userId))
      .limit(1);
    if (!profile) {
      res.status(403).json({ error: "Trader profile not found" });
      return;
    }

    const [review] = await db
      .select()
      .from(reviewsTable)
      .where(eq(reviewsTable.id, id))
      .limit(1);
    if (!review) {
      res.status(404).json({ error: "Review not found" });
      return;
    }
    if (review.traderId !== profile.id) {
      res.status(403).json({ error: "You can only reply to reviews on your own profile" });
      return;
    }
    if (review.status !== "APPROVED") {
      res.status(409).json({ error: "You can only reply to reviews that have been approved" });
      return;
    }

    const wasFirstReply = !review.traderReply;

    const [updated] = await db
      .update(reviewsTable)
      .set({
        traderReply: body.reply,
        traderReplyAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(reviewsTable.id, id))
      .returning();

    // Notify the customer the first time a trader replies. Best-effort; we
    // don't fail the request if the email subsystem is offline.
    if (wasFirstReply) {
      void (async () => {
        try {
          const [customer] = await db
            .select({ email: usersTable.email, fullName: usersTable.fullName })
            .from(usersTable)
            .where(eq(usersTable.id, review.customerId))
            .limit(1);
          const [traderRow] = await db
            .select({ businessName: traderProfilesTable.businessName })
            .from(traderProfilesTable)
            .where(eq(traderProfilesTable.id, review.traderId))
            .limit(1);
          if (customer?.email && traderRow?.businessName) {
            await sendReviewReplyEmail({
              toEmail: customer.email,
              toName: customer.fullName ?? "there",
              traderName: traderRow.businessName,
              reviewText: review.text,
              replyText: body.reply,
            });
          }
        } catch (err) {
          logger.error({ err, reviewId: id }, "Failed to send review-reply email");
        }
      })();
    }

    res.json(await serializeReview(updated));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid reply", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Reply to review failed");
    res.status(500).json({ error: "Failed to post reply" });
  }
});

// GET /api/admin/reviews — moderation queue
router.get("/admin/reviews", authMiddleware, adminOnly, async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const where = status
      ? eq(reviewsTable.status, status)
      : isNotNull(reviewsTable.id);
    const rows = await db
      .select({ review: reviewsTable, customerName: usersTable.fullName })
      .from(reviewsTable)
      .innerJoin(usersTable, eq(reviewsTable.customerId, usersTable.id))
      .where(where)
      .orderBy(desc(reviewsTable.createdAt));
    const reviews = await Promise.all(rows.map((r) => serializeReview(r.review, r.customerName)));
    res.json({ reviews });
  } catch (error) {
    req.log.error({ err: error }, "Admin list reviews failed");
    res.status(500).json({ error: "Failed to list reviews" });
  }
});

// POST /api/admin/reviews/:id/moderate
router.post("/admin/reviews/:id/moderate", authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid review id" });
      return;
    }
    const body = ModerateBody.parse(req.body);
    const adminId = (req as AuthenticatedRequest).userId;

    const [review] = await db.select().from(reviewsTable).where(eq(reviewsTable.id, id)).limit(1);
    if (!review) {
      res.status(404).json({ error: "Review not found" });
      return;
    }

    const newStatus =
      body.action === "approve" ? "APPROVED" : body.action === "reject" ? "REJECTED" : "FLAGGED";

    const [updated] = await db
      .update(reviewsTable)
      .set({
        status: newStatus,
        moderatedAt: new Date(),
        moderatedBy: adminId,
        moderationNotes: body.notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(reviewsTable.id, id))
      .returning();

    await recomputeTraderRating(review.traderId);

    const [trader] = await db
      .select({
        userId: traderProfilesTable.userId,
        businessName: traderProfilesTable.businessName,
      })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.id, review.traderId))
      .limit(1);
    if (trader) {
      const action =
        body.action === "approve"
          ? "REVIEW_APPROVED"
          : body.action === "reject"
            ? "REVIEW_REJECTED"
            : "REVIEW_FLAGGED";
      await logAudit({
        userId: trader.userId,
        action,
        performedBy: adminId,
        details: { reviewId: id, traderId: review.traderId, customerId: review.customerId },
        notes: body.notes,
      });

      // Email the trader on approval only; rejected/flagged reviews stay private.
      if (body.action === "approve") {
        void (async () => {
          try {
            const [traderUser] = await db
              .select({ email: usersTable.email, fullName: usersTable.fullName })
              .from(usersTable)
              .where(eq(usersTable.id, trader.userId))
              .limit(1);
            const [customer] = await db
              .select({ fullName: usersTable.fullName })
              .from(usersTable)
              .where(eq(usersTable.id, review.customerId))
              .limit(1);
            if (traderUser?.email) {
              await sendReviewApprovedEmail({
                toEmail: traderUser.email,
                toName: traderUser.fullName ?? trader.businessName,
                customerName: customer?.fullName ?? "A customer",
                rating: review.rating,
                reviewText: review.text,
              });
            }
          } catch (err) {
            logger.error({ err, reviewId: id }, "Failed to send review-approved email");
          }
        })();
      }
    }

    res.json(await serializeReview(updated));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid moderation request", details: error.issues });
      return;
    }
    req.log.error({ err: error }, "Moderate review failed");
    res.status(500).json({ error: "Failed to moderate review" });
  }
});

export default router;
