import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  bookingsTable,
  conversationsTable,
  traderProfilesTable,
} from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { authMiddleware } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { sendPushToUser } from "../lib/push-notifications";
import { postSystemMessage } from "../lib/system-messages";
import { serializeBooking, formatBookingTime } from "../lib/bookings";
import {
  ALLOWED_DURATIONS_MINUTES,
  DEFAULT_LEGACY_DURATION_MINUTES,
  SLOT_CONFLICT_MESSAGE,
  durationLabel,
  findConflict,
  generateSlots,
  occupiedIntervalsForTrader,
  withinWorkingHours,
} from "../lib/booking-availability";
import { traderProfilesTable as tpTable } from "@workspace/db/schema";

const router: IRouter = Router();

const BookingBody = z.object({
  startAt: z.coerce.date(),
  // Optional for backwards compatibility with older app builds; defaults to
  // one hour. New clients send an explicit controlled value.
  durationMinutes: z
    .number()
    .int()
    .refine((v) => (ALLOWED_DURATIONS_MINUTES as readonly number[]).includes(v), {
      message: "Invalid appointment duration",
    })
    .optional(),
  note: z.string().trim().max(300).nullish(),
});

type ConversationRow = typeof conversationsTable.$inferSelect;
type BookingRow = typeof bookingsTable.$inferSelect;

function parseId(raw: unknown): number | null {
  const id = Number.parseInt(String(raw), 10);
  return Number.isFinite(id) ? id : null;
}

// Resolve the caller's role in the conversation. Bookings are strictly a
// participant feature: the customer of the conversation or the trader who
// owns the conversation's trader profile. Anyone else gets a 404 (do not
// reveal the conversation exists).
async function participantRole(
  conv: ConversationRow,
  userId: number,
): Promise<"customer" | "trader" | null> {
  if (conv.customerId === userId) return "customer";
  const [profile] = await db
    .select({ id: traderProfilesTable.id })
    .from(traderProfilesTable)
    .where(
      and(
        eq(traderProfilesTable.id, conv.traderProfileId),
        eq(traderProfilesTable.userId, userId),
      ),
    )
    .limit(1);
  return profile ? "trader" : null;
}

// Bookings only make sense while the hired job is still live.
function bookingClosedReason(conv: ConversationRow): string | null {
  if (!conv.customerAcceptedAt) return "Appointments are available once the trader is hired.";
  if (conv.cancelledAt) return "This job has been cancelled.";
  if (conv.customerCompletedAt) return "This job has already been completed.";
  if (conv.status === "CLOSED" || conv.status === "BLOCKED")
    return "This conversation is closed.";
  return null;
}

async function otherPartyUserId(conv: ConversationRow, role: "customer" | "trader"): Promise<number | null> {
  if (role === "trader") return conv.customerId;
  const [profile] = await db
    .select({ userId: traderProfilesTable.userId })
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.id, conv.traderProfileId))
    .limit(1);
  return profile?.userId ?? null;
}

async function loadBookingWithConversation(bookingId: number): Promise<
  { booking: BookingRow; conv: ConversationRow } | null
> {
  const [row] = await db
    .select({ booking: bookingsTable, conv: conversationsTable })
    .from(bookingsTable)
    .innerJoin(conversationsTable, eq(bookingsTable.conversationId, conversationsTable.id))
    .where(eq(bookingsTable.id, bookingId))
    .limit(1);
  return row ?? null;
}

// POST /api/conversations/:id/bookings — propose an appointment (either party).
// A new proposal supersedes any live booking (that IS the reschedule flow) —
// but never silently: the superseded booking is recorded and a system message
// spells out the change, and the new proposal always needs the other party's
// confirmation.
router.post("/conversations/:id/bookings", authMiddleware, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Invalid conversation id" });
      return;
    }
    const { userId } = req as AuthenticatedRequest;
    const body = BookingBody.parse(req.body);
    if (body.startAt.getTime() <= Date.now()) {
      res.status(400).json({ error: "The appointment time must be in the future." });
      return;
    }

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id))
      .limit(1);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const role = await participantRole(conv, userId);
    if (!role) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const closedReason = bookingClosedReason(conv);
    if (closedReason) {
      res.status(409).json({ error: closedReason });
      return;
    }

    const durationMinutes = body.durationMinutes ?? DEFAULT_LEGACY_DURATION_MINUTES;
    const endAt = new Date(body.startAt.getTime() + durationMinutes * 60000);

    // Working-hours + conflict validation (server-side; UI options are never
    // the only barrier). The conversation's own live booking is about to be
    // superseded by this proposal, so exclude it from the conflict set.
    const [tp] = await db
      .select({ workingHours: tpTable.workingHours })
      .from(tpTable)
      .where(eq(tpTable.id, conv.traderProfileId))
      .limit(1);
    if (!withinWorkingHours(tp?.workingHours, body.startAt, durationMinutes)) {
      res.status(400).json({
        error: "That time is outside the trader's working hours. Please choose another appointment.",
      });
      return;
    }
    const occupied = (await occupiedIntervalsForTrader(conv.traderProfileId)).filter(
      (iv) => iv.conversationId !== id,
    );
    if (findConflict(occupied, body.startAt, durationMinutes)) {
      res.status(409).json({ error: SLOT_CONFLICT_MESSAGE, code: "SLOT_TAKEN" });
      return;
    }

    // Supersede any live booking + insert the new proposal atomically. The
    // partial unique index bookings_one_live_per_conversation backstops
    // concurrent proposals: the loser's INSERT throws 23505 → 409.
    const now = new Date();
    const { created, superseded } = await db.transaction(async (tx) => {
      const supersededRows = await tx
        .update(bookingsTable)
        .set({ status: "SUPERSEDED", updatedAt: now })
        .where(
          and(
            eq(bookingsTable.conversationId, id),
            inArray(bookingsTable.status, ["PROPOSED", "CONFIRMED"]),
          ),
        )
        .returning();
      const [created] = await tx
        .insert(bookingsTable)
        .values({
          conversationId: id,
          startAt: body.startAt,
          durationMinutes,
          endAt,
          note: body.note?.length ? body.note : null,
          status: "PROPOSED",
          proposedByRole: role,
          proposedByUserId: userId,
        })
        .returning();
      return { created, superseded: supersededRows[0] ?? null };
    });

    const who = role === "trader" ? "The trader" : "The customer";
    const when = `${formatBookingTime(created.startAt)} (${durationLabel(durationMinutes)})`;
    const systemBody = superseded
      ? `${who} proposed a new appointment time: ${when} (replaces ${formatBookingTime(superseded.startAt)}). Awaiting confirmation.`
      : `${who} proposed an appointment: ${when}. Awaiting confirmation.`;
    // Notify the party who needs to act (the non-proposer).
    await postSystemMessage(id, systemBody, role === "trader" ? "customer" : "trader");

    const otherUserId = await otherPartyUserId(conv, role);
    if (otherUserId) {
      void sendPushToUser(otherUserId, {
        title: superseded ? "New appointment time proposed" : "Appointment proposed",
        body: `${when}${conv.serviceRequired ? ` — ${conv.serviceRequired}` : ""}. Tap to confirm.`,
        data: { type: "booking_proposed", conversationId: id, bookingId: created.id },
      }).catch((err) => req.log.warn({ err }, "Booking push failed"));
    }

    res.status(201).json({ booking: serializeBooking(created) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid booking", details: error.issues });
      return;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "23505"
    ) {
      res.status(409).json({
        error: "An appointment was just proposed by the other party. Refresh and try again.",
      });
      return;
    }
    req.log.error({ err: error }, "Propose booking failed");
    res.status(500).json({ error: "Failed to propose the appointment" });
  }
});

// POST /api/bookings/:id/confirm — only the OTHER party may confirm.
router.post("/bookings/:id/confirm", authMiddleware, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Invalid booking id" });
      return;
    }
    const { userId } = req as AuthenticatedRequest;
    const row = await loadBookingWithConversation(id);
    if (!row) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }
    const role = await participantRole(row.conv, userId);
    if (!role) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }
    if (role === row.booking.proposedByRole) {
      res.status(403).json({ error: "The other party needs to confirm this appointment." });
      return;
    }
    const closedReason = bookingClosedReason(row.conv);
    if (closedReason) {
      res.status(409).json({ error: closedReason });
      return;
    }

    // Re-check availability AT CONFIRMATION TIME: another conversation may
    // have taken the slot since this was proposed. Exclude this booking's own
    // conversation (its previous slot is being replaced by this confirm).
    const confirmDuration = row.booking.durationMinutes ?? DEFAULT_LEGACY_DURATION_MINUTES;
    // Also re-check working hours: the trader may have narrowed their hours
    // since the proposal was made.
    const [confirmTp] = await db
      .select({ workingHours: tpTable.workingHours })
      .from(tpTable)
      .where(eq(tpTable.id, row.conv.traderProfileId))
      .limit(1);
    if (!withinWorkingHours(confirmTp?.workingHours, row.booking.startAt, confirmDuration)) {
      res.status(409).json({
        error: "That time is now outside the trader's working hours. Please propose another appointment.",
        code: "SLOT_TAKEN",
      });
      return;
    }
    const confirmOccupied = (
      await occupiedIntervalsForTrader(row.conv.traderProfileId)
    ).filter((iv) => iv.conversationId !== row.conv.id);
    if (findConflict(confirmOccupied, row.booking.startAt, confirmDuration)) {
      res.status(409).json({ error: SLOT_CONFLICT_MESSAGE, code: "SLOT_TAKEN" });
      return;
    }

    // Conditional UPDATE = race-safe: only confirms while still PROPOSED.
    const now = new Date();
    const [updated] = await db
      .update(bookingsTable)
      .set({ status: "CONFIRMED", confirmedAt: now, confirmedByUserId: userId, updatedAt: now })
      .where(and(eq(bookingsTable.id, id), eq(bookingsTable.status, "PROPOSED")))
      .returning();
    if (!updated) {
      res.status(409).json({ error: "This appointment is no longer awaiting confirmation." });
      return;
    }

    const when = `${formatBookingTime(updated.startAt)} (${durationLabel(confirmDuration)})`;
    await postSystemMessage(
      row.conv.id,
      `Appointment confirmed: ${when}.`,
      row.booking.proposedByRole === "trader" ? "trader" : "customer",
    );

    // Push goes to the proposer (the confirmer already knows).
    void sendPushToUser(row.booking.proposedByUserId, {
      title: "Appointment confirmed",
      body: `${when}${row.conv.serviceRequired ? ` — ${row.conv.serviceRequired}` : ""}`,
      data: { type: "booking_confirmed", conversationId: row.conv.id, bookingId: updated.id },
    }).catch((err) => req.log.warn({ err }, "Booking push failed"));

    res.json({ booking: serializeBooking(updated) });
  } catch (error) {
    req.log.error({ err: error }, "Confirm booking failed");
    res.status(500).json({ error: "Failed to confirm the appointment" });
  }
});

