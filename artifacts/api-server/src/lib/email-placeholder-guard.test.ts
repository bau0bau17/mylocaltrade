import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isPlaceholderEmail,
  sendAccountDeletionCompletedEmail,
  sendPasswordResetEmail,
  sendAccountDeletionReceivedEmail,
  sendLeadReminderEmail,
} from "./email";

// Central guard: no transactional email may ever be dispatched to a wiped
// placeholder address (`deleted-user-<id>@deleted.mylocaltrade.invalid`).
// The guard lives inside the shared dispatcher, so every send function is
// covered — these tests exercise it through representative account flows.

describe("isPlaceholderEmail", () => {
  it("matches the anonymised/deleted placeholder pattern", () => {
    expect(isPlaceholderEmail("deleted-user-42@deleted.mylocaltrade.invalid")).toBe(true);
  });

  it("matches regardless of case and surrounding whitespace", () => {
    expect(isPlaceholderEmail("  Deleted-User-7@Deleted.MyLocalTrade.INVALID ")).toBe(true);
  });

  it("matches any address under the reserved .invalid TLD", () => {
    expect(isPlaceholderEmail("someone@example.invalid")).toBe(true);
  });

  it("does not block normal user addresses", () => {
    expect(isPlaceholderEmail("jane.doe@gmail.com")).toBe(false);
    expect(isPlaceholderEmail("trader@my-invalid-business.co.uk")).toBe(false);
    // "invalid" appearing in the local part or as a non-TLD label is fine.
    expect(isPlaceholderEmail("invalid@example.com")).toBe(false);
    expect(isPlaceholderEmail("user@invalid.example.com")).toBe(false);
  });
});

describe("dispatcher placeholder guard", () => {
  beforeEach(() => {
    // Disable every real transport so these tests can never dispatch actual
    // mail — the dispatcher then falls through to its "would-send" log.
    vi.stubEnv("BREVO_API_KEY_VERIFICATION", "");
    vi.stubEnv("BREVO_API_KEY_NOTIFICATIONS", "");
    vi.stubEnv("BREVO_API_KEY_CONTACT", "");
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_USER", "");
    vi.stubEnv("SMTP_PASS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function spyLogs() {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    return { warn, log };
  }

  const PLACEHOLDER = "deleted-user-99@deleted.mylocaltrade.invalid";

  it("suppresses the deletion-completed email to a placeholder address", async () => {
    const { warn, log } = spyLogs();
    await sendAccountDeletionCompletedEmail({ toEmail: PLACEHOLDER, toName: "Deleted user #99" });
    expect(warn.mock.calls.some(([m]) => String(m).includes("skipped-placeholder"))).toBe(true);
    // No transport attempt of any kind was made.
    expect(log.mock.calls.some(([m]) => String(m).startsWith("[email]"))).toBe(false);
  });

  it("suppresses a password reset send to a placeholder address", async () => {
    const { warn, log } = spyLogs();
    const result = await sendPasswordResetEmail(PLACEHOLDER, "Deleted user #99", "123456");
    expect(result).toBe("skipped");
    expect(warn.mock.calls.some(([m]) => String(m).includes("skipped-placeholder"))).toBe(true);
    expect(log.mock.calls.some(([m]) => String(m).startsWith("[email]"))).toBe(false);
  });

  it("lead reminder to a placeholder address is skipped AND reported as not delivered", async () => {
    const { warn } = spyLogs();
    const delivered = await sendLeadReminderEmail({
      toEmail: PLACEHOLDER,
      toName: "Deleted user #99",
      customerName: "A Customer",
      serviceRequired: "Plumbing",
      unsubscribeUrl: "https://example.test/unsub",
    });
    expect(delivered).toBe(false);
    expect(warn.mock.calls.some(([m]) => String(m).includes("skipped-placeholder"))).toBe(true);
  });

  it("suppresses the deletion-received email to a placeholder address", async () => {
    const { warn } = spyLogs();
    await sendAccountDeletionReceivedEmail({ toEmail: PLACEHOLDER, toName: "Deleted user #99" });
    expect(warn.mock.calls.some(([m]) => String(m).includes("skipped-placeholder"))).toBe(true);
  });

  it("still processes a normal address (falls through to a real transport path)", async () => {
    const { warn, log } = spyLogs();
    // In the test environment no transport is configured, so the dispatcher
    // reaches its "no-transport would-send" log — proving the guard did not
    // interfere with a legitimate recipient.
    await sendAccountDeletionCompletedEmail({
      toEmail: "real.person@example.test",
      toName: "Real Person",
    });
    expect(warn.mock.calls.some(([m]) => String(m).includes("skipped-placeholder"))).toBe(false);
    expect(
      log.mock.calls.some(([m]) => String(m).includes("would-send → real.person@example.test")),
    ).toBe(true);
  });
});
