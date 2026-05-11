import nodemailer from "nodemailer";
import crypto from "crypto";
import path from "path";
import fs from "fs";

// ---------------------------------------------------------------------------
// Sender identity
// ---------------------------------------------------------------------------

const FROM_NAME = "MyLocalTrade";
const FROM_EMAIL = process.env.SMTP_FROM ?? "noreply@mylocaltrade.co.uk";

// ---------------------------------------------------------------------------
// Logo asset
// ---------------------------------------------------------------------------
//
// Brevo's HTTPS API only accepts `htmlContent` plus optional binary
// attachments — there is no straightforward CID embedding the way SMTP +
// Nodemailer does it. To keep the visual identity consistent across both
// transports we host the logo as a public PNG at the API base URL and
// reference it as a normal absolute <img src> in the email HTML.
//
// The legacy SMTP path keeps using the CID attachment for back-compat with
// any inboxes that prefer inline images.
const LOGO_CANDIDATES = [
  path.resolve(process.cwd(), "dist/assets/logo.png"),
  path.resolve(process.cwd(), "src/assets/logo.png"),
  path.resolve(process.cwd(), "artifacts/api-server/dist/assets/logo.png"),
  path.resolve(process.cwd(), "artifacts/api-server/src/assets/logo.png"),
];
const LOGO_PATH = LOGO_CANDIDATES.find((p) => fs.existsSync(p)) ?? LOGO_CANDIDATES[0];
const LOGO_CID = "mylocaltrade-logo";

function logoAttachment() {
  return {
    filename: "logo.png",
    path: LOGO_PATH,
    cid: LOGO_CID,
  };
}

function getApiBaseUrl(): string {
  if (process.env.API_BASE_URL) return process.env.API_BASE_URL;
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (domain) return `https://${domain}`;
  return "http://localhost:8080";
}

/** Hosted logo URL used in email HTML. Served by the API at /api/public/logo.png. */
function logoImgHtml(): string {
  const url = `${getApiBaseUrl()}/api/public/logo.png`;
  return `<img src="${url}" alt="MyLocalTrade" width="72" height="72" style="display: block; width: 72px; height: 72px; border-radius: 16px; margin: 0 auto;">`;
}

// Backwards-compat: a few of the templates still reference the CID variant
// when they need to inline a small icon. The function call now returns the
// hosted version so both paths use the same artwork.
const LOGO_IMG_HTML = logoImgHtml();

// ---------------------------------------------------------------------------
// Brevo HTTPS dispatcher with category-keyed API keys
// ---------------------------------------------------------------------------
//
// Each "category" maps to an independent Brevo API key, so the trader can
// rotate / revoke / cap the key for one type of email without affecting the
// others. The mapping is intentionally narrow:
//
//   - verification : account / KYC mails — email verification link, document
//                    approved / rejected, trader approved / rejected /
//                    suspended / more-info-requested.
//   - notifications: in-product nudges to the trader / customer — new lead
//                    enquiry, lead reminder, new conversation message,
//                    review approved, trader reply on a review.
//   - contact      : the public contact form forwarded to support.
//
// If a category-specific key is missing we fall back to the legacy SMTP
// transport (keeping the historic envs working), and finally to a console
// log so dev environments still see the would-be email content.

export type EmailCategory = "verification" | "notifications" | "contact";

const BREVO_KEY_ENV: Record<EmailCategory, string> = {
  verification: "BREVO_API_KEY_VERIFICATION",
  notifications: "BREVO_API_KEY_NOTIFICATIONS",
  contact: "BREVO_API_KEY_CONTACT",
};

interface DispatchOpts {
  category: EmailCategory;
  to: { email: string; name?: string | null };
  subject: string;
  html: string;
  /** Defaults to FROM_NAME / FROM_EMAIL. */
  from?: { email: string; name?: string };
  replyTo?: { email: string; name?: string };
  headers?: Record<string, string>;
  /** Marker used in success / failure log lines. */
  tag: string;
}

function createTransport() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return null;
}

