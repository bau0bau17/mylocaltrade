import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  __setEmailCaptureHookForTests,
  type DispatchOpts,
  sendVerificationEmail,
  sendPhoneVerificationCodeEmail,
  sendPasswordResetEmail,
  sendBusinessEmailVerificationEmail,
  sendContactEmail,
  sendEarlyAccessNotificationEmail,
  sendEarlyAccessConfirmationEmail,
  sendNewEnquiryEmail,
  sendEnquirySentToCustomerEmail,
  sendLeadReminderEmail,
  sendDocumentRejectedEmail,
  sendReviewApprovedEmail,
  sendReviewReplyEmail,
  sendTraderApprovedEmail,
  sendTraderRevalidationDueEmail,
  sendTraderRevalidationOverdueEmail,
  sendAdminRevalidationAlertEmail,
  sendAdminCancellationRequestEmail,
  sendTraderRejectedEmail,
  sendTraderMoreInfoRequestedEmail,
  sendTraderSuspendedEmail,
  sendNewMessageEmail,
  sendWorkMarkedCompleteEmail,
  sendReviewInviteEmail,
  sendAccountDeletionReceivedEmail,
  sendAccountDeletionCancelledEmail,
  sendAccountDeletionCompletedEmail,
  sendAdminAccountDeletionAlertEmail,
  sendCompanyInviteEmail,
  getEmailLogoUrl,
} from "./email";
import {
  renderBrandedEmail,
  VARIANT_TAGLINES,
  SECURITY_NOTE_COPY,
  COMPANY_IDENTITY_LINE,
  escapeEmailHtml,
} from "./email-shell";
import { renderCampaignEmail } from "./early-access-campaigns";

// ---------------------------------------------------------------------------
// Shared email design system — every sender must render through the branded
// table-based shell with the correct server-selected audience variant, a
// complete plain-text alternative, and the right footer/unsubscribe policy.
//
// The capture hook intercepts the fully rendered payload inside
// dispatchEmail BEFORE any transport is consulted, so these tests can never
// hit Brevo/SMTP (and recipient addresses use RFC 2606 reserved domains as a
// second line of defence).
// ---------------------------------------------------------------------------

const TRADER_TAG = VARIANT_TAGLINES.trader[0];
const CUSTOMER_TAG = VARIANT_TAGLINES.customer[0];
const NEUTRAL_TAG = VARIANT_TAGLINES.neutral[0];

let captured: DispatchOpts[] = [];

beforeEach(() => {
  captured = [];
  __setEmailCaptureHookForTests((opts) => captured.push(opts));
});

afterEach(() => {
  __setEmailCaptureHookForTests(null);
});

function last(): DispatchOpts {
  expect(captured.length).toBeGreaterThan(0);
  return captured[captured.length - 1];
}

function expectVariant(opts: DispatchOpts, variant: "neutral" | "trader" | "customer") {
  const [line1, line2] = VARIANT_TAGLINES[variant];
  expect(opts.html).toContain(escapeEmailHtml(line1));
  expect(opts.html).toContain(escapeEmailHtml(line2));
  expect(opts.text).toContain(line1);
  // No cross-audience footers: exactly one tagline family present.
  for (const other of ["neutral", "trader", "customer"] as const) {
    if (other === variant) continue;
    expect(opts.html).not.toContain(escapeEmailHtml(VARIANT_TAGLINES[other][0]));
  }
}

function expectBaseShell(opts: DispatchOpts) {
  // Table-based dark shell with the brand palette.
  expect(opts.html).toContain("#07111F");
  expect(opts.html).toContain("#0F1B2D");
  expect(opts.html).toContain("#12B8D4");
  expect(opts.html).toContain('role="presentation"');
  // Hosted logo with fixed dimensions + alt text (works when images blocked).
  expect(opts.html).toContain(`src="${getEmailLogoUrl()}"`);
  expect(opts.html).toContain('alt="MyLocalTrade logo"');
  expect(getEmailLogoUrl()).toMatch(/^https?:\/\/.+\/api\/public\/logo\.png$/);
  // Complete plain-text alternative.
  expect(opts.text).toBeTruthy();
  expect((opts.text ?? "").length).toBeGreaterThan(40);
  expect(opts.text).toContain("MyLocalTrade");
  // No JS / web fonts / gradients.
  expect(opts.html).not.toMatch(/<script/i);
  expect(opts.html).not.toMatch(/@import|fonts\.googleapis/i);
  expect(opts.html).not.toMatch(/linear-gradient/i);
}

