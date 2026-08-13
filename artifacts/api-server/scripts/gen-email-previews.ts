/**
 * Generate representative HTML previews of the branded email design system.
 *
 * Uses the test/preview capture hook, so NOTHING is sent — the exact
 * production renderer output is written to .local/email-previews/.
 *
 * Run from artifacts/api-server:  npx tsx scripts/gen-email-previews.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import {
  __setEmailCaptureHookForTests,
  type DispatchOpts,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendEarlyAccessConfirmationEmail,
  sendNewEnquiryEmail,
  sendEnquirySentToCustomerEmail,
  sendLeadReminderEmail,
  sendNewMessageEmail,
  sendTraderApprovedEmail,
  sendReviewInviteEmail,
  sendAccountDeletionReceivedEmail,
  sendCompanyInviteEmail,
  sendContactEmail,
} from "../src/lib/email";
import { renderCampaignEmail } from "../src/lib/early-access-campaigns";

const OUT_DIR = path.resolve(__dirname, "../../../.local/email-previews");

async function main() {
  const previews: Array<{ label: string; subject: string; html: string; text: string }> = [];
  let current: DispatchOpts | null = null;
  __setEmailCaptureHookForTests((opts) => {
    current = opts;
  });
  const grab = (label: string) => {
    if (!current) throw new Error(`no capture for ${label}`);
    previews.push({
      label,
      subject: current.subject,
      html: current.html,
      text: current.text ?? "",
    });
    current = null;
  };

  await sendVerificationEmail("preview@example.com", "Ana", "SAMPLE_TOKEN", "482913", 10);
  grab("1. Signup email verification (neutral + security note)");
  await sendPasswordResetEmail("preview@example.com", "Ana", "935174", 10);
  grab("2. Password reset OTP (neutral + security note)");
  await sendEarlyAccessConfirmationEmail({
    toEmail: "preview@example.com",
    toName: "Ana",
    confirmUrl: "https://mylocaltrade.co.uk/confirm-early-access?token=SAMPLE",
  });
  grab("2b. Early Access confirmation (neutral, double opt-in)");
  await sendNewEnquiryEmail({
    toEmail: "preview@example.com",
    toName: "Dan",
    customerName: "Ana Popescu",
    serviceRequired: "Boiler repair",
    message: "Hi, my boiler stopped working last night — no hot water. Could you take a look this week?",
    preferredDate: "Friday afternoon",
    specialistFields: { propertyType: "house", tenure: "owner", urgency: "urgent" },
  });
  grab("3. New lead / enquiry to trader (trader)");
  await sendEnquirySentToCustomerEmail({
    toEmail: "preview@example.com",
    toName: "Ana",
    traderBusinessName: "Dan's Plumbing & Heating",
    serviceRequired: "Boiler repair",
    message: "Hi, my boiler stopped working last night — no hot water. Could you take a look this week?",
  });
  grab("4. Enquiry receipt to customer (customer)");
  await sendLeadReminderEmail({
    toEmail: "preview@example.com",
    toName: "Dan",
    customerName: "Ana Popescu",
    serviceRequired: "Boiler repair",
    unsubscribeUrl: "https://mylocaltrade.co.uk/api/leads/reminders/unsubscribe?sig=SAMPLE",
    urgency: "urgent",
  });
  grab("5. Unanswered lead reminder (trader + unsubscribe)");
  await sendNewMessageEmail({
    toEmail: "preview@example.com",
    toName: "Ana",
    senderName: "Dan's Plumbing & Heating",
    senderRole: "trader",
    preview: "Morning Ana — I can come by Friday at 2pm to look at the boiler. Does that work for you?",
    conversationId: 42,
    serviceRequired: "Boiler repair",
  });
  grab("6. New message to customer (customer)");
  await sendTraderApprovedEmail({
    toEmail: "preview@example.com",
    toName: "Dan",
    businessName: "Dan's Plumbing & Heating",
    adminNotes: "Welcome aboard — great-looking profile!",
  });
  grab("7. Trader profile approved (trader)");
  await sendReviewInviteEmail({
    toEmail: "preview@example.com",
    toName: "Ana",
    businessName: "Dan's Plumbing & Heating",
    traderProfileId: 7,
    conversationId: 42,
  });
  grab("8. Review invite after completion (customer)");
  await sendAccountDeletionReceivedEmail({
    toEmail: "preview@example.com",
    toName: "Ana",
    reason: "Moving abroad",
  });
  grab("9. Account deletion received (neutral)");
  await sendCompanyInviteEmail({
    toEmail: "preview@example.com",
    businessName: "Dan's Plumbing & Heating",
    inviterName: "Dan Smith",
    token: "SAMPLE_TOKEN",
    expiresInDays: 7,
  });
  grab("10. Company team invite (neutral, pre-registration)");
  await sendContactEmail({
    fromName: "Ana Popescu",
    fromEmail: "preview@example.com",
    subject: "Question about verification",
    message: "Hello, how long does trader verification usually take?\n\nThanks!",
  });
  grab("11. Internal: contact-form forward (neutral, SLA banner)");

  const campaign = {
    type: "launch" as const,
    subject: "MyLocalTrade is live in your area",
    previewText: "Find trusted local tradespeople today",
    heading: "We're live!",
    bodyText:
      "MyLocalTrade is now live. Every trader on the platform goes through document checks before they appear in search.\n\nDownload the app to post your first job or grow your trade business.",
    ctaLabel: "Explore the app",
    ctaUrl: "https://mylocaltrade.co.uk/",
  };
  const ea = renderCampaignEmail(campaign, {
    greetingName: "Ana",
    unsubscribeUrl: "https://mylocaltrade.co.uk/unsubscribe?token=SAMPLE",
  });
  previews.push({ label: "12. Marketing campaign — Early Access (neutral)", subject: campaign.subject, ...ea });
  const outreach = renderCampaignEmail(campaign, {
    greetingName: "Dan",
    unsubscribeUrl: "https://mylocaltrade.co.uk/unsubscribe?token=SAMPLE",
    audience: "outreach",
    sourceNote: "your public business website",
  });
  previews.push({ label: "13. Marketing campaign — Outreach (trader + transparency)", subject: campaign.subject, ...outreach });

  __setEmailCaptureHookForTests(null);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cards = previews
    .map(
      (p) => `
    <section style="margin:0 0 48px;">
      <h2 style="font:600 16px system-ui;color:#e2e8f0;margin:0 0 4px;">${esc(p.label)}</h2>
      <p style="font:12px system-ui;color:#94a3b8;margin:0 0 10px;">Subject: ${esc(p.subject)}</p>
      <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;">
        <div>
          <p style="font:11px system-ui;color:#64748b;margin:0 0 4px;">Desktop (680px)</p>
          <iframe srcdoc="${p.html.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" style="width:680px;height:760px;border:1px solid #334155;border-radius:8px;background:#07111F;"></iframe>
        </div>
        <div>
          <p style="font:11px system-ui;color:#64748b;margin:0 0 4px;">Mobile (390px)</p>
          <iframe srcdoc="${p.html.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" style="width:390px;height:760px;border:1px solid #334155;border-radius:8px;background:#07111F;"></iframe>
        </div>
      </div>
      <details style="margin-top:8px;max-width:680px;"><summary style="font:12px system-ui;color:#94a3b8;cursor:pointer;">Plain-text version</summary><pre style="font:12px ui-monospace,monospace;color:#cbd5e1;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;white-space:pre-wrap;">${esc(p.text)}</pre></details>
    </section>`,
    )
    .join("\n");
  const gallery = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>MyLocalTrade — email design previews</title></head>
<body style="background:#020617;margin:0;padding:32px 24px;">
<h1 style="font:700 22px system-ui;color:#f8fafc;margin:0 0 4px;">MyLocalTrade — email design system previews</h1>
<p style="font:13px system-ui;color:#94a3b8;margin:0 0 32px;">Rendered by the exact production renderer via the capture hook. Nothing was sent.</p>
${cards}
</body></html>`;
  fs.writeFileSync(path.join(OUT_DIR, "email-design-previews.html"), gallery);
  console.log(`Wrote ${previews.length} previews to ${OUT_DIR}/email-design-previews.html`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