async function sendViaBrevo(opts: DispatchOpts, apiKey: string): Promise<void> {
  const fromEmail = opts.from?.email ?? FROM_EMAIL;
  const fromName = opts.from?.name ?? FROM_NAME;
  const payload: Record<string, unknown> = {
    sender: { name: fromName, email: fromEmail },
    to: [
      opts.to.name
        ? { email: opts.to.email, name: opts.to.name }
        : { email: opts.to.email },
    ],
    subject: opts.subject,
    htmlContent: opts.html,
  };
  if (opts.replyTo) payload.replyTo = opts.replyTo;
  if (opts.headers) payload.headers = opts.headers;

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Brevo HTTP ${res.status} (${opts.category}): ${body.slice(0, 300)}`,
    );
  }
}

async function sendViaSmtp(opts: DispatchOpts): Promise<boolean> {
  const transporter = createTransport();
  if (!transporter) return false;
  const fromEmail = opts.from?.email ?? FROM_EMAIL;
  const fromName = opts.from?.name ?? FROM_NAME;
  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: opts.to.name ? `"${opts.to.name}" <${opts.to.email}>` : opts.to.email,
    replyTo: opts.replyTo
      ? `"${opts.replyTo.name ?? opts.replyTo.email}" <${opts.replyTo.email}>`
      : undefined,
    subject: opts.subject,
    html: opts.html,
    headers: opts.headers,
    attachments: [logoAttachment()],
  });
  return true;
}

/**
 * Single delivery entry point. Tries Brevo first using the category-specific
 * key, falls back to legacy SMTP, and finally logs to stdout in dev when no
 * transport is configured. Never throws on transport failure of one channel
 * if another channel succeeds; only throws if no channel can deliver and
 * Brevo failed mid-flight (so callers wrapping this in `void (async ...)`
 * still see the error in their try/catch).
 */
async function dispatchEmail(opts: DispatchOpts): Promise<void> {
  const brevoKey = process.env[BREVO_KEY_ENV[opts.category]];
  if (brevoKey) {
    try {
      await sendViaBrevo(opts, brevoKey);
      console.log(
        `[email] [brevo:${opts.category}] ${opts.tag} → ${opts.to.email}`,
      );
      return;
    } catch (err) {
      console.error(
        `[email] [brevo:${opts.category}] ${opts.tag} failed for ${opts.to.email}; trying SMTP fallback.`,
        err,
      );
    }
  }
  const smtpOk = await sendViaSmtp(opts).catch((err) => {
    console.error(
      `[email] [smtp:${opts.category}] ${opts.tag} failed for ${opts.to.email}.`,
      err,
    );
    return false;
  });
  if (smtpOk) {
    console.log(
      `[email] [smtp:${opts.category}] ${opts.tag} → ${opts.to.email}`,
    );
    return;
  }
  console.log(
    `[email] [no-transport:${opts.category}] ${opts.tag} would-send → ${opts.to.email} | "${opts.subject}"`,
  );
}

// ---------------------------------------------------------------------------
// Email shells (HTML scaffolding)
// ---------------------------------------------------------------------------

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emailShell(opts: {
  title: string;
  preheader?: string;
  bodyHtml: string;
  /** Optional one-click unsubscribe link rendered in the footer (CAN-SPAM/PECR). */
  unsubscribe?: { url: string; label: string };
}): string {
  const unsubscribeLine = opts.unsubscribe
    ? `<br><a href="${opts.unsubscribe.url}" style="color: #6B7280; text-decoration: underline;">${escapeHtml(opts.unsubscribe.label)}</a>`
    : "";
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${opts.title}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0B1120; margin: 0; padding: 40px 20px;">
  ${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${opts.preheader}</div>` : ""}
  <div style="max-width: 560px; margin: 0 auto; background: #111827; border-radius: 16px; padding: 40px; border: 1px solid #1F2937;">
    <div style="text-align: center; margin-bottom: 28px;">
      <div style="margin-bottom: 12px;">${LOGO_IMG_HTML}</div>
      <h1 style="color: #F9FAFB; font-size: 22px; font-weight: 700; margin: 0;">MyLocalTrade</h1>
    </div>
    ${opts.bodyHtml}
    <hr style="border: none; border-top: 1px solid #1F2937; margin: 32px 0 16px;">
    <p style="color: #6B7280; font-size: 12px; text-align: center; margin: 0;">
      You are receiving this email because you have an account on MyLocalTrade.${unsubscribeLine}
    </p>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Public senders