describe("every email type renders through the shared shell", () => {
  it("renders all senders with html + complete text", async () => {
    await sendVerificationEmail("u@example.com", "Ana", "tok123", "482913", 10);
    await sendPhoneVerificationCodeEmail("u@example.com", "Ana", "111222", 10);
    await sendPasswordResetEmail("u@example.com", "Ana", "333444", 10);
    await sendBusinessEmailVerificationEmail("b@example.com", "Dan", "Dan's Plumbing", "tok456");
    await sendContactEmail({ fromName: "Ana", fromEmail: "u@example.com", subject: "Help", message: "My issue" });
    await sendEarlyAccessNotificationEmail({ name: "Ana", email: "u@example.com", type: "customer", town: "Leeds", message: "Hi" });
    await sendEarlyAccessConfirmationEmail({ toEmail: "u@example.com", toName: "Ana", confirmUrl: "https://mylocaltrade.co.uk/confirm?token=abc" });
    await sendNewEnquiryEmail({ toEmail: "t@example.com", toName: "Dan", customerName: "Ana", serviceRequired: "Boiler repair", message: "Boiler is broken", specialistFields: { urgency: "urgent" } });
    await sendEnquirySentToCustomerEmail({ toEmail: "u@example.com", toName: "Ana", traderBusinessName: "Dan's Plumbing", serviceRequired: "Boiler repair", message: "Boiler is broken" });
    await sendLeadReminderEmail({ toEmail: "t@example.com", toName: "Dan", customerName: "Ana", serviceRequired: "Boiler repair", unsubscribeUrl: "https://mylocaltrade.co.uk/unsub?x=1", urgency: "urgent" });
    await sendDocumentRejectedEmail({ toEmail: "t@example.com", toName: "Dan", documentType: "Public liability insurance", reason: "Blurry photo" });
    await sendReviewApprovedEmail({ toEmail: "t@example.com", toName: "Dan", customerName: "Ana", rating: 5, reviewText: "Great job" });
    await sendReviewReplyEmail({ toEmail: "u@example.com", toName: "Ana", traderName: "Dan's Plumbing", reviewText: "Great job", replyText: "Thanks!" });
    await sendTraderApprovedEmail({ toEmail: "t@example.com", toName: "Dan", businessName: "Dan's Plumbing" });
    await sendTraderRevalidationDueEmail({ toEmail: "t@example.com", toName: "Dan", businessName: "Dan's Plumbing", graceDays: 14 });
    await sendTraderRevalidationOverdueEmail({ toEmail: "t@example.com", toName: "Dan", businessName: "Dan's Plumbing" });
    await sendAdminRevalidationAlertEmail({ traderEmail: "t@example.com", traderName: "Dan", businessName: "Dan's Plumbing", stage: "overdue" });
    await sendAdminCancellationRequestEmail({ traderEmail: "t@example.com", traderName: "Dan", provider: "apple", withinCoolingOff: true });
    await sendTraderRejectedEmail({ toEmail: "t@example.com", toName: "Dan", reason: "Incomplete application" });
    await sendTraderMoreInfoRequestedEmail({ toEmail: "t@example.com", toName: "Dan", notes: "Please add insurance" });
    await sendTraderSuspendedEmail({ toEmail: "t@example.com", toName: "Dan", reason: "Policy breach" });
    await sendNewMessageEmail({ toEmail: "t@example.com", toName: "Dan", senderName: "Ana", senderRole: "customer", preview: "Hello", conversationId: 5 });
    await sendWorkMarkedCompleteEmail({ toEmail: "u@example.com", toName: "Ana", businessName: "Dan's Plumbing", conversationId: 5 });
    await sendReviewInviteEmail({ toEmail: "u@example.com", toName: "Ana", businessName: "Dan's Plumbing", traderProfileId: 1, conversationId: 5 });
    await sendAccountDeletionReceivedEmail({ toEmail: "u@example.com", toName: "Ana", reason: "moving" });
    await sendAccountDeletionCancelledEmail({ toEmail: "u@example.com", toName: "Ana" });
    await sendAccountDeletionCompletedEmail({ toEmail: "u@example.com", toName: "Ana" });
    await sendAdminAccountDeletionAlertEmail({ userEmail: "u@example.com", userFullName: "Ana", userRole: "customer" });
    await sendCompanyInviteEmail({ toEmail: "e@example.com", businessName: "Dan's Plumbing", inviterName: "Dan", token: "rawtok", expiresInDays: 7 });

    expect(captured.length).toBe(29);
    for (const opts of captured) {
      expectBaseShell(opts);
    }
  });
});

