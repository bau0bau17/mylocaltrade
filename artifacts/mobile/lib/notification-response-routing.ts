/**
 * Pure routing rules for notification taps. These deliberately choose an
 * existing screen only; the destination screen/API remains responsible for
 * authorising the current account before displaying any conversation data.
 */

export type NotificationDestination =
  | `/messages/${number}`
  | "/messages"
  | "/trader-dashboard/leads"
  | "/trader-dashboard"
  | "/trader-dashboard/billing"
  | null;

const CONVERSATION_NOTIFICATION_TYPES = new Set([
  "new_message",
  "job_completed",
  "work_marked_complete",
  "review_invite",
  "quote_received",
  "quote_revised",
  "quote_withdrawn",
  "quote_accepted",
  "quote_declined",
  "booking_proposed",
  "booking_confirmed",
  "booking_cancelled",
  "booking_reminder",
  "job_reassigned",
]);

function asPositiveSafeInteger(value: unknown): number | null {
  const text =
    typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
  if (!/^[1-9]\d*$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Returns a safe existing destination for known notification payloads. Unknown
 * payloads intentionally return null, leaving Expo Router on its normal home
 * route rather than guessing at a protected screen.
 */
export function notificationDestination(data: unknown): NotificationDestination {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const payload = data as Record<string, unknown>;
  const type = typeof payload.type === "string" ? payload.type : "";

  if (CONVERSATION_NOTIFICATION_TYPES.has(type)) {
    const conversationId = asPositiveSafeInteger(payload.conversationId);
    return conversationId ? `/messages/${conversationId}` : "/messages";
  }

  // These trader notifications already have useful dashboard destinations.
  // Keep them there instead of changing a working notification contract.
  if (type === "new_enquiry" || type === "lead_reminder") {
    return "/trader-dashboard/leads";
  }
  if (type === "verification_update") return "/trader-dashboard";
  if (type === "subscription_update") return "/trader-dashboard/billing";

  // report_update has no report-status route. Unknown future types are equally
  // conservative: opening the app root is safer than a speculative deep link.
  return null;
}

/**
 * Expo assigns every notification request an identifier. Use it as the
 * idempotency key so a cold-start response and its warm listener echo cannot
 * push the same screen twice. If a runtime omits the identifier, do not invent
 * a lossy payload fingerprint that could suppress a distinct new notification.
 */
export function notificationResponseKey(identifier: unknown): string | null {
  if (typeof identifier !== "string") return null;
  const trimmed = identifier.trim();
  return trimmed ? trimmed : null;
}

/**
 * Every server-dispatched push is bound to its intended user. A token can move
 * between accounts on a shared device, so conversation IDs alone are never
 * enough to decide that the active account should navigate.
 */
export function notificationIsForUser(data: unknown, userId: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const recipientUserId = asPositiveSafeInteger(
    (data as Record<string, unknown>).recipientUserId,
  );
  return recipientUserId != null && recipientUserId === asPositiveSafeInteger(userId);
}

export function markNotificationResponseHandled(
  handled: Set<string>,
  identifier: unknown,
): boolean {
  const key = notificationResponseKey(identifier);
  if (!key) return true;
  if (handled.has(key)) return false;
  handled.add(key);
  return true;
}