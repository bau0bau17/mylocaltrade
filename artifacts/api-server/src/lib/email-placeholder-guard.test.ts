import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isPlaceholderEmail,
  isNonDeliverableTestAddress,
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

  it("matches released-email placeholder addresses", () => {
    expect(
      isPlaceholderEmail("released-42-1700000000000@released.mylocaltrade.invalid"),
    ).toBe(true);
  });

  it("does not block normal user addresses", () => {
    expect(isPlaceholderEmail("jane.doe@gmail.com")).toBe(false);
    expect(isPlaceholderEmail("trader@my-invalid-business.co.uk")).toBe(false);
    // "invalid" appearing in the local part or as a non-TLD label is fine.
    expect(isPlaceholderEmail("invalid@example.com")).toBe(false);
    expect(isPlaceholderEmail("user@invalid.example.com")).toBe(false);
    expect(isPlaceholderEmail("user@notinvalid.co.uk")).toBe(false);
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
    // reaches its "no-transport would-send" log — proving the guards did not
    // interfere with a legitimate recipient.
    await sendAccountDeletionCompletedEmail({
      toEmail: "real.person@customer-mail.co.uk",
      toName: "Real Person",
    });
    expect(warn.mock.calls.some(([m]) => String(m).includes("skipped-placeholder"))).toBe(false);
    expect(warn.mock.calls.some(([m]) => String(m).includes("skipped-test-domain"))).toBe(false);
    expect(
      log.mock.calls.some(([m]) =>
        String(m).includes("would-send → real.person@customer-mail.co.uk"),
      ),
    ).toBe(true);
  });
});

describe("isNonDeliverableTestAddress", () => {
  it("matches RFC 2606/6761 reserved domains used by tests and fixtures", () => {
    expect(isNonDeliverableTestAddress("someone@example.com")).toBe(true);
    expect(isNonDeliverableTestAddress("someone@EXAMPLE.ORG")).toBe(true);
    expect(isNonDeliverableTestAddress("someone@sub.example.net")).toBe(true);
    expect(isNonDeliverableTestAddress("fixture@example.test")).toBe(true);
    expect(isNonDeliverableTestAddress("fixture@qa.mylocaltrade.test")).toBe(true);
    expect(isNonDeliverableTestAddress("dev@server.localhost")).toBe(true);
    expect(isNonDeliverableTestAddress("x@something.example")).toBe(true);
  });

  it("does not block real-looking addresses", () => {
    expect(isNonDeliverableTestAddress("jane.doe@gmail.com")).toBe(false);
    // "example"/"test" as part of a real label is fine.
    expect(isNonDeliverableTestAddress("info@exampleshop.co.uk")).toBe(false);
    expect(isNonDeliverableTestAddress("owner@test-plumbing.co.uk")).toBe(false);
    expect(isNonDeliverableTestAddress("hi@protest.org")).toBe(false);
  });
});

describe("dispatcher test-domain guard", () => {
  beforeEach(() => {
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

  it("suppresses sends to reserved test domains before any transport is tried", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await sendPasswordResetEmail("fixture@example.test", "Fixture", "123456");
    expect(result).toBe("skipped");
    expect(warn.mock.calls.some(([m]) => String(m).includes("skipped-test-domain"))).toBe(true);
    // No transport attempt (not even a would-send) was made.
    expect(log.mock.calls.some(([m]) => String(m).startsWith("[email]"))).toBe(false);
  });
});

describe("central sender identity", () => {
  beforeEach(() => {
    vi.stubEnv("BREVO_API_KEY_VERIFICATION", "test-api-key");
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_USER", "");
    vi.stubEnv("SMTP_PASS", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("password reset goes out as MyLocalTrade <noreply@mylocaltrade.co.uk> and never logs the code", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { body?: string }) => {
        calls.push({ url: String(url), body: JSON.parse(init?.body ?? "{}") });
        return new Response(JSON.stringify({ messageId: "test-message" }), { status: 201 });
      }),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendPasswordResetEmail("recipient@customer-mail.co.uk", "Jane", "123456");

    expect(result).toBe("brevo");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.brevo.com/v3/smtp/email");
    // Central sender identity: every transactional email goes through
    // dispatchEmail, which applies exactly this From unless a call site
    // overrides the name — the address itself comes from one shared constant.
    expect(calls[0].body.sender).toEqual({
      name: "MyLocalTrade",
      email: "noreply@mylocaltrade.co.uk",
    });
    expect(calls[0].body.to).toEqual([{ email: "recipient@customer-mail.co.uk", name: "Jane" }]);

    // The OTP must never leak into logs — only the tag + recipient line is
    // allowed on success.
    const allLoggedText = [...log.mock.calls, ...warn.mock.calls, ...error.mock.calls]
      .map((c) => c.map(String).join(" "))
      .join("\n");
    expect(allLoggedText).not.toContain("123456");
  });
});