describe("role → variant mapping (server-side only)", () => {
  it("trader-facing emails use the trader footer", async () => {
    await sendNewEnquiryEmail({ toEmail: "t@example.com", toName: "Dan", customerName: "Ana", serviceRequired: "Tiling", message: "Hi" });
    expectVariant(last(), "trader");
    await sendTraderApprovedEmail({ toEmail: "t@example.com", toName: "Dan" });
    expectVariant(last(), "trader");
    await sendDocumentRejectedEmail({ toEmail: "t@example.com", toName: "Dan", documentType: "ID", reason: "x" });
    expectVariant(last(), "trader");
  });

  it("customer-facing emails use the customer footer", async () => {
    await sendEnquirySentToCustomerEmail({ toEmail: "u@example.com", toName: "Ana", traderBusinessName: "B", serviceRequired: "S", message: "m" });
    expectVariant(last(), "customer");
    await sendReviewInviteEmail({ toEmail: "u@example.com", toName: "Ana", businessName: "B", traderProfileId: 1, conversationId: 2 });
    expectVariant(last(), "customer");
  });

  it("new-message variant follows the RECIPIENT side of the conversation", async () => {
    await sendNewMessageEmail({ toEmail: "t@example.com", toName: "Dan", senderName: "Ana", senderRole: "customer", preview: "p", conversationId: 1 });
    expectVariant(last(), "trader");
    await sendNewMessageEmail({ toEmail: "u@example.com", toName: "Ana", senderName: "Dan", senderRole: "trader", preview: "p", conversationId: 1 });
    expectVariant(last(), "customer");
  });

  it("unknown/mixed audiences fall back to neutral", async () => {
    await sendCompanyInviteEmail({ toEmail: "e@example.com", businessName: "B", inviterName: "Dan", token: "t", expiresInDays: 7 });
    expectVariant(last(), "neutral");
    await sendAccountDeletionReceivedEmail({ toEmail: "u@example.com", toName: "Ana" });
    expectVariant(last(), "neutral");
    await sendVerificationEmail("u@example.com", "Ana", "tok", "123456");
    expectVariant(last(), "neutral");
    await sendContactEmail({ fromName: "A", fromEmail: "u@example.com", subject: "s", message: "m" });
    expectVariant(last(), "neutral");
  });

  it("renderBrandedEmail renders exactly the requested variant", () => {
    const { html } = renderBrandedEmail({
      variant: "neutral",
      heading: "H",
      blocks: [{ kind: "paragraph", text: "p" }],
      logoUrl: "https://x.test/logo.png",
      footer: {},
    });
    expect(html).toContain(NEUTRAL_TAG);
    expect(html).not.toContain(TRADER_TAG);
    expect(html).not.toContain(CUSTOMER_TAG);
  });
});

