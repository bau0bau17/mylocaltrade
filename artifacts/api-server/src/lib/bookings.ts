import type { Booking } from "@workspace/db/schema";
import { DEFAULT_LEGACY_DURATION_MINUTES } from "./booking-availability";

/** Wire shape matching the OpenAPI Booking schema. */
export function serializeBooking(b: Booking) {
  const durationMinutes = b.durationMinutes ?? DEFAULT_LEGACY_DURATION_MINUTES;
  const endAt = b.endAt ?? new Date(b.startAt.getTime() + durationMinutes * 60000);
  return {
    id: b.id,
    conversationId: b.conversationId,
    startAt: b.startAt.toISOString(),
    durationMinutes,
    endAt: endAt.toISOString(),
    note: b.note,
    status: b.status,
    proposedByRole: b.proposedByRole,
    confirmedAt: b.confirmedAt ? b.confirmedAt.toISOString() : null,
    cancelledAt: b.cancelledAt ? b.cancelledAt.toISOString() : null,
    cancelledByRole: b.cancelledByRole,
    createdAt: b.createdAt.toISOString(),
  };
}

/**
 * UK-local rendering for system messages and notifications, e.g.
 * "Tue 4 Aug at 09:30". Server may run in UTC, so pin Europe/London —
 * appointments are physical visits at UK addresses.
 */
export function formatBookingTime(d: Date): string {
  const date = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
  return `${date} at ${time}`;
}
