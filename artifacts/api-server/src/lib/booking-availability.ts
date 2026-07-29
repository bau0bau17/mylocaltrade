import { db } from "@workspace/db";
import { bookingsTable, conversationsTable } from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Structured trader availability + booking-conflict logic (single source).
//
// Rules (agreed product behaviour):
//  * BLOCKING intervals for a trader:
//      - CONFIRMED bookings whose interval is still in the future (or ongoing)
//      - the previously CONFIRMED slot of a conversation whose reschedule
//        proposal is still PENDING (live booking is PROPOSED and the most
//        recent superseded row had been confirmed) — the old slot stays
//        reserved until the reschedule is confirmed or declined.
//  * NOT blocking: PROPOSED (unconfirmed), CANCELLED, DECLINED/EXPIRED
//    equivalents, and any interval already fully in the past (a completed
//    job never blocks the trader's future calendar).
//  * Legacy bookings without a duration are treated as 60 minutes.
//  * All wall-clock reasoning is UK local time (Europe/London); storage is UTC.
// ---------------------------------------------------------------------------

export const ALLOWED_DURATIONS_MINUTES = [30, 60, 90, 120, 180, 240, 480] as const;
export type AllowedDuration = (typeof ALLOWED_DURATIONS_MINUTES)[number];

export const DEFAULT_LEGACY_DURATION_MINUTES = 60;

export function durationLabel(minutes: number): string {
  switch (minutes) {
    case 30: return "30 minutes";
    case 60: return "1 hour";
    case 90: return "1.5 hours";
    case 120: return "2 hours";
    case 180: return "3 hours";
    case 240: return "Half day";
    case 480: return "Full day";
    default: {
      if (minutes % 60 === 0) return `${minutes / 60} hours`;
      return `${minutes} minutes`;
    }
  }
}

export type WorkingHours = {
  [day in "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"]?: {
    enabled: boolean;
    start: string;
    end: string;
  };
};

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/** Validate a workingHours payload; returns an error string or null. */
export function validateWorkingHours(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return "Invalid working hours.";
  const allowedKeys = new Set(DAY_KEYS as readonly string[]);
  for (const [key, day] of Object.entries(value as Record<string, unknown>)) {
    if (!allowedKeys.has(key)) return `Unknown day "${key}" in working hours.`;
    if (day == null || typeof day !== "object") return "Invalid working hours.";
    const d = day as { enabled?: unknown; start?: unknown; end?: unknown };
    if (typeof d.enabled !== "boolean") return "Each day needs an enabled flag.";
    if (typeof d.start !== "string" || !HM_RE.test(d.start)) return "Times must be HH:MM (24h).";
    if (typeof d.end !== "string" || !HM_RE.test(d.end)) return "Times must be HH:MM (24h).";
    if (d.enabled && hmToMinutes(d.end) <= hmToMinutes(d.start)) {
      return "Each working day must end after it starts.";
    }
  }
  return null;
}

// --- UK local time helpers (no external tz library) -----------------------

const ukFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour12: false,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function ukParts(d: Date): { dayKey: (typeof DAY_KEYS)[number]; minutes: number; dateStr: string } {
  const parts = Object.fromEntries(
    ukFmt.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const dayKey = parts.weekday.slice(0, 3).toLowerCase() as (typeof DAY_KEYS)[number];
  // Intl can render midnight as "24"; normalise.
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  return {
    dayKey,
    minutes: hour * 60 + Number(parts.minute),
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/**
 * Convert a UK-local wall-clock time on a given date to a UTC instant.
 * Returns null for NONEXISTENT wall times (the spring-forward DST gap,
 * e.g. 01:30 on the last Sunday of March) — callers must skip/reject those.
 * Ambiguous fall-back times resolve to one consistent instant.
 */
export function ukLocalToUtc(dateStr: string, hm: string): Date | null {
  // Iterative correction handles the BST/GMT offset (and converges in ≤2
  // steps for any fixed-offset error, incl. across DST boundaries).
  let guess = new Date(`${dateStr}T${hm}:00Z`);
  const wantMinutes = hmToMinutes(hm);
  const diffOf = (d: Date): number => {
    const shown = ukParts(d);
    return (
      (Date.parse(`${shown.dateStr}T00:00:00Z`) - Date.parse(`${dateStr}T00:00:00Z`)) / 60000 +
      (shown.minutes - wantMinutes)
    );
  };
  for (let i = 0; i < 3; i++) {
    const diffMinutes = diffOf(guess);
    if (diffMinutes === 0) break;
    guess = new Date(guess.getTime() - diffMinutes * 60000);
  }
  // If the final guess still doesn't render as the requested wall time, the
  // local time doesn't exist on that date (DST spring-forward gap).
  return diffOf(guess) === 0 ? guess : null;
}

/**
 * Is the interval [start, end) fully inside the trader's configured working
 * window for that (UK local) day? When no structured hours are configured
 * (null / empty object), be permissive — legacy traders keep booking freely
 * until they configure hours.
 */
export function withinWorkingHours(
  workingHours: WorkingHours | null | undefined,
  start: Date,
  durationMinutes: number,
): boolean {
  if (!workingHours || Object.keys(workingHours).length === 0) return true;
  const s = ukParts(start);
  const day = workingHours[s.dayKey];
  if (!day || !day.enabled) return false;
  const startMin = s.minutes;
  const endMin = startMin + durationMinutes;
  return startMin >= hmToMinutes(day.start) && endMin <= hmToMinutes(day.end);
}

// --- Conflict detection ----------------------------------------------------

export interface OccupiedInterval {
  bookingId: number;
  conversationId: number;
  start: Date;
  end: Date;
}

function intervalEnd(startAt: Date, durationMinutes: number | null, endAt: Date | null): Date {
  if (endAt) return endAt;
  return new Date(startAt.getTime() + (durationMinutes ?? DEFAULT_LEGACY_DURATION_MINUTES) * 60000);
}

/**
 * All intervals that currently BLOCK new bookings for a trader profile.
 * Includes CONFIRMED bookings across every conversation of the profile, plus
 * the old confirmed slot of any conversation whose reschedule proposal is
 * still pending. Past intervals are dropped.
 */
export async function occupiedIntervalsForTrader(
  traderProfileId: number,
  opts: { excludeBookingId?: number } = {},
): Promise<OccupiedInterval[]> {
  const rows = await db
    .select({
      id: bookingsTable.id,
      conversationId: bookingsTable.conversationId,
      startAt: bookingsTable.startAt,
      durationMinutes: bookingsTable.durationMinutes,
      endAt: bookingsTable.endAt,
      status: bookingsTable.status,
      confirmedAt: bookingsTable.confirmedAt,
      updatedAt: bookingsTable.updatedAt,
    })
    .from(bookingsTable)
    .innerJoin(conversationsTable, eq(bookingsTable.conversationId, conversationsTable.id))
    .where(
      and(
        eq(conversationsTable.traderProfileId, traderProfileId),
        inArray(bookingsTable.status, ["CONFIRMED", "PROPOSED", "SUPERSEDED"]),
      ),
    );

  const now = Date.now();
  const out: OccupiedInterval[] = [];

  // Conversations that currently have a pending (PROPOSED) live booking —
  // their most recent previously-confirmed superseded slot stays blocked.
  const pendingConvIds = new Set(
    rows.filter((r) => r.status === "PROPOSED").map((r) => r.conversationId),
  );

  for (const r of rows) {
    if (opts.excludeBookingId && r.id === opts.excludeBookingId) continue;
    let blocks = false;
    if (r.status === "CONFIRMED") {
      blocks = true;
    } else if (
      r.status === "SUPERSEDED" &&
      r.confirmedAt != null &&
      pendingConvIds.has(r.conversationId)
    ) {
      // Only the LATEST confirmed superseded row per conversation matters.
      const latest = rows
        .filter(
          (x) =>
            x.conversationId === r.conversationId &&
            x.status === "SUPERSEDED" &&
            x.confirmedAt != null,
        )
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
      blocks = latest?.id === r.id;
    }
    if (!blocks) continue;
    const end = intervalEnd(r.startAt, r.durationMinutes, r.endAt);
    if (end.getTime() <= now) continue; // past interval never blocks
    out.push({ bookingId: r.id, conversationId: r.conversationId, start: r.startAt, end });
  }
  return out;
}

export function overlaps(aStart: Date, aEnd: Date, b: OccupiedInterval): boolean {
  return aStart.getTime() < b.end.getTime() && aEnd.getTime() > b.start.getTime();
}

export function findConflict(
  intervals: OccupiedInterval[],
  start: Date,
  durationMinutes: number,
): OccupiedInterval | null {
  const end = new Date(start.getTime() + durationMinutes * 60000);
  return intervals.find((iv) => overlaps(start, end, iv)) ?? null;
}

// --- Slot generation ---------------------------------------------------------

export const SLOT_STEP_MINUTES = 30;
// Permissive fallback window for traders without structured hours.
const FALLBACK_WINDOW = { start: "08:00", end: "18:00" };

/**
 * Generate available start times (UTC instants) for a UK-local date, given
 * the trader's working hours, the wanted duration, and current conflicts.
 */
export function generateSlots(opts: {
  dateStr: string; // "YYYY-MM-DD" (UK local)
  workingHours: WorkingHours | null | undefined;
  durationMinutes: number;
  occupied: OccupiedInterval[];
  now?: Date;
}): Date[] {
  const now = opts.now ?? new Date();
  const probe = ukLocalToUtc(opts.dateStr, "12:00");
  if (!probe) return []; // invalid date string
  const dayKey = ukParts(probe).dayKey;

  let windowStart: string;
  let windowEnd: string;
  if (opts.workingHours && Object.keys(opts.workingHours).length > 0) {
    const day = opts.workingHours[dayKey];
    if (!day || !day.enabled) return [];
    windowStart = day.start;
    windowEnd = day.end;
  } else {
    windowStart = FALLBACK_WINDOW.start;
    windowEnd = FALLBACK_WINDOW.end;
  }

  const startMin = hmToMinutes(windowStart);
  const endMin = hmToMinutes(windowEnd);
  const slots: Date[] = [];
  for (let m = startMin; m + opts.durationMinutes <= endMin; m += SLOT_STEP_MINUTES) {
    const hm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const start = ukLocalToUtc(opts.dateStr, hm);
    if (!start) continue; // nonexistent local time (DST spring-forward gap)
    if (start.getTime() <= now.getTime()) continue;
    if (findConflict(opts.occupied, start, opts.durationMinutes)) continue;
    slots.push(start);
  }
  return slots;
}

export const SLOT_CONFLICT_MESSAGE =
  "This time is no longer available. Please choose another appointment.";