describe("codes, expiry and security copy", () => {
  it("OTP emails show the code, the expiry, and the security note (html + text)", async () => {
    await sendPasswordResetEmail("u@example.com", "Ana", "987654", 15);
    const opts = last();
    expect(opts.html).toContain("987654");
    expect(opts.html).toContain("expires in 15 minutes");
    expect(opts.html).toContain(escapeEmailHtml(SECURITY_NOTE_COPY));
    expect(opts.text).toContain("987654");
    expect(opts.text).toContain("expires in 15 minutes");
    expect(opts.text).toContain(SECURITY_NOTE_COPY);
  });

  it("signup verification includes code + browser fallback link", async () => {
    await sendVerificationEmail("u@example.com", "Ana", "tok999", "135790", 10);
    const opts = last();
    expect(opts.html).toContain("135790");
    expect(opts.html).toContain("verify-email?token=tok999");
    expect(opts.text).toContain("135790");
    expect(opts.text).toContain("verify-email?token=tok999");
  });
});

describe("unsubscribe policy", () => {
  it("strictly transactional/security emails carry no unsubscribe", async () => {
    await sendPasswordResetEmail("u@example.com", "Ana", "111111", 10);
    expect(last().html.toLowerCase()).not.toContain("unsubscribe");
    await sendVerificationEmail("u@example.com", "Ana", "t", "222222");
    expect(last().html.toLowerCase()).not.toContain("unsubscribe");
    await sendCompanyInviteEmail({ toEmail: "e@example.com", businessName: "B", inviterName: "D", token: "t", expiresInDays: 7 });
    expect(last().html.toLowerCase()).not.toContain("unsubscribe");
  });

  it("lead reminder keeps its scoped unsubscribe link + List-Unsubscribe headers and returns delivery boolean", async () => {
    const ok = await sendLeadReminderEmail({
      toEmail: "t@example.com",
      toName: "Dan",
      customerName: "Ana",
      serviceRequired: "Tiling",
      unsubscribeUrl: "https://mylocaltrade.co.uk/unsub?sig=abc",
    });
    expect(ok).toBe(true);
    const opts = last();
    expect(opts.html).toContain("https://mylocaltrade.co.uk/unsub?sig=abc");
    expect(opts.text).toContain("https://mylocaltrade.co.uk/unsub?sig=abc");
    expect(opts.headers?.["List-Unsubscribe"]).toBe("<https://mylocaltrade.co.uk/unsub?sig=abc>");
    expect(opts.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("internal admin alerts keep reply-to/diagnostics and carry no unsubscribe", async () => {
    await sendContactEmail({ fromName: "Ana", fromEmail: "ana@example.com", subject: "Help", message: "m" });
    const opts = last();
    expect(opts.replyTo?.email).toBe("ana@example.com");
    expect(opts.headers?.["X-MyLocalTrade-SLA"]).toBe("48h");
    expect(opts.html.toLowerCase()).not.toContain("unsubscribe");
  });
});

describe("marketing campaign renderer", () => {
  const campaign = {
    type: "launch" as const,
    subject: "We're live",
    previewText: "MyLocalTrade is live",
    heading: "We're live!",
    bodyText: "First paragraph.\n\nSecond paragraph.",
    ctaLabel: "Explore the app",
    ctaUrl: "https://mylocaltrade.co.uk/?utm=x",
  };

  it("includes unsubscribe, privacy, contact and legal identity (html + text)", () => {
    const { html, text } = renderCampaignEmail(campaign, {
      greetingName: "Ana",
      unsubscribeUrl: "https://mylocaltrade.co.uk/unsubscribe?token=T",
    });
    expect(html).toContain("https://mylocaltrade.co.uk/unsubscribe?token=T");
    expect(html).toContain("privacy-policy");
    expect(html).toContain("Contact us");
    expect(html).toContain("Company No: 15830141");
    expect(text).toContain("https://mylocaltrade.co.uk/unsubscribe?token=T");
    expect(text).toContain("privacy-policy");
    expect(text).toContain(COMPANY_IDENTITY_LINE);
  });

  it("keeps Brevo merge tags unescaped in bulk mode", () => {
    const { html } = renderCampaignEmail(campaign, { brevoMergeTags: true });
    expect(html).toContain('{{ contact.FIRSTNAME | default : "there" }}');
    expect(html).toContain("{{ contact.EA_UNSUB_TOKEN }}");
    expect(html).toContain("{{ unsubscribe }}");
  });

  it("early access audience → neutral footer; outreach → trader footer + transparency block", () => {
    const ea = renderCampaignEmail(campaign, { greetingName: "Ana", unsubscribeUrl: "https://x.co/u" });
    expect(ea.html).toContain(NEUTRAL_TAG);
    expect(ea.html).not.toContain(TRADER_TAG);
    const outreach = renderCampaignEmail(campaign, {
      greetingName: "Ana",
      unsubscribeUrl: "https://x.co/u",
      audience: "outreach",
      sourceNote: "your public website",
    });
    expect(outreach.html).toContain(TRADER_TAG);
    expect(outreach.html).toContain("We obtained your business contact details from: your public website");
    expect(outreach.html).toContain("right to object");
    expect(outreach.text).toContain("right to object");
  });

  it("test sends carry the TEST banner; renderer is deterministic (preview === send)", () => {
    const t = renderCampaignEmail(campaign, { greetingName: "Ana", isTest: true, unsubscribeUrl: "https://x.co/u" });
    expect(t.html).toContain("TEST EMAIL");
    expect(t.text).toContain("[TEST EMAIL]");
    const a = renderCampaignEmail(campaign, { greetingName: "Ana", unsubscribeUrl: "https://x.co/u" });
    const b = renderCampaignEmail(campaign, { greetingName: "Ana", unsubscribeUrl: "https://x.co/u" });
    expect(a.html).toBe(b.html);
    expect(a.text).toBe(b.text);
  });

  it("escapes admin-entered content (no HTML injection)", () => {
    const { html } = renderCampaignEmail(
      { ...campaign, heading: "<script>alert(1)</script>", bodyText: "<img src=x onerror=y>" },
      { greetingName: "Ana", unsubscribeUrl: "https://x.co/u" },
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=y>");
  });
});

describe("URLs and deliverability details", () => {
  it("CTA links are absolute and on the expected hosts", async () => {
    await sendNewEnquiryEmail({ toEmail: "t@example.com", toName: "Dan", customerName: "Ana", serviceRequired: "S", message: "m" });
    const html = last().html;
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^https?:\/\//);
    }
  });

  it("preheader is present and hidden", async () => {
    await sendReviewInviteEmail({ toEmail: "u@example.com", toName: "Ana", businessName: "B", traderProfileId: 1, conversationId: 2 });
    expect(last().html).toContain("display: none; max-height: 0;");
  });

  it("user-supplied values are escaped in transactional emails", async () => {
    await sendNewMessageEmail({
      toEmail: "t@example.com",
      toName: "Dan",
      senderName: "<b>Ana</b>",
      senderRole: "customer",
      preview: "<script>x</script>",
      conversationId: 9,
    });
    const html = last().html;
    expect(html).not.toContain("<b>Ana</b>");
    expect(html).not.toContain("<script>x</script>");
  });
});

describe("capture hook is hard-disabled in production", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("setting the hook under NODE_ENV=production throws", () => {
    process.env.NODE_ENV = "production";
    expect(() => __setEmailCaptureHookForTests(() => {})).toThrow(
      /disabled in production/,
    );
  });

  it("a hook set earlier cannot intercept dispatch once NODE_ENV flips to production", async () => {
    // Hook was installed by beforeEach (non-production). Flip the env and
    // prove the dispatcher ignores it — the normal reserved-test-domain guard
    // takes over instead of the hook's short-circuit.
    process.env.NODE_ENV = "production";
    await sendReviewInviteEmail({
      toEmail: "guard-check@example.test",
      toName: "Ana",
      businessName: "B",
      traderProfileId: 1,
      conversationId: 2,
    });
    expect(captured.length).toBe(0);
  });
});
