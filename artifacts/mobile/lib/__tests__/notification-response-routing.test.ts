import {
  markNotificationResponseHandled,
  notificationDestination,
  notificationIsForUser,
  notificationResponseKey,
} from "../notification-response-routing";

describe("notification response routing", () => {
  it.each([
    ["new_message", 101],
    ["job_completed", 112],
    ["work_marked_complete", 113],
    ["review_invite", 114],
    ["quote_received", 102],
    ["quote_revised", "103"],
    ["quote_withdrawn", 104],
    ["quote_accepted", 105],
    ["quote_declined", 106],
    ["booking_proposed", 107],
    ["booking_confirmed", 108],
    ["booking_cancelled", 109],
    ["booking_reminder", 110],
    ["job_reassigned", 111],
  ])("routes %s to its existing authorised conversation screen", (type, conversationId) => {
    expect(notificationDestination({ type, conversationId })).toBe(
      `/messages/${Number(conversationId)}`,
    );
  });

  it.each([
    { type: "quote_received" },
    { type: "booking_confirmed", conversationId: "not-an-id" },
    { type: "job_reassigned", conversationId: 0 },
    { type: "new_message", conversationId: -2 },
  ])("falls back to Messages for malformed conversation-scoped payloads", (data) => {
    expect(notificationDestination(data)).toBe("/messages");
  });

  it("preserves appropriate existing dashboard destinations", () => {
    expect(notificationDestination({ type: "new_enquiry", conversationId: 20 })).toBe(
      "/trader-dashboard/leads",
    );
    expect(notificationDestination({ type: "lead_reminder" })).toBe("/trader-dashboard/leads");
    expect(notificationDestination({ type: "verification_update" })).toBe("/trader-dashboard");
    expect(notificationDestination({ type: "subscription_update" })).toBe(
      "/trader-dashboard/billing",
    );
  });

  it("leaves unknown or malformed notification data on the safe app root", () => {
    expect(notificationDestination({ type: "report_update" })).toBeNull();
    expect(notificationDestination({ type: "future_action", conversationId: 5 })).toBeNull();
    expect(notificationDestination(null)).toBeNull();
    expect(notificationDestination([])).toBeNull();
  });

  it("only accepts a response explicitly addressed to the current account", () => {
    expect(notificationIsForUser({ recipientUserId: 44 }, 44)).toBe(true);
    expect(notificationIsForUser({ recipientUserId: "44" }, 44)).toBe(true);
    expect(notificationIsForUser({ recipientUserId: 44 }, 45)).toBe(false);
    expect(notificationIsForUser({ recipientUserId: "not-an-id" }, 44)).toBe(false);
    // Legacy/unbound payloads must not navigate after an account switch.
    expect(notificationIsForUser({ type: "quote_received", conversationId: 9 }, 44)).toBe(false);
  });

  it("uses the Expo request identifier to suppress duplicate callbacks only", () => {
    const handled = new Set<string>();
    expect(notificationResponseKey(" notification-1 ")).toBe("notification-1");
    expect(markNotificationResponseHandled(handled, "notification-1")).toBe(true);
    expect(markNotificationResponseHandled(handled, "notification-1")).toBe(false);
    // A missing identifier remains routable; it must not suppress another
    // legitimate notification with similar payload content.
    expect(markNotificationResponseHandled(handled, undefined)).toBe(true);
  });
});