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

/**
 * Sanitise a user-supplied string for safe use in email headers (Subject,
 * recipient names, etc). Strips CR/LF and other control characters that
 * could enable RFC 5322 header injection in the SMTP fallback path,
 * collapses whitespace, and caps length so a single long field cannot
 * blow out the subject line. Returns an empty string for nullish input.
 */
function sanitizeHeaderValue(value: string | null | undefined, maxLen = 120): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\r\n\t\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
  return stripped.length > maxLen ? stripped.slice(0, maxLen) : stripped;
}

function getApiBaseUrl(): string {
  if (process.env.API_BASE_URL) return process.env.API_BASE_URL;
  // Replit deployments expose the live public domain(s) via REPLIT_DOMAINS
  // (comma separated); the dev container exposes REPLIT_DEV_DOMAIN. Prefer the
  // deployment domain so verification / confirmation email links resolve in
  // production instead of silently falling back to localhost (which would make
  // every "verify your email" link dead for real users).
  const prodDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (prodDomain) return `https://${prodDomain}`;
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) return `https://${devDomain}`;
  return "http://localhost:8080";
}

/**
 * Base URL used for `/open?...` deep-link bounce pages in emails.
 *
 * iOS Universal Links only fire when the link's host matches one of the app's
 * associated domains (mylocaltrade.co.uk / www.mylocaltrade.co.uk). If we link
 * to a *.replit.app host instead, Mail always opens the browser first. So:
 * prefer an explicit UNIVERSAL_LINK_BASE_URL, then any REPLIT_DOMAINS entry
 * that matches the associated domain, then fall back to the API base (custom
 * scheme bounce page still works there — just via the browser hop).
 */
const ASSOCIATED_LINK_HOSTS = ["mylocaltrade.co.uk", "www.mylocaltrade.co.uk"];
function getOpenLinkBase(): string {
  const explicit = process.env.UNIVERSAL_LINK_BASE_URL?.trim().replace(/\/$/, "");
  if (explicit) {
    // Only honour the override when it actually points at an associated
    // domain — otherwise a misconfigured env would silently break Universal
    // Links (browser hop) for every email CTA.
    try {
      const host = new URL(explicit).hostname.toLowerCase();
      if (ASSOCIATED_LINK_HOSTS.includes(host)) return explicit;
      console.warn(
        `[email] UNIVERSAL_LINK_BASE_URL host "${host}" is not an associated domain; ignoring override`,
      );
    } catch {
      console.warn("[email] UNIVERSAL_LINK_BASE_URL is not a valid URL; ignoring override");
    }
  }
  const domains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const associated = domains.find((d) => ASSOCIATED_LINK_HOSTS.includes(d.toLowerCase()));
  if (associated) return `https://${associated}`;
  return getApiBaseUrl().replace(/\/api$/, "");
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
  /** Optional plain-text alternative. Improves deliverability for transactional mail. */
  text?: string;
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
    // Disable Brevo's click-tracking: it rewrites every href to a tracking
    // host (e.g. clicks.brevo.com/...) which defeats iOS Universal Links —
    // the rewritten host is not in associatedDomains, so iOS opens Safari
    // instead of the installed app.
    trackClicks: false,
  };
  if (opts.text) payload.textContent = opts.text;
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
    text: opts.text,
    headers: opts.headers,
    attachments: [logoAttachment()],
  });
  return true;
}

/**
 * Single delivery entry point. Tries Brevo first using the category-specific
 * key, falls back to legacy SMTP, and finally logs to stdout when no
 * transport is configured. Returns the channel that actually delivered the
 * message (or `"none"` when nothing was sent) so callers — for example the
 * lead-reminder retry logic in `lib/lead-reminders.ts` — can keep accurate
 * delivery state.
 */
