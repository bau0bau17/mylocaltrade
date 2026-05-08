import nodemailer from "nodemailer";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const FROM_NAME = "MyLocalTrade";
const FROM_EMAIL = process.env.SMTP_FROM ?? "noreply@mylocaltrade.co.uk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_CANDIDATES = [
  path.resolve(__dirname, "../assets/logo.png"),
  path.resolve(__dirname, "./assets/logo.png"),
  path.resolve(process.cwd(), "src/assets/logo.png"),
  path.resolve(process.cwd(), "dist/assets/logo.png"),
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

const LOGO_IMG_HTML = `<img src="cid:${LOGO_CID}" alt="MyLocalTrade" width="72" height="72" style="display: block; width: 72px; height: 72px; border-radius: 16px; margin: 0 auto;">`;

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

function getApiBaseUrl() {
  if (process.env.API_BASE_URL) return process.env.API_BASE_URL;
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (domain) return `https://${domain}`;
  return "http://localhost:8080";
}

export async function sendVerificationEmail(
  toEmail: string,
  toName: string,
  token: string
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

  const transporter = createTransport();
  if (transporter) {
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: toEmail,
      subject: "Verify your MyLocalTrade email address",
      html,
      attachments: [logoAttachment()],
    });
    console.log(`[email] Verification email sent to ${toEmail}`);
  } else {
    console.log(`[email] SMTP not configured — verification link for ${toEmail}:`);
    console.log(`[email] ${verifyUrl}`);
  }
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
      🚩 CONTACT SUPPORT — REPLY WITHIN 48 HOURS
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

  const transporter = createTransport();
  if (transporter) {
    await transporter.sendMail({
      from: `"MyLocalTrade Contact Form" <${CONTACT_FROM_EMAIL}>`,
      to: SUPPORT_EMAIL,
      replyTo: `"${opts.fromName}" <${opts.fromEmail}>`,
      subject: `[CONTACT - Reply within 48h] ${opts.subject}`,
      html,
      priority: "high",
      headers: {
        "X-Priority": "1",
        "X-MSMail-Priority": "High",
        Importance: "High",
        "X-MyLocalTrade-Type": "contact-support",
        "X-MyLocalTrade-SLA": "48h",
      },
      attachments: [logoAttachment()],
    });
    console.log(`[email] Contact email sent to ${SUPPORT_EMAIL} from ${CONTACT_FROM_EMAIL}`);
  } else {
    console.log(`[email] SMTP not configured — contact message from ${opts.fromEmail}: ${opts.message}`);
  }
}

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

  const transporter = createTransport();
  if (transporter) {
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: opts.toEmail,
      subject: `New enquiry: ${opts.serviceRequired}`,
      html,
      attachments: [logoAttachment()],
    });
    console.log(`[email] New-enquiry email sent to ${opts.toEmail}`);
  } else {
    console.log(`[email] SMTP not configured — new enquiry for ${opts.toEmail} from ${opts.customerName}`);
  }
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

  const transporter = createTransport();
  if (transporter) {
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: opts.toEmail,
      subject: `Unanswered lead from ${opts.customerName}`,
      html,
      // RFC 8058 one-click + RFC 2369 list headers so Gmail/Outlook surface
      // a native unsubscribe button alongside our footer link.
      headers: {
        "List-Unsubscribe": `<${opts.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      attachments: [logoAttachment()],
    });
    console.log(`[email] Lead-reminder email sent to ${opts.toEmail}`);
    return true;
  }
  console.log(`[email] SMTP not configured — lead reminder for ${opts.toEmail} from ${opts.customerName}`);
  return false;
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

  const transporter = createTransport();
  if (transporter) {
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: opts.toEmail,
      subject: `Document approved: ${opts.documentType}`,
      html,
      attachments: [logoAttachment()],
    });
    console.log(`[email] Document-approved email sent to ${opts.toEmail}`);
  } else {
    console.log(`[email] SMTP not configured — doc approved (${opts.documentType}) for ${opts.toEmail}`);
  }
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

  const transporter = createTransport();
  if (transporter) {
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: opts.toEmail,
      subject: `Action required: ${opts.documentType} not approved`,
      html,
      attachments: [logoAttachment()],
    });
    console.log(`[email] Document-rejected email sent to ${opts.toEmail}`);
  } else {
    console.log(`[email] SMTP not configured — doc rejected (${opts.documentType}) for ${opts.toEmail}: ${opts.reason}`);
  }
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

  const transporter = createTransport();
  if (transporter) {
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: opts.toEmail,
      subject: `New ${opts.rating}-star review on your profile`,
      html,
      attachments: [logoAttachment()],
    });
    console.log(`[email] Review-approved email sent to ${opts.toEmail}`);
  } else {
    console.log(`[email] SMTP not configured — review approved (${opts.rating}★) for ${opts.toEmail}`);
  }
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

  const transporter = createTransport();
  if (transporter) {
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: opts.toEmail,
      subject: `${opts.traderName} replied to your review`,
      html,
      attachments: [logoAttachment()],
    });
    console.log(`[email] Review-reply email sent to ${opts.toEmail}`);
  } else {
    console.log(`[email] SMTP not configured — reply notification for ${opts.toEmail} from ${opts.traderName}`);
  }
}

export async function sendTraderApprovedEmail(opts: {
  toEmail: string;
  toName: string;
  businessName?: string | null;
}): Promise<void> {
  const safeName = escapeHtml(opts.toName);
  const safeBusiness = opts.businessName ? escapeHtml(opts.businessName) : null;
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
      <p style="color: #E5E7EB; font-size: 15px; line-height: 1.6; margin: 0 0 12px;"><strong>Next steps</strong></p>
      <ul style="color: #E5E7EB; font-size: 14px; line-height: 1.7; margin: 0 0 20px; padding-left: 20px;">
        <li>Open the MyLocalTrade app and check your public profile</li>
        <li>Make sure your subscription is active so your profile stays visible</li>
        <li>Keep your insurance and qualification documents up to date — expired documents will hide your profile automatically</li>
      </ul>
      <p style="color: #9CA3AF; font-size: 13px; line-height: 1.6; margin: 0;">
        If you have any questions, reply to this email or contact us at support@mylocaltrade.co.uk.
      </p>`,
  });

  const transporter = createTransport();
  if (transporter) {
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: opts.toEmail,
      subject: "Your MyLocalTrade profile has been approved",
      html,
      attachments: [logoAttachment()],
    });
    console.log(`[email] Trader-approved email sent to ${opts.toEmail}`);
  } else {
    console.log(`[email] SMTP not configured — trader-approved notification for ${opts.toEmail}`);
  }
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

  const transporter = createTransport();
  if (transporter) {
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: opts.toEmail,
      subject: "Update on your MyLocalTrade application",
      html,
      attachments: [logoAttachment()],
    });
    console.log(`[email] Trader-rejected email sent to ${opts.toEmail}`);
  } else {
    console.log(`[email] SMTP not configured — trader-rejected notification for ${opts.toEmail}`);
  }
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

  const transporter = createTransport();
  if (transporter) {
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: opts.toEmail,
      subject: "More information needed for your MyLocalTrade application",
      html,
      attachments: [logoAttachment()],
    });
    console.log(`[email] Trader more-info email sent to ${opts.toEmail}`);
  } else {
    console.log(`[email] SMTP not configured — more-info notification for ${opts.toEmail}`);
  }
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

  const transporter = createTransport();
  if (transporter) {
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: opts.toEmail,
      subject,
      html,
      attachments: [logoAttachment()],
    });
    console.log(`[email] New-message email sent to ${opts.toEmail} (conv=${opts.conversationId})`);
  } else {
    console.log(`[email] SMTP not configured — new message for ${opts.toEmail} from ${opts.senderName}`);
  }
}

export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