// POST /api/bookings/:id/cancel — either party may cancel a live booking.
router.post("/bookings/:id/cancel", authMiddleware, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Invalid booking id" });
      return;
    }
    const { userId } = req as AuthenticatedRequest;
    const row = await loadBookingWithConversation(id);
    if (!row) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }
    const role = await participantRole(row.conv, userId);
    if (!role) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }
    // Same live-job gate as propose/confirm: no booking activity (or system
    // messages) may be appended once the job is cancelled/completed/closed.
    const closedReason = bookingClosedReason(row.conv);
    if (closedReason) {
      res.status(409).json({ error: closedReason });
      return;
    }

    const now = new Date();
    const [updated] = await db
      .update(bookingsTable)
      .set({ status: "CANCELLED", cancelledAt: now, cancelledByRole: role, updatedAt: now })
      .where(
        and(
          eq(bookingsTable.id, id),
          inArray(bookingsTable.status, ["PROPOSED", "CONFIRMED"]),
        ),
      )
      .returning();
    if (!updated) {
      res.status(409).json({ error: "This appointment has already been cancelled or replaced." });
      return;
    }

    const who = role === "trader" ? "The trader" : "The customer";
    const when = formatBookingTime(updated.startAt);
    // Notify only the opposite party — the canceller already knows.
    await postSystemMessage(
      row.conv.id,
      `${who} cancelled the appointment on ${when}.`,
      role === "trader" ? "customer" : "trader",
    );

    const otherUserId = await otherPartyUserId(row.conv, role);
    if (otherUserId) {
      void sendPushToUser(otherUserId, {
        title: "Appointment cancelled",
        body: `${when}${row.conv.serviceRequired ? ` — ${row.conv.serviceRequired}` : ""}`,
        data: { type: "booking_cancelled", conversationId: row.conv.id, bookingId: updated.id },
      }).catch((err) => req.log.warn({ err }, "Booking push failed"));
    }

    res.json({ booking: serializeBooking(updated) });
  } catch (error) {
    req.log.error({ err: error }, "Cancel booking failed");
    res.status(500).json({ error: "Failed to cancel the appointment" });
  }
});

// GET /api/conversations/:id/booking-slots?date=YYYY-MM-DD&durationMinutes=60
// Available start times for the conversation's trader on a UK-local date.
// Participant-only (same 404 policy as the other booking routes).
router.get("/conversations/:id/booking-slots", authMiddleware, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Invalid conversation id" });
      return;
    }
    const dateStr = String(req.query.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      res.status(400).json({ error: "Invalid date (expected YYYY-MM-DD)" });
      return;
    }
    const durationMinutes = Number.parseInt(String(req.query.durationMinutes ?? "60"), 10);
    if (!(ALLOWED_DURATIONS_MINUTES as readonly number[]).includes(durationMinutes)) {
      res.status(400).json({ error: "Invalid appointment duration" });
      return;
    }
    const { userId } = req as AuthenticatedRequest;
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id))
      .limit(1);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const role = await participantRole(conv, userId);
    if (!role) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const [tp] = await db
      .select({ workingHours: tpTable.workingHours })
      .from(tpTable)
      .where(eq(tpTable.id, conv.traderProfileId))
      .limit(1);
    // Exclude this conversation's own live booking — proposing/confirming a
    // new time replaces it, so its current slot shouldn't hide options.
    const occupied = (await occupiedIntervalsForTrader(conv.traderProfileId)).filter(
      (iv) => iv.conversationId !== id,
    );
    const slots = generateSlots({
      dateStr,
      workingHours: tp?.workingHours,
      durationMinutes,
      occupied,
    });
    res.json({
      date: dateStr,
      durationMinutes,
      slots: slots.map((s) => s.toISOString()),
      hasWorkingHours: !!(tp?.workingHours && Object.keys(tp.workingHours).length > 0),
    });
  } catch (error) {
    req.log.error({ err: error }, "Booking slots failed");
    res.status(500).json({ error: "Failed to load available times" });
  }
});

export default router;