async function dispatchEmail(opts: DispatchOpts): Promise<"brevo" | "smtp" | "none"> {
  const brevoKey = process.env[BREVO_KEY_ENV[opts.category]];
  if (brevoKey) {
    try {
      await sendViaBrevo(opts, brevoKey);
      console.log(
        `[email] [brevo:${opts.category}] ${opts.tag} → ${opts.to.email}`,
      );
      return "brevo";
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
    return "smtp";
  }
  console.log(
    `[email] [no-transport:${opts.category}] ${opts.tag} would-send → ${opts.to.email} | "${opts.subject}"`,
  );
  return "none";
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
  code: string,
  codeExpiresInMinutes = 10,
): Promise<void> {
  const verifyUrl = `${getApiBaseUrl()}/api/auth/verify-email?token=${token}`;
  const safeCode = escapeHtml(code);
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
    <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
      Thanks for signing up to MyLocalTrade. Enter the code below in the app to verify your email address and activate your account.
    </p>
    <div style="text-align: center; margin: 0 0 12px;">
      <div style="display: inline-block; background: #0B1120; border: 1px solid #1F2937; border-radius: 12px; padding: 18px 32px;">
        <span style="color: #00B4D8; font-size: 32px; font-weight: 700; letter-spacing: 8px; font-family: 'Courier New', monospace;">${safeCode}</span>
      </div>
    </div>
    <p style="color: #9CA3AF; font-size: 13px; text-align: center; line-height: 1.6; margin: 0 0 32px;">
      This code expires in ${codeExpiresInMinutes} minutes.
    </p>
    <hr style="border: none; border-top: 1px solid #1F2937; margin: 0 0 24px;">
    <p style="color: #6B7280; font-size: 13px; line-height: 1.6; margin: 0 0 16px;">
      Not using the app? You can verify in your browser instead:
    </p>
    <div style="text-align: center; margin-bottom: 24px;">
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
      The verification link expires in 24 hours. If you didn't create an account, you can safely ignore this email.<br><br>
      Service Provider LTD · Company No: 15830141 · 71-75 Shelton Street, London, WC2H 9JQ
    </p>
  </div>
</body>
</html>`;
  const text = `Hi ${toName},

Thanks for signing up to MyLocalTrade. Enter this code in the app to verify your email address and activate your account:

${code}

This code expires in ${codeExpiresInMinutes} minutes.

Not using the app? You can verify in your browser instead:
${verifyUrl}

The verification link expires in 24 hours. If you didn't create an account, you can safely ignore this email.

Service Provider LTD · Company No: 15830141 · 71-75 Shelton Street, London, WC2H 9JQ`;
  await dispatchEmail({
    category: "verification",
    to: { email: toEmail, name: toName },
    subject: "Verify your MyLocalTrade email address",
    html,
    text,
    tag: "verify-email",
  });
}

export async function sendPhoneVerificationCodeEmail(
  toEmail: string,
  toName: string,
  code: string,
  expiresInMinutes = 10,
): Promise<"brevo" | "smtp" | "none"> {
  const safeName = escapeHtml(toName || "there");
  const safeCode = escapeHtml(code);
  const html = emailShell({
    title: "Your phone verification code",
    preheader: `Your MyLocalTrade verification code is ${safeCode}`,
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
        Use the code below to verify your phone number on MyLocalTrade.
      </p>
      <div style="text-align: center; margin: 0 0 24px;">
        <div style="display: inline-block; background: #0B1120; border: 1px solid #1F2937; border-radius: 12px; padding: 18px 32px;">
          <span style="color: #00B4D8; font-size: 32px; font-weight: 700; letter-spacing: 8px; font-family: 'Courier New', monospace;">${safeCode}</span>
        </div>
      </div>
      <p style="color: #9CA3AF; font-size: 14px; line-height: 1.6; margin: 0;">
        This code expires in ${expiresInMinutes} minutes. If you didn't request it, you can safely ignore this email.
      </p>`,
  });
  const text = `Hi ${toName || "there"},

Use this code to verify your phone number on MyLocalTrade:

${code}

This code expires in ${expiresInMinutes} minutes. If you didn't request it, you can safely ignore this email.`;
  return dispatchEmail({
    category: "verification",
    to: { email: toEmail, name: toName },
    subject: "Your MyLocalTrade verification code",
    html,
    text,
    tag: "phone-otp",
  });
}