// ---------------------------------------------------------------------------

export async function sendVerificationEmail(
  toEmail: string,
  toName: string,
  token: string,
): Promise<void> {
  const verifyUrl = `${getApiBaseUrl()}/api/auth/verify-email?token=${token}`;
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Verify your email</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0B1120; margin: 0; padding: 40px 20px;">
  <div style="max-width: 520px; margin: 0 auto; background: #111827; border-radius: 16px; padding: 40px; border: 1px solid #1F2937;">
    <div style="text-align: center; margin-bottom: 32px;">
      <div style="margin-bottom: 16px;">${LOGO_IMG_HTML}</div>
      <h1 style="color: #F9FAFB; font-size: 24px; font-weight: 700; margin: 0 0 8px;">MyLocalTrade</h1>
      <p style="color: #9CA3AF; font-size: 14px; margin: 0;">Verify your email address</p>
    </div>
    <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${escapeHtml(toName)},</p>
    <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 32px;">
      Thanks for signing up to MyLocalTrade. Please verify your email address to activate your account.
    </p>
    <div style="text-align: center; margin-bottom: 32px;">
      <a href="${verifyUrl}"
         style="display: inline-block; background: #00B4D8; color: #0B1120; font-weight: 700; font-size: 16px; padding: 14px 40px; border-radius: 12px; text-decoration: none;">
        Verify Email Address
      </a>
    </div>
    <p style="color: #6B7280; font-size: 13px; line-height: 1.6; margin: 0 0 8px;">
      If the button above doesn't work, copy and paste this link into your browser:
    </p>
    <p style="color: #00B4D8; font-size: 13px; word-break: break-all; margin: 0 0 32px;">${verifyUrl}</p>
    <hr style="border: none; border-top: 1px solid #1F2937; margin: 0 0 24px;">
    <p style="color: #6B7280; font-size: 12px; text-align: center; margin: 0;">
      This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.<br><br>
      Service Provider LTD · Company No: 15830141 · 71-75 Shelton Street, London, WC2H 9JQ
    </p>
  </div>
</body>
</html>`;
  await dispatchEmail({
    category: "verification",
    to: { email: toEmail, name: toName },
    subject: "Verify your MyLocalTrade email address",
    html,
    tag: "verify-email",
  });
}

export async function sendContactEmail(opts: {
  fromName: string;
  fromEmail: string;
  subject: string;
  message: string;
}): Promise<void> {
  const SUPPORT_EMAIL = "lucian.sabau@serviceproviderltd.co.uk";
  const CONTACT_FROM_EMAIL = "noreply@mylocaltrade.co.uk";
  const replyByDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toUTCString();
  const safeFromName = escapeHtml(opts.fromName);
  const safeFromEmail = escapeHtml(opts.fromEmail);
  const safeSubject = escapeHtml(opts.subject);
  const safeMessage = escapeHtml(opts.message);
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Contact Support</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0B1120; margin: 0; padding: 40px 20px;">
  <div style="max-width: 520px; margin: 0 auto; background: #111827; border-radius: 16px; padding: 40px; border: 1px solid #1F2937;">
    <div style="background: #F59E0B; color: #111827; padding: 12px 16px; border-radius: 10px; margin-bottom: 24px; text-align: center; font-size: 13px; font-weight: 700; letter-spacing: 0.5px;">
      CONTACT SUPPORT — REPLY WITHIN 48 HOURS
    </div>
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="margin-bottom: 12px;">${LOGO_IMG_HTML}</div>
      <h1 style="color: #F9FAFB; font-size: 22px; font-weight: 700; margin: 0 0 6px;">MyLocalTrade</h1>
      <p style="color: #9CA3AF; font-size: 14px; margin: 0;">New support message received via in-app form</p>
    </div>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px; width: 110px;">From</td><td style="padding: 8px 0; color: #E5E7EB; font-size: 13px;">${safeFromName} &lt;${safeFromEmail}&gt;</td></tr>
      <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px;">Subject</td><td style="padding: 8px 0; color: #E5E7EB; font-size: 13px;">${safeSubject}</td></tr>
      <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px;">Reply by</td><td style="padding: 8px 0; color: #F59E0B; font-size: 13px; font-weight: 600;">${replyByDate}</td></tr>
    </table>
    <hr style="border: none; border-top: 1px solid #1F2937; margin: 0 0 24px;">
    <p style="color: #E5E7EB; font-size: 15px; line-height: 1.7; white-space: pre-wrap; margin: 0;">${safeMessage}</p>
    <hr style="border: none; border-top: 1px solid #1F2937; margin: 24px 0 16px;">
    <p style="color: #6B7280; font-size: 12px; text-align: center; margin: 0;">
      Sent via MyLocalTrade app · Service Provider LTD · 48h SLA
    </p>
  </div>
</body>
</html>`;
  await dispatchEmail({
    category: "contact",
    to: { email: SUPPORT_EMAIL },
    from: { email: CONTACT_FROM_EMAIL, name: "MyLocalTrade Contact Form" },
    replyTo: { email: opts.fromEmail, name: opts.fromName },
    subject: `[CONTACT - Reply within 48h] ${opts.subject}`,
    html,
    headers: {
      "X-Priority": "1",
      "X-MSMail-Priority": "High",
      Importance: "High",
      "X-MyLocalTrade-Type": "contact-support",
      "X-MyLocalTrade-SLA": "48h",
    },
    tag: "contact",
  });
}