export async function sendPasswordResetEmail(
  toEmail: string,
  toName: string,
  code: string,
  expiresInMinutes = 10,
): Promise<"brevo" | "smtp" | "none"> {
  const safeName = escapeHtml(toName || "there");
  const safeCode = escapeHtml(code);
  const html = emailShell({
    title: "Your password reset code",
    preheader: `Your MyLocalTrade password reset code is ${safeCode}`,
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
        We received a request to reset your MyLocalTrade password. Enter the code below in the app to choose a new password.
      </p>
      <div style="text-align: center; margin: 0 0 24px;">
        <div style="display: inline-block; background: #0B1120; border: 1px solid #1F2937; border-radius: 12px; padding: 18px 32px;">
          <span style="color: #00B4D8; font-size: 32px; font-weight: 700; letter-spacing: 8px; font-family: 'Courier New', monospace;">${safeCode}</span>
        </div>
      </div>
      <p style="color: #9CA3AF; font-size: 14px; line-height: 1.6; margin: 0;">
        This code expires in ${expiresInMinutes} minutes. If you didn't request a password reset, you can safely ignore this email — your password will not be changed.
      </p>`,
  });
  const text = `Hi ${toName || "there"},

We received a request to reset your MyLocalTrade password. Enter this code in the app to choose a new password:

${code}

This code expires in ${expiresInMinutes} minutes. If you didn't request a password reset, you can safely ignore this email — your password will not be changed.`;
  return dispatchEmail({
    category: "verification",
    to: { email: toEmail, name: toName },
    subject: "Your MyLocalTrade password reset code",
    html,
    text,
    tag: "password-reset",
  });
}

export async function sendBusinessEmailVerificationEmail(
  toEmail: string,
  toName: string,
  businessName: string,
  token: string,
): Promise<void> {
  const verifyUrl = `${getApiBaseUrl()}/api/profile/business-email/confirm?token=${token}`;
  const safeName = escapeHtml(toName || "there");
  const safeBusiness = escapeHtml(businessName);
  const safeAddress = escapeHtml(toEmail);
  const html = emailShell({
    title: "Confirm your business email address",
    preheader: `Confirm ${safeAddress} for ${safeBusiness} on MyLocalTrade`,
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        Please confirm that <strong style="color: #00B4D8;">${safeAddress}</strong> is a working
        business email address for <strong>${safeBusiness}</strong>. Confirming it adds a trust
        signal to your MyLocalTrade profile.
      </p>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${verifyUrl}" style="display: inline-block; background: #00B4D8; color: #0B1120; font-weight: 700; font-size: 16px; padding: 14px 40px; border-radius: 12px; text-decoration: none;">
          Confirm this email address
        </a>
      </div>
      <p style="color: #6B7280; font-size: 13px; line-height: 1.6; margin: 0 0 8px;">
        If the button above doesn't work, copy and paste this link into your browser:
      </p>
      <p style="color: #00B4D8; font-size: 13px; word-break: break-all; margin: 0 0 8px;">${verifyUrl}</p>
      <p style="color: #6B7280; font-size: 13px; line-height: 1.6; margin: 0;">
        This link expires in 24 hours. If you didn't request this, you can safely ignore this email.
      </p>`,
  });
  const text = `Hi ${toName || "there"},

Please confirm that ${toEmail} is a working business email address for ${businessName}. Confirming it adds a trust signal to your MyLocalTrade profile.

Confirm this email address:
${verifyUrl}

This link expires in 24 hours. If you didn't request this, you can safely ignore this email.`;
  await dispatchEmail({
    category: "verification",
    to: { email: toEmail, name: toName },
    subject: "Confirm your business email address — MyLocalTrade",
    html,
    text,
    tag: "business-email-verify",
  });
}

export async function sendContactEmail(opts: {
  fromName: string;
  fromEmail: string;
  subject: string;
  message: string;
}): Promise<void> {
  const SUPPORT_EMAIL = "contact@serviceproviderltd.co.uk";
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
    subject: `[CONTACT - Reply within 48h] ${sanitizeHeaderValue(opts.subject)}`,
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

const ENQUIRY_PROPERTY_TYPE_LABELS: Record<string, string> = {
  house: "House",
  flat: "Flat",
  commercial: "Commercial",
  other: "Other",
};
const ENQUIRY_TENURE_LABELS: Record<string, string> = {
  owner: "Owner",
  tenant: "Tenant",
  landlord: "Landlord",
  leaseholder: "Leaseholder",
};
const ENQUIRY_URGENCY_LABELS: Record<string, string> = {
  routine: "No rush",
  soon: "Within a month",
  urgent: "ASAP",
};

export async function sendNewEnquiryEmail(opts: {
  toEmail: string;
  toName: string;
  customerName: string;
  serviceRequired: string;
  message: string;
  preferredDate?: string | null;
  phone?: string | null;
  specialistFields?: {
    propertyType?: string | null;
    tenure?: string | null;
    urgency?: string | null;
  } | null;
}): Promise<void> {
  // Deep-link bounce: opens the installed app at the trader's leads screen,
  // with an install fallback for users without the app.
  const dashboardUrl = `${getOpenLinkBase()}/open?t=leads`;
  const safeName = escapeHtml(opts.toName);
  const safeCustomer = escapeHtml(opts.customerName);
  const safeService = escapeHtml(opts.serviceRequired);
  const safeMessage = escapeHtml(opts.message);
  const sf = opts.specialistFields ?? null;
  const propertyTypeLabel = sf?.propertyType
    ? ENQUIRY_PROPERTY_TYPE_LABELS[sf.propertyType] ?? sf.propertyType
    : null;
  const tenureLabel = sf?.tenure
    ? ENQUIRY_TENURE_LABELS[sf.tenure] ?? sf.tenure
    : null;
  const urgencyLabel = sf?.urgency
    ? ENQUIRY_URGENCY_LABELS[sf.urgency] ?? sf.urgency
    : null;
  const detailsRows = [
    ["From", safeCustomer],
    ["Service required", safeService],
    urgencyLabel ? ["Urgency", escapeHtml(urgencyLabel)] : null,
    propertyTypeLabel ? ["Property type", escapeHtml(propertyTypeLabel)] : null,
    tenureLabel ? ["Customer is", escapeHtml(tenureLabel)] : null,
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
    subject: `New enquiry: ${sanitizeHeaderValue(opts.serviceRequired)}`,
    html,
    tag: "new-enquiry",
  });
}

export async function sendEnquirySentToCustomerEmail(opts: {
  toEmail: string;
  toName: string | null;
  traderBusinessName: string;
  serviceRequired: string;
  message: string;
}): Promise<void> {
  const safeName = escapeHtml(opts.toName || "there");
  const safeTrader = escapeHtml(opts.traderBusinessName);
  const safeService = escapeHtml(opts.serviceRequired);
  const safeMessage = escapeHtml(opts.message);
  const html = emailShell({
    title: "Your enquiry has been sent",
    preheader: `We've sent your enquiry to ${safeTrader}`,
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        Thanks for using MyLocalTrade. We've sent your enquiry to
        <strong style="color: #00B4D8;">${safeTrader}</strong> for
        <strong>${safeService}</strong>.
      </p>
      <p style="color: #9CA3AF; font-size: 14px; line-height: 1.6; margin: 0 0 20px;">
        Most verified traders reply within a day. You'll get a notification as soon as they respond, and you can chat with them directly in the app.
      </p>
      <div style="background: #0E1A2A; border-left: 3px solid #00B4D8; padding: 14px 16px; border-radius: 8px; margin: 0 0 20px;">
        <p style="color: #9CA3AF; font-size: 12px; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.4px;">Your message</p>
        <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${safeMessage}</p>
      </div>
      <p style="color: #9CA3AF; font-size: 13px; line-height: 1.6; margin: 0 0 8px;">
        For your safety, please keep all conversation inside MyLocalTrade until you're confident in the trader. Never share your bank details, and don't pay for or deposit against any work before it's agreed.
      </p>`,
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName ?? undefined },
    subject: `We've sent your enquiry to ${sanitizeHeaderValue(opts.traderBusinessName)}`,
    html,
    tag: "enquiry-sent-customer",
  });
}

export async function sendLeadReminderEmail(opts: {
  toEmail: string;
  toName: string;
  customerName: string;
  serviceRequired: string;
  /** Signed one-click unsubscribe URL scoped to this trader + reminder kind. */
  unsubscribeUrl: string;
  /** Optional urgency captured on the original enquiry. When "urgent" we
   * surface it prominently in the subject and body so the trader sees the
   * customer marked the job as ASAP. */
  urgency?: "routine" | "soon" | "urgent" | string | null;
}): Promise<boolean> {
  // Deep-link bounce: opens the installed app at the trader's leads screen,
  // with an install fallback for users without the app.
  const dashboardUrl = `${getOpenLinkBase()}/open?t=leads`;
  const safeName = escapeHtml(opts.toName);
  const safeCustomer = escapeHtml(opts.customerName);
  const safeService = escapeHtml(opts.serviceRequired);
  const urgency = typeof opts.urgency === "string" ? opts.urgency : null;
  const isUrgent = urgency === "urgent";
  const urgencyBanner = isUrgent
    ? `<p style="background: #7F1D1D; color: #FEE2E2; font-size: 13px; font-weight: 700; padding: 10px 14px; border-radius: 8px; margin: 0 0 16px; text-transform: uppercase; letter-spacing: 0.5px;">Customer marked this job as ASAP</p>`
    : "";
  const html = emailShell({
    title: "Unanswered lead on MyLocalTrade",
    preheader: isUrgent
      ? `${safeCustomer} marked this ${safeService} enquiry as ASAP`
      : `You haven't opened ${safeCustomer}'s ${safeService} enquiry yet`,
    unsubscribe: { url: opts.unsubscribeUrl, label: "Unsubscribe from these reminders" },
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      ${urgencyBanner}
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
  const subjectBase = `Unanswered lead from ${sanitizeHeaderValue(opts.customerName)}`;
  const subjectWithService = `${subjectBase} — ${sanitizeHeaderValue(opts.serviceRequired)}`;
  const subject = isUrgent ? `[ASAP] ${subjectWithService}` : subjectWithService;
  const channel = await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject,
    html,
    headers: {
      "List-Unsubscribe": `<${opts.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    tag: "lead-reminder",
  });
  // The reminder scheduler uses this boolean to decide whether to keep the
  // claim (so it isn't retried) or release it for another attempt. Only
  // report success when a real transport actually delivered the message.
  return channel !== "none";
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
        Please open the app, go to your trader dashboard, and upload a replacement ${safeType} document to resolve this.
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
    subject: `${sanitizeHeaderValue(opts.traderName)} replied to your review`,
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
      `,
  });
  await dispatchEmail({
    category: "verification",
    to: { email: opts.toEmail, name: opts.toName },
    subject: "Your MyLocalTrade profile has been approved",
    html,
    tag: "trader-approved",
  });
}

export async function sendTraderRevalidationDueEmail(opts: {
  toEmail: string;
  toName: string;
  businessName?: string | null;
  /** Number of days the trader has to re-confirm before being hidden. */
  graceDays: number;
}): Promise<void> {
  const safeName = escapeHtml(opts.toName);
  const safeBusiness = opts.businessName ? escapeHtml(opts.businessName) : null;
  const html = emailShell({
    title: "Time to re-confirm your MyLocalTrade details",
    preheader: "A quick check to keep your verified profile up to date.",
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        It's time for the periodic re-check of your MyLocalTrade trader profile${safeBusiness ? ` for <strong style="color: #00B4D8;">${safeBusiness}</strong>` : ""}. This keeps your "Documents reviewed" trust badge current for customers.
      </p>
      <div style="background: #0E1A2A; border-left: 3px solid #F59E0B; padding: 14px 16px; border-radius: 8px; margin: 0 0 20px;">
        <p style="color: #F59E0B; font-size: 13px; font-weight: 600; margin: 0 0 6px;">What we need</p>
        <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0;">
          Please open the app and confirm your key documents (such as your public liability insurance) are still valid and up to date.
        </p>
      </div>
      <p style="color: #E5E7EB; font-size: 15px; line-height: 1.6; margin: 0 0 12px;"><strong>Next steps</strong></p>
      <ul style="color: #E5E7EB; font-size: 14px; line-height: 1.7; margin: 0 0 20px; padding-left: 20px;">
        <li>Open the MyLocalTrade app and go to your trader dashboard.</li>
        <li>Re-confirm your details, or upload a fresh document if anything has expired.</li>
        <li>If you do not re-confirm within ${opts.graceDays} days, your profile will be temporarily hidden from search until you do.</li>
      </ul>
      `,
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject: "Time to re-confirm your MyLocalTrade details",
    html,
    tag: "trader-revalidation-due",
  });
}

export async function sendTraderRevalidationOverdueEmail(opts: {
  toEmail: string;
  toName: string;
  businessName?: string | null;
}): Promise<void> {
  const safeName = escapeHtml(opts.toName);
  const safeBusiness = opts.businessName ? escapeHtml(opts.businessName) : null;
  const html = emailShell({
    title: "Your MyLocalTrade profile is hidden until you re-confirm",
    preheader: "Re-confirm your details to restore your profile in search.",
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        We asked you to re-confirm the details on your MyLocalTrade trader profile${safeBusiness ? ` for <strong style="color: #00B4D8;">${safeBusiness}</strong>` : ""}, but we haven't heard back. To keep customers safe, your profile is now temporarily hidden from search.
      </p>
      <div style="background: #0E1A2A; border-left: 3px solid #EF4444; padding: 14px 16px; border-radius: 8px; margin: 0 0 20px;">
        <p style="color: #EF4444; font-size: 13px; font-weight: 600; margin: 0 0 6px;">How to restore your profile</p>
        <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0;">
          Open the app, re-confirm your key documents are still valid, and your profile will be visible to customers again straight away.
        </p>
      </div>
      `,
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject: "Your MyLocalTrade profile is hidden until you re-confirm",
    html,
    tag: "trader-revalidation-overdue",
  });
}

export async function sendAdminRevalidationAlertEmail(opts: {
  traderEmail: string;
  traderName: string;
  businessName?: string | null;
  /** "due" when first prompted, "overdue" when the grace period lapsed. */
  stage: "due" | "overdue";
}): Promise<void> {
  const SUPPORT_EMAIL = "contact@serviceproviderltd.co.uk";
  const safeEmail = escapeHtml(opts.traderEmail);
  const safeName = escapeHtml(opts.traderName);
  const safeBusiness = opts.businessName ? escapeHtml(opts.businessName) : "(none)";
  const isOverdue = opts.stage === "overdue";
  const accent = isOverdue ? "#EF4444" : "#F59E0B";
  const headline = isOverdue
    ? "A verified trader missed their re-validation and has been hidden"
    : "A verified trader is due for re-validation";
  const html = emailShell({
    title: headline,
    preheader: `${safeName} — re-validation ${opts.stage}`,
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">${escapeHtml(headline)}.</p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
        <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px; width: 130px;">Trader</td><td style="padding: 8px 0; color: #E5E7EB; font-size: 13px;">${safeName}</td></tr>
        <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px;">Business</td><td style="padding: 8px 0; color: #E5E7EB; font-size: 13px;">${safeBusiness}</td></tr>
        <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px;">Email</td><td style="padding: 8px 0; color: #E5E7EB; font-size: 13px;">${safeEmail}</td></tr>
      </table>
      <div style="background: #0E1A2A; border-left: 3px solid ${accent}; padding: 14px 16px; border-radius: 8px; margin: 0 0 16px;">
        <p style="color: ${accent}; font-size: 12px; font-weight: 600; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.5px;">Status</p>
        <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0;">${isOverdue
          ? "The trader did not re-confirm within the grace period and is now hidden from public search."
          : "The trader has been prompted to re-confirm their key documents."}</p>
      </div>
      <p style="color: #9CA3AF; font-size: 14px; line-height: 1.6; margin: 0;">Open the admin console to review this trader if needed.</p>`,
  });
  await dispatchEmail({
    category: "contact",
    to: { email: SUPPORT_EMAIL },
    from: { email: FROM_EMAIL, name: "MyLocalTrade Re-validation" },
    subject: `[RE-VALIDATION ${isOverdue ? "OVERDUE" : "DUE"}] ${sanitizeHeaderValue(opts.traderEmail)}`,
    html,
    headers: {
      "X-MyLocalTrade-Type": "trader-revalidation-admin-alert",
    },
    tag: "trader-revalidation-admin",
  });
}

export async function sendAdminCancellationRequestEmail(opts: {
  traderEmail: string;
  traderName: string;
  businessName?: string | null;
  provider: "apple" | "stripe" | "demo";
  withinCoolingOff: boolean;
  note?: string | null;
}): Promise<void> {
  const SUPPORT_EMAIL = "contact@serviceproviderltd.co.uk";
  const safeEmail = escapeHtml(opts.traderEmail);
  const safeName = escapeHtml(opts.traderName);
  const safeBusiness = opts.businessName ? escapeHtml(opts.businessName) : "(none)";
  const providerLabel =
    opts.provider === "apple"
      ? "Apple (App Store / in-app purchase)"
      : opts.provider === "stripe"
        ? "Stripe (web)"
        : "Demo";
  const accent = opts.withinCoolingOff ? "#10B981" : "#F59E0B";
  const coolingLabel = opts.withinCoolingOff
    ? "Within 14-day cooling-off window"
    : "Outside cooling-off window";
  const handoff =
    opts.provider === "apple"
      ? "Apple owns this subscription — any cancellation/refund is handled by Apple. Assist the trader; do not attempt to issue a refund from our side."
      : "Our team processes this cancellation/refund directly.";
  const html = emailShell({
    title: "A trader has requested to cancel",
    preheader: `${safeName} — cancellation request (${coolingLabel.toLowerCase()})`,
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">A trader has filed a cancellation request from the app.</p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
        <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px; width: 150px;">Trader</td><td style="padding: 8px 0; color: #E5E7EB; font-size: 13px;">${safeName}</td></tr>
        <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px;">Business</td><td style="padding: 8px 0; color: #E5E7EB; font-size: 13px;">${safeBusiness}</td></tr>
        <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px;">Email</td><td style="padding: 8px 0; color: #E5E7EB; font-size: 13px;">${safeEmail}</td></tr>
        <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px;">Provider</td><td style="padding: 8px 0; color: #E5E7EB; font-size: 13px;">${escapeHtml(providerLabel)}</td></tr>
      </table>
      <div style="background: #0E1A2A; border-left: 3px solid ${accent}; padding: 14px 16px; border-radius: 8px; margin: 0 0 16px;">
        <p style="color: ${accent}; font-size: 12px; font-weight: 600; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.5px;">${escapeHtml(coolingLabel)}</p>
        <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0;">${escapeHtml(handoff)}</p>
      </div>
      ${
        opts.note
          ? `<div style="margin: 0 0 16px;"><p style="color: #6B7280; font-size: 12px; font-weight: 600; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.5px;">Trader note</p><p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${escapeHtml(opts.note)}</p></div>`
          : ""
      }
      <p style="color: #9CA3AF; font-size: 14px; line-height: 1.6; margin: 0;">Open the admin console to action this request.</p>`,
  });
  await dispatchEmail({
    category: "contact",
    to: { email: SUPPORT_EMAIL },
    from: { email: FROM_EMAIL, name: "MyLocalTrade Cancellations" },
    subject: `[CANCELLATION ${opts.withinCoolingOff ? "COOLING-OFF" : "REQUEST"}] ${sanitizeHeaderValue(opts.traderEmail)}`,
    html,
    headers: {
      "X-MyLocalTrade-Type": "cancellation-request-admin-alert",
    },
    tag: "cancellation-request-admin",
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
        You can update your information and re-apply at any time.
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
      `,
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
      `,
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
  /** Optional: the service the conversation is about, e.g. "Kitchen tiling".
   * When present we surface it in the subject, preheader, and body so the
   * recipient instantly remembers which enquiry this reply is for. */
  serviceRequired?: string | null;
}): Promise<void> {
  const safeName = escapeHtml(opts.toName);
  const safeSender = escapeHtml(opts.senderName);
  // Truncate preview to a safe length so we never leak entire long messages.
  const trimmed = opts.preview.length > 140 ? opts.preview.slice(0, 140) + "…" : opts.preview;
  const safePreview = escapeHtml(trimmed);
  const webBase = getOpenLinkBase();
  // Point the CTA at a deep-link redirect page that opens the installed app
  // straight to this conversation (mylocaltrade://messages/<id>), falling back
  // to the landing page if the app isn't installed. Avoids the old behaviour of
  // landing on a web page / Expo preview.
  const openUrl = `${webBase}/open?c=${opts.conversationId}`;
  const trimmedService =
    typeof opts.serviceRequired === "string" && opts.serviceRequired.trim().length > 0
      ? opts.serviceRequired.trim().slice(0, 80)
      : null;
  const safeService = trimmedService ? escapeHtml(trimmedService) : null;
  const safeSenderHeader = sanitizeHeaderValue(opts.senderName);
  const safeServiceHeader = trimmedService ? sanitizeHeaderValue(trimmedService) : "";
  const subjectBase =
    opts.senderRole === "trader"
      ? `New reply from ${safeSenderHeader}`
      : `New message from ${safeSenderHeader}`;
  const subject = safeServiceHeader ? `${subjectBase} — Re: ${safeServiceHeader}` : subjectBase;
  const preheader = safeService
    ? `${safeSender} replied about your ${safeService} enquiry`
    : `${safeSender} sent you a message on MyLocalTrade`;
  const contextLine = safeService
    ? `<p style="color: #9CA3AF; font-size: 13px; line-height: 1.6; margin: 0 0 16px;">Re: <strong style="color: #E5E7EB;">${safeService}</strong></p>`
    : "";
  const html = emailShell({
    title: "New message on MyLocalTrade",
    preheader,
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      ${contextLine}
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
        You have a new message from <strong style="color: #00B4D8;">${safeSender}</strong> on MyLocalTrade.
      </p>
      <div style="background: #0E1A2A; border-left: 3px solid #00B4D8; padding: 14px 16px; border-radius: 8px; margin: 0 0 24px;">
        <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${safePreview}</p>
      </div>
      <div style="text-align: center; margin-bottom: 8px;">
        <a href="${openUrl}" style="display: inline-block; background: #00B4D8; color: #0B1120; font-weight: 700; font-size: 15px; padding: 12px 32px; border-radius: 12px; text-decoration: none;">
          Open conversation
        </a>
      </div>
      <p style="color: #6B7280; font-size: 12px; line-height: 1.6; margin: 24px 0 0; text-align: center;">
        For your safety, never share your bank details, and don't pay for any work before you've verified the trader and agreed what's being done.
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

// ---------------------------------------------------------------------------
// Account deletion / GDPR senders
// ---------------------------------------------------------------------------

export async function sendAccountDeletionReceivedEmail(opts: {
  toEmail: string;
  toName: string;
  reason?: string | null;
}): Promise<void> {
  const safeName = escapeHtml(opts.toName);
  const reasonBlock = opts.reason
    ? `<div style="background: #0E1A2A; border-left: 3px solid #00B4D8; padding: 14px 16px; border-radius: 8px; margin: 0 0 20px;">
         <p style="color: #9CA3AF; font-size: 12px; font-weight: 600; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.5px;">Reason you gave</p>
         <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${escapeHtml(opts.reason)}</p>
       </div>`
    : "";
  const html = emailShell({
    title: "Account deletion request received",
    preheader: "We've received your request to delete your MyLocalTrade account.",
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        We've received your request to delete your MyLocalTrade account. Your account is now <strong>deactivated</strong> — you have been signed out of the app, your push notifications have been turned off, and your trader profile (if any) is no longer visible to customers.
      </p>
      ${reasonBlock}
      <p style="color: #E5E7EB; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
        Our admin team will finalise the deletion once any required legal retention period has passed. We may keep a minimal record of certain data (for example, completed transactions) where the law requires us to do so.
      </p>
      <p style="color: #9CA3AF; font-size: 14px; line-height: 1.6; margin: 0 0 8px;">
        <strong style="color: #F9FAFB;">Changed your mind?</strong> You can cancel this request from the app's "Delete account" screen for as long as the account is still in the deactivated state.
      </p>
      <p style="color: #6B7280; font-size: 13px; line-height: 1.6; margin: 16px 0 0;">
        If you did not request this, please <a href="${getOpenLinkBase()}/open?t=support" style="color: #00B4D8;">contact us through the app's support form</a> immediately.
      </p>`,
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject: "Your MyLocalTrade account deletion request",
    html,
    tag: "account-deletion-received",
  });
}

export async function sendAccountDeletionCancelledEmail(opts: {
  toEmail: string;
  toName: string;
}): Promise<void> {
  const safeName = escapeHtml(opts.toName);
  const html = emailShell({
    title: "Account deletion cancelled",
    preheader: "Your MyLocalTrade account has been restored.",
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${safeName},</p>
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        Welcome back. Your MyLocalTrade account is no longer scheduled for deletion and you can sign in again.
      </p>
      <p style="color: #9CA3AF; font-size: 14px; line-height: 1.6; margin: 0;">
        Note: if you are a trader, your profile will only return to public listings once your verification status and subscription are still in good standing.
      </p>`,
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject: "Your MyLocalTrade account has been restored",
    html,
    tag: "account-deletion-cancelled",
  });
}

export async function sendAdminAccountDeletionAlertEmail(opts: {
  userEmail: string;
  userFullName: string;
  userRole: string;
  reason?: string | null;
}): Promise<void> {
  const SUPPORT_EMAIL = "contact@serviceproviderltd.co.uk";
  const safeEmail = escapeHtml(opts.userEmail);
  const safeName = escapeHtml(opts.userFullName);
  const safeRole = escapeHtml(opts.userRole);
  const safeReason = opts.reason ? escapeHtml(opts.reason) : "(none provided)";
  const html = emailShell({
    title: "New account deletion request",
    preheader: `${safeName} has requested account deletion`,
    bodyHtml: `
      <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">A user has just requested account deletion. The account is already locked and the trader profile (if any) is hidden from customers.</p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
        <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px; width: 110px;">Name</td><td style="padding: 8px 0; color: #E5E7EB; font-size: 13px;">${safeName}</td></tr>
        <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px;">Email</td><td style="padding: 8px 0; color: #E5E7EB; font-size: 13px;">${safeEmail}</td></tr>
        <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px;">Role</td><td style="padding: 8px 0; color: #E5E7EB; font-size: 13px;">${safeRole}</td></tr>
      </table>
      <div style="background: #0E1A2A; border-left: 3px solid #F59E0B; padding: 14px 16px; border-radius: 8px; margin: 0 0 16px;">
        <p style="color: #FCD34D; font-size: 12px; font-weight: 600; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.5px;">Reason</p>
        <p style="color: #E5E7EB; font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${safeReason}</p>
      </div>
      <p style="color: #9CA3AF; font-size: 14px; line-height: 1.6; margin: 0;">Open the admin console → Account deletions to review and finalise the request.</p>`,
  });
  await dispatchEmail({
    category: "contact",
    to: { email: SUPPORT_EMAIL },
    from: { email: FROM_EMAIL, name: "MyLocalTrade Account Deletions" },
    subject: `[ACCOUNT DELETION] ${sanitizeHeaderValue(opts.userEmail)}`,
    html,
    headers: {
      "X-MyLocalTrade-Type": "account-deletion-admin-alert",
    },
    tag: "account-deletion-admin",
  });
}