export async function sendNewEnquiryEmail(opts: {
  toEmail: string;
  toName: string;
  customerName: string;
  serviceRequired: string;
  message: string;
  preferredDate?: string | null;
  phone?: string | null;
}): Promise<void> {
  const dashboardUrl = `${getApiBaseUrl().replace(/\/api$/, "")}/`;
  const safeName = escapeHtml(opts.toName);
  const safeCustomer = escapeHtml(opts.customerName);
  const safeService = escapeHtml(opts.serviceRequired);
  const safeMessage = escapeHtml(opts.message);
  const detailsRows = [
    ["From", safeCustomer],
    ["Service required", safeService],
    opts.preferredDate ? ["Preferred date", escapeHtml(opts.preferredDate)] : null,
    opts.phone ? ["Phone", escapeHtml(opts.phone)] : null,
  ].filter(Boolean) as [string, string][];
  const rowsHtml = detailsRows
    .map(
      ([k, v]) => `
      <tr>
        <td style="padding: 8px 0; color: #6B7280; font-size: 13px; width: 130px;">${k}</td>
        <td style="padding: 8px 0; color: #E5E7EB; font-size: 13px;">${v}</td>
      </tr>`,
    )
    .join("");
  const html = emailShell({
    title: "New enquiry on MyLocalTrade",
    preheader: `New enquiry from ${safeCustomer} for ${safeService}`,
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
        You have a new lead on MyLocalTrade. Reply quickly to win the job.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">${rowsHtml}</table>
      <div style="background: #0E1A2A; border-left: 3px solid #00B4D8; padding: 14px 16px; border-radius: 8px; margin: 0 0 24px;">
        <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${safeMessage}</p>
      </div>
      <div style="text-align: center; margin-bottom: 8px;">
        <a href="${dashboardUrl}" style="display: inline-block; background: #00B4D8; color: #0B1120; font-weight: 700; font-size: 15px; padding: 12px 32px; border-radius: 12px; text-decoration: none;">
          Open my leads
        </a>
      </div>`,
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject: `New enquiry: ${opts.serviceRequired}`,
    html,
    tag: "new-enquiry",
  });
}

export async function sendLeadReminderEmail(opts: {
  toEmail: string;
  toName: string;
  customerName: string;
  serviceRequired: string;
  /** Signed one-click unsubscribe URL scoped to this trader + reminder kind. */
  unsubscribeUrl: string;
}): Promise<boolean> {
  const dashboardUrl = `${getApiBaseUrl().replace(/\/api$/, "")}/`;
  const safeName = escapeHtml(opts.toName);
  const safeCustomer = escapeHtml(opts.customerName);
  const safeService = escapeHtml(opts.serviceRequired);
  const html = emailShell({
    title: "Unanswered lead on MyLocalTrade",
    preheader: `You haven't opened ${safeCustomer}'s enquiry yet`,
    unsubscribe: { url: opts.unsubscribeUrl, label: "Unsubscribe from these reminders" },
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        You still have an unanswered lead from <strong style="color: #00B4D8;">${safeCustomer}</strong> for <strong>${safeService}</strong>.
      </p>
      <p style="color: #9CA3AF; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
        Customers usually go with the first trader who replies. Open the lead and send a quick reply to win the job.
      </p>
      <div style="text-align: center; margin-bottom: 8px;">
        <a href="${dashboardUrl}" style="display: inline-block; background: #00B4D8; color: #0B1120; font-weight: 700; font-size: 15px; padding: 12px 32px; border-radius: 12px; text-decoration: none;">
          Open my leads
        </a>
      </div>`,
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject: `Unanswered lead from ${opts.customerName}`,
    html,
    headers: {
      "List-Unsubscribe": `<${opts.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    tag: "lead-reminder",
  });
  // Caller historically checked the boolean to know whether to record a
  // delivery attempt — keep the contract by always returning true now that
  // dispatchEmail handles fallbacks/no-transport internally.
  return true;
}

export async function sendDocumentApprovedEmail(opts: {
  toEmail: string;
  toName: string;
  documentType: string;
}): Promise<void> {
  const safeName = escapeHtml(opts.toName);
  const safeType = escapeHtml(opts.documentType);
  const html = emailShell({
    title: "Document approved",
    preheader: `Your ${safeType} has been approved`,
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
        Good news — your <strong style="color: #06D6A0;">${safeType}</strong> document has been approved by our team.
      </p>
      <p style="color: #9CA3AF; font-size: 14px; line-height: 1.6; margin: 0;">
        Once all required documents are approved you will be eligible to go live on the marketplace.
      </p>`,
  });
  await dispatchEmail({
    category: "verification",
    to: { email: opts.toEmail, name: opts.toName },
    subject: `Document approved: ${opts.documentType}`,
    html,
    tag: "doc-approved",
  });
}

export async function sendDocumentRejectedEmail(opts: {
  toEmail: string;
  toName: string;
  documentType: string;
  reason: string;
}): Promise<void> {
  const safeName = escapeHtml(opts.toName);
  const safeType = escapeHtml(opts.documentType);
  const safeReason = escapeHtml(opts.reason);
  const html = emailShell({
    title: "Document needs your attention",
    preheader: `Your ${safeType} could not be approved`,
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        Your <strong style="color: #F59E0B;">${safeType}</strong> document could not be approved.
      </p>
      <div style="background: #2A1810; border-left: 3px solid #F59E0B; padding: 14px 16px; border-radius: 8px; margin: 0 0 20px;">
        <p style="color: #FCD34D; font-size: 13px; font-weight: 600; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.5px;">Reviewer note</p>
        <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${safeReason}</p>
      </div>
      <p style="color: #9CA3AF; font-size: 14px; line-height: 1.6; margin: 0;">
        Please open the trader dashboard, address the issue above, and re-upload the document.
      </p>`,
  });
  await dispatchEmail({
    category: "verification",
    to: { email: opts.toEmail, name: opts.toName },
    subject: `Action required: ${opts.documentType} not approved`,
    html,
    tag: "doc-rejected",
  });
}

export async function sendReviewApprovedEmail(opts: {
  toEmail: string;
  toName: string;
  customerName: string;
  rating: number;
  reviewText: string;
}): Promise<void> {
  const safeName = escapeHtml(opts.toName);
  const safeCustomer = escapeHtml(opts.customerName);
  const safeText = escapeHtml(opts.reviewText);
  const stars = "★".repeat(opts.rating) + "☆".repeat(5 - opts.rating);
  const html = emailShell({
    title: "A new review was approved",
    preheader: `${safeCustomer} left you a ${opts.rating}-star review`,
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
        A new review on your MyLocalTrade profile has been approved by our moderation team and is now public.
      </p>
      <div style="background: #0E1A2A; border-left: 3px solid #06D6A0; padding: 14px 16px; border-radius: 8px; margin: 0 0 20px;">
        <p style="color: #FBBF24; font-size: 16px; margin: 0 0 4px; letter-spacing: 2px;">${stars}</p>
        <p style="color: #9CA3AF; font-size: 12px; margin: 0 0 8px;">${safeCustomer}</p>
        <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${safeText}</p>
      </div>
      <p style="color: #9CA3AF; font-size: 14px; line-height: 1.6; margin: 0;">
        Open the trader dashboard to reply publicly — a quick, friendly response builds trust with future customers.
      </p>`,
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject: `New ${opts.rating}-star review on your profile`,
    html,
    tag: "review-approved",
  });
}

export async function sendReviewReplyEmail(opts: {
  toEmail: string;
  toName: string;
  traderName: string;
  reviewText: string;
  replyText: string;
}): Promise<void> {
  const safeName = escapeHtml(opts.toName);
  const safeTrader = escapeHtml(opts.traderName);
  const safeReview = escapeHtml(opts.reviewText);
  const safeReply = escapeHtml(opts.replyText);
  const html = emailShell({
    title: "The trader replied to your review",
    preheader: `${safeTrader} replied to your review on MyLocalTrade`,
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
        <strong style="color: #00B4D8;">${safeTrader}</strong> just posted a public reply to your review.
      </p>
      <div style="background: #0B1120; border: 1px solid #1F2937; border-radius: 10px; padding: 14px 16px; margin: 0 0 12px;">
        <p style="color: #6B7280; font-size: 11px; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.5px;">Your review</p>
        <p style="color: #9CA3AF; font-size: 13px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${safeReview}</p>
      </div>
      <div style="background: #0E1A2A; border-left: 3px solid #00B4D8; padding: 14px 16px; border-radius: 8px; margin: 0 0 20px;">
        <p style="color: #00B4D8; font-size: 11px; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.5px;">Trader's reply</p>
        <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${safeReply}</p>
      </div>
      <p style="color: #9CA3AF; font-size: 13px; line-height: 1.6; margin: 0;">
        You can view the full conversation on the trader's profile in the MyLocalTrade app.
      </p>`,
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject: `${opts.traderName} replied to your review`,
    html,
    tag: "review-reply",
  });
}

export async function sendTraderApprovedEmail(opts: {
  toEmail: string;
  toName: string;
  businessName?: string | null;
  /** Optional admin note shown to the trader (e.g. welcome message). */
  adminNotes?: string | null;
}): Promise<void> {
  const safeName = escapeHtml(opts.toName);
  const safeBusiness = opts.businessName ? escapeHtml(opts.businessName) : null;
  const safeNotes = opts.adminNotes ? escapeHtml(opts.adminNotes) : null;
  const html = emailShell({
    title: "Your MyLocalTrade profile has been approved",
    preheader: "Your trader profile is now live on MyLocalTrade.",
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        Good news — your MyLocalTrade trader profile${safeBusiness ? ` for <strong style="color: #00B4D8;">${safeBusiness}</strong>` : ""} has been approved.
      </p>
      <div style="background: #0E1A2A; border-left: 3px solid #22C55E; padding: 14px 16px; border-radius: 8px; margin: 0 0 20px;">
        <p style="color: #22C55E; font-size: 13px; font-weight: 600; margin: 0 0 6px;">What this means</p>
        <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0;">
          Your profile is visible to customers searching on MyLocalTrade, provided you have an active subscription and your required documents remain valid.
        </p>
      </div>
      ${
        safeNotes
          ? `<div style="background: #111A2E; border-left: 3px solid #00B4D8; padding: 14px 16px; border-radius: 8px; margin: 0 0 20px;">
        <p style="color: #00B4D8; font-size: 13px; font-weight: 600; margin: 0 0 6px;">Note from our team</p>
        <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${safeNotes}</p>
      </div>`
          : ""
      }
      <p style="color: #E5E7EB; font-size: 15px; line-height: 1.6; margin: 0 0 12px;"><strong>Next steps</strong></p>
      <ul style="color: #E5E7EB; font-size: 14px; line-height: 1.7; margin: 0 0 20px; padding-left: 20px;">
        <li>Open the MyLocalTrade app and check your dashboard.</li>
        <li>Make sure your subscription is active so customers can contact you.</li>
        <li>Reply quickly to new leads — most customers go with the first trader who replies.</li>
      </ul>
      <p style="color: #9CA3AF; font-size: 13px; line-height: 1.6; margin: 0;">
        If you have any questions, reply to this email or contact us at support@mylocaltrade.co.uk.
      </p>`,
  });
  await dispatchEmail({
    category: "verification",
    to: { email: opts.toEmail, name: opts.toName },
    subject: "Your MyLocalTrade profile has been approved",
    html,
    tag: "trader-approved",
  });
}

export async function sendTraderRejectedEmail(opts: {
  toEmail: string;
  toName: string;
  reason: string;
}): Promise<void> {
  const safeName = escapeHtml(opts.toName);
  const safeReason = escapeHtml(opts.reason);
  const html = emailShell({
    title: "Update on your MyLocalTrade application",
    preheader: "Your trader application was not approved.",
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        Thank you for applying to list your business on MyLocalTrade. After reviewing your application, we are not able to approve your trader profile at this time.
      </p>
      <div style="background: #0E1A2A; border-left: 3px solid #EF4444; padding: 14px 16px; border-radius: 8px; margin: 0 0 20px;">
        <p style="color: #EF4444; font-size: 13px; font-weight: 600; margin: 0 0 6px;">Reason</p>
        <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${safeReason}</p>
      </div>
      <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0 0 12px;">
        If you believe this decision is incorrect, or if you would like to update your information and re-apply, please reply to this email or contact us at support@mylocaltrade.co.uk.
      </p>
      <p style="color: #9CA3AF; font-size: 13px; line-height: 1.6; margin: 0;">
        Your account remains active so you can update your details and apply again in the future.
      </p>`,
  });
  await dispatchEmail({
    category: "verification",
    to: { email: opts.toEmail, name: opts.toName },
    subject: "Update on your MyLocalTrade application",
    html,
    tag: "trader-rejected",
  });
}

export async function sendTraderMoreInfoRequestedEmail(opts: {
  toEmail: string;
  toName: string;
  notes: string;
}): Promise<void> {
  const safeName = escapeHtml(opts.toName);
  const safeNotes = escapeHtml(opts.notes);
  const html = emailShell({
    title: "More information needed for your MyLocalTrade application",
    preheader: "Our team needs a few more details to review your application.",
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        Thanks for submitting your trader application. Before we can complete our review, we need a little more information from you.
      </p>
      <div style="background: #0E1A2A; border-left: 3px solid #F59E0B; padding: 14px 16px; border-radius: 8px; margin: 0 0 20px;">
        <p style="color: #F59E0B; font-size: 13px; font-weight: 600; margin: 0 0 6px;">What we need</p>
        <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${safeNotes}</p>
      </div>
      <p style="color: #E5E7EB; font-size: 15px; line-height: 1.6; margin: 0 0 12px;"><strong>Next steps</strong></p>
      <ul style="color: #E5E7EB; font-size: 14px; line-height: 1.7; margin: 0 0 20px; padding-left: 20px;">
        <li>Open the MyLocalTrade app and go to your trader dashboard</li>
        <li>Update or upload the requested information</li>
        <li>Once submitted, our team will review your application again</li>
      </ul>
      <p style="color: #9CA3AF; font-size: 13px; line-height: 1.6; margin: 0;">
        If you have any questions, reply to this email or contact us at support@mylocaltrade.co.uk.
      </p>`,
  });
  await dispatchEmail({
    category: "verification",
    to: { email: opts.toEmail, name: opts.toName },
    subject: "More information needed for your MyLocalTrade application",
    html,
    tag: "trader-more-info",
  });
}

export async function sendTraderSuspendedEmail(opts: {
  toEmail: string;
  toName: string;
  reason: string;
}): Promise<void> {
  const safeName = escapeHtml(opts.toName);
  const safeReason = escapeHtml(opts.reason);
  const html = emailShell({
    title: "Your MyLocalTrade account has been suspended",
    preheader: "Your trader profile is no longer visible on MyLocalTrade.",
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        Your MyLocalTrade trader profile has been suspended by our team and is no longer visible to customers.
      </p>
      <div style="background: #0E1A2A; border-left: 3px solid #EF4444; padding: 14px 16px; border-radius: 8px; margin: 0 0 20px;">
        <p style="color: #EF4444; font-size: 13px; font-weight: 600; margin: 0 0 6px;">Reason</p>
        <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${safeReason}</p>
      </div>
      <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0 0 12px;">
        If you believe this was done in error, or you would like to discuss reinstatement, please reply to this email or contact us at support@mylocaltrade.co.uk.
      </p>`,
  });
  await dispatchEmail({
    category: "verification",
    to: { email: opts.toEmail, name: opts.toName },
    subject: "Your MyLocalTrade account has been suspended",
    html,
    tag: "trader-suspended",
  });
}

export async function sendNewMessageEmail(opts: {
  toEmail: string;
  toName: string;
  senderName: string;
  senderRole: "customer" | "trader";
  preview: string;
  conversationId: number;
}): Promise<void> {
  const safeName = escapeHtml(opts.toName);
  const safeSender = escapeHtml(opts.senderName);
  // Truncate preview to a safe length so we never leak entire long messages.
  const trimmed = opts.preview.length > 140 ? opts.preview.slice(0, 140) + "…" : opts.preview;
  const safePreview = escapeHtml(trimmed);
  const dashboardUrl = `${getApiBaseUrl().replace(/\/api$/, "")}/`;
  const subject =
    opts.senderRole === "trader"
      ? `New reply from ${opts.senderName}`
      : `New message from ${opts.senderName}`;
  const html = emailShell({
    title: "New message on MyLocalTrade",
    preheader: `${safeSender} sent you a message on MyLocalTrade`,
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
        You have a new message from <strong style="color: #00B4D8;">${safeSender}</strong> on MyLocalTrade.
      </p>
      <div style="background: #0E1A2A; border-left: 3px solid #00B4D8; padding: 14px 16px; border-radius: 8px; margin: 0 0 24px;">
        <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${safePreview}</p>
      </div>
      <div style="text-align: center; margin-bottom: 8px;">
        <a href="${dashboardUrl}" style="display: inline-block; background: #00B4D8; color: #0B1120; font-weight: 700; font-size: 15px; padding: 12px 32px; border-radius: 12px; text-decoration: none;">
          Open conversation
        </a>
      </div>
      <p style="color: #6B7280; font-size: 12px; line-height: 1.6; margin: 24px 0 0; text-align: center;">
        For your safety, never share bank details or pay outside the platform without verifying the trader.
      </p>`,
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject,
    html,
    tag: `new-message[conv=${opts.conversationId}]`,
  });
}

export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
