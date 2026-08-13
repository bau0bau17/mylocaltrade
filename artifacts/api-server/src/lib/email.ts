import nodemailer from "nodemailer";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import {
  renderBrandedEmail,
  em,
  strongText,
  escapeEmailHtml,
  SECURITY_NOTE_COPY,
  type BrandedEmailOptions,
  type EmailBlock,
  type EmailVariant,
  type RenderedEmail,
} from "./email-shell";

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

export interface OpenLinkStatus {
  /** The base URL email `/open?...` links will actually use. */
  base: string;
  /** True when the base host is one of the app's associated domains. */
  universalLinks: boolean;
  /** Where the base came from. */
  source: "env-override" | "replit-domains" | "api-base-fallback";
}

/** Resolve the open-link base without logging (used by health + startup check). */
export function getOpenLinkStatus(): OpenLinkStatus {
  const explicit = process.env.UNIVERSAL_LINK_BASE_URL?.trim().replace(/\/$/, "");
  if (explicit) {
    try {
      const host = new URL(explicit).hostname.toLowerCase();
      if (ASSOCIATED_LINK_HOSTS.includes(host)) {
        return { base: explicit, universalLinks: true, source: "env-override" };
      }
    } catch {
      /* invalid URL — fall through to the fallbacks */
    }
  }
  const domains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const associated = domains.find((d) => ASSOCIATED_LINK_HOSTS.includes(d.toLowerCase()));
  if (associated) {
    return { base: `https://${associated}`, universalLinks: true, source: "replit-domains" };
  }
  return {
    base: getApiBaseUrl().replace(/\/api$/, ""),
    universalLinks: false,
    source: "api-base-fallback",
  };
}

function logOpenLinkFallback(context: string): void {
  // In production a non-associated host means every email CTA opens Safari
  // instead of the app — that's a misconfiguration, so shout (error), don't
  // whisper (warn). In dev it's expected, keep it at warn level.
  const message =
    `[email] ${context}: /open links are using a non-associated host — ` +
    `iOS Universal Links will NOT open the app directly. ` +
    `Set UNIVERSAL_LINK_BASE_URL to https://mylocaltrade.co.uk (or www).`;
  if (process.env.NODE_ENV === "production") console.error(message);
  else console.warn(message);
}

/**
 * Perform the startup assertion: resolves the open-link base once at boot and
 * surfaces a loud error in production when it isn't an associated domain.
 * Called from server startup; also reused indirectly via the health route.
 */
export function assertOpenLinkBaseAtStartup(): OpenLinkStatus {
  const status = getOpenLinkStatus();
  const explicit = process.env.UNIVERSAL_LINK_BASE_URL?.trim();
  if (explicit && status.source !== "env-override") {
    // An override was provided but rejected (invalid URL or wrong host).
    logOpenLinkFallback("UNIVERSAL_LINK_BASE_URL is set but invalid/non-associated; ignored");
  } else if (!status.universalLinks) {
    logOpenLinkFallback("UNIVERSAL_LINK_BASE_URL is missing and no associated domain found");
  } else {
    console.log(
      `[email] /open link base resolved to ${status.base} (${status.source}, universal links OK)`,
    );
  }
  return status;
}

export function getOpenLinkBase(): string {
  const status = getOpenLinkStatus();
  if (!status.universalLinks) {
    // Per-send visibility: keep the (unchanged) fallback behaviour, but make
    // sure a misconfigured deployment is impossible to miss in the logs.
    logOpenLinkFallback("open-link fallback in use");
  }
  return status.base;
}

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

/**
 * True when the address is a wiped placeholder assigned during account
 * anonymisation/deletion (e.g. `deleted-user-<id>@deleted.mylocaltrade.invalid`
 * or `released-<id>-<ts>@released.mylocaltrade.invalid`). Such addresses must
 * never receive real email; `dispatchEmail` refuses them as a safety net.
 */
export function isWipedPlaceholderEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(".invalid");
}

const BREVO_KEY_ENV: Record<EmailCategory, string> = {
  verification: "BREVO_API_KEY_VERIFICATION",
  notifications: "BREVO_API_KEY_NOTIFICATIONS",
  contact: "BREVO_API_KEY_CONTACT",
};

export interface DispatchOpts {
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
/**
 * True for internal placeholder addresses that must never receive mail —
 * anonymised/deleted accounts carry `deleted-user-<id>@deleted.mylocaltrade.invalid`.
 * The reserved `.invalid` TLD can never belong to a real recipient (RFC 2606),
 * so guarding on it cannot block a legitimate user.
 */
export function isPlaceholderEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(".invalid");
}

/**
 * True for addresses under RFC 2606/6761-reserved test domains
 * (`example.com/org/net`, and the `.test` / `.example` / `.invalid` /
 * `.localhost` TLDs). Automated tests and seed fixtures use such addresses;
 * they can never belong to a real recipient. Refusing them inside the shared
 * dispatcher protects the Brevo account's daily sending quota and sender
 * reputation: a single test-suite run once burned the whole free-plan daily
 * limit, after which Brevo silently accepted-and-dropped every production
 * email (including password resets) for the rest of the day.
 */
export function isNonDeliverableTestAddress(email: string): boolean {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 0) return true; // not routable at all
  const domain = trimmed.slice(at + 1).replace(/\.+$/, "");
  if (/(^|\.)(test|example|invalid|localhost)$/.test(domain)) return true;
  return (
    domain === "example.com" ||
    domain === "example.org" ||
    domain === "example.net" ||
    domain.endsWith(".example.com") ||
    domain.endsWith(".example.org") ||
    domain.endsWith(".example.net")
  );
}

/**
 * Test/preview-only capture hook. When set, `dispatchEmail` hands the fully
 * rendered payload (subject/html/text/headers/…) to the hook and reports
 * "brevo" WITHOUT contacting any transport. This lets the test suite and the
 * preview generator assert on / render the exact production output of every
 * sender — the dispatcher otherwise refuses reserved test addresses before
 * any payload could be observed.
 *
 * Hard-disabled in production: the setter throws under NODE_ENV=production,
 * and the dispatcher re-checks NODE_ENV on every send so a hook set before an
 * environment flip can never intercept or suppress real mail — the normal
 * placeholder/test-domain guards stay authoritative.
 */
let emailCaptureHook: ((opts: DispatchOpts) => void) | null = null;
export function __setEmailCaptureHookForTests(
  hook: ((opts: DispatchOpts) => void) | null,
): void {
  if (hook !== null && process.env.NODE_ENV === "production") {
    throw new Error("email capture hook is disabled in production");
  }
  emailCaptureHook = hook;
}

async function dispatchEmail(opts: DispatchOpts): Promise<"brevo" | "smtp" | "none" | "skipped"> {
  if (emailCaptureHook && process.env.NODE_ENV !== "production") {
    emailCaptureHook(opts);
    return "brevo";
  }
  // Central safety net: no transactional email may ever be dispatched to a
  // wiped placeholder address, regardless of which flow triggered the send
  // (subscription webhooks, admin actions, etc. can fire after anonymisation).
  if (isPlaceholderEmail(opts.to.email)) {
    console.warn(
      `[email] [skipped-placeholder:${opts.category}] ${opts.tag} suppressed for placeholder address ${opts.to.email}`,
    );
    return "skipped";
  }
  // Reserved test/example domains (RFC 2606/6761) can never be real
  // recipients. Tests and fixtures use them; forwarding them to the provider
  // only burns the shared daily quota and damages sender reputation.
  if (isNonDeliverableTestAddress(opts.to.email)) {
    console.warn(
      `[email] [skipped-test-domain:${opts.category}] ${opts.tag} suppressed for reserved test address ${opts.to.email}`,
    );
    return "skipped";
  }
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
// Shared branded shell (see lib/email-shell.ts for the design system)
// ---------------------------------------------------------------------------

/** Absolute HTTPS logo URL served by the API at /api/public/logo.png. */
export function getEmailLogoUrl(): string {
  return `${getApiBaseUrl()}/api/public/logo.png`;
}

/** Render with the shared shell + the hosted logo. */
function renderMlt(opts: Omit<BrandedEmailOptions, "logoUrl">): RenderedEmail {
  return renderBrandedEmail({ ...opts, logoUrl: getEmailLogoUrl() });
}

const ACCOUNT_REASON_LINE =
  "You are receiving this email because you have an account on MyLocalTrade.";

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
  const { html, text } = renderMlt({
    variant: "neutral",
    heading: "Verify your email",
    preheader: "Use this code to finish setting up your MyLocalTrade account.",
    blocks: [
      { kind: "greeting", name: toName },
      {
        kind: "paragraph",
        text: "Thanks for signing up to MyLocalTrade. Enter the code below in the app to verify your email address and activate your account.",
      },
      { kind: "code", code, expiresMinutes: codeExpiresInMinutes },
      { kind: "divider" },
      {
        kind: "paragraph",
        text: "Not using the app? You can verify in your browser instead:",
        muted: true,
      },
      { kind: "cta", label: "Verify Email Address", url: verifyUrl },
      { kind: "linkFallback", url: verifyUrl },
      {
        kind: "paragraph",
        text: "The verification link expires in 24 hours. If you didn't create an account, you can safely ignore this email.",
        muted: true,
      },
    ],
    footer: { companyIdentity: true },
    securityNote: SECURITY_NOTE_COPY,
  });
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
): Promise<"brevo" | "smtp" | "none" | "skipped"> {
  const { html, text } = renderMlt({
    variant: "neutral",
    heading: "Your phone verification code",
    preheader: `Your MyLocalTrade verification code is ${code}`,
    blocks: [
      { kind: "greeting", name: toName },
      {
        kind: "paragraph",
        text: "Use the code below to verify your phone number on MyLocalTrade.",
      },
      { kind: "code", code, expiresMinutes: expiresInMinutes },
      {
        kind: "paragraph",
        text: "If you didn't request it, you can safely ignore this email.",
        muted: true,
      },
    ],
    footer: { reasonLine: ACCOUNT_REASON_LINE },
    securityNote: SECURITY_NOTE_COPY,
  });
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
): Promise<"brevo" | "smtp" | "none" | "skipped"> {
  const { html, text } = renderMlt({
    variant: "neutral",
    heading: "Your password reset code",
    preheader: `Your MyLocalTrade password reset code is ${code}`,
    blocks: [
      { kind: "greeting", name: toName },
      {
        kind: "paragraph",
        text: "We received a request to reset your MyLocalTrade password. Enter the code below in the app to choose a new password.",
      },
      { kind: "code", code, expiresMinutes: expiresInMinutes },
      {
        kind: "paragraph",
        text: "If you didn't request a password reset, you can safely ignore this email — your password will not be changed.",
        muted: true,
      },
    ],
    footer: { reasonLine: ACCOUNT_REASON_LINE },
    securityNote: SECURITY_NOTE_COPY,
  });
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
  const { html, text } = renderMlt({
    variant: "trader",
    heading: "Confirm your business email address",
    preheader: `Confirm ${toEmail} for ${businessName} on MyLocalTrade`,
    blocks: [
      { kind: "greeting", name: toName },
      {
        kind: "html",
        html: `Please confirm that ${em(toEmail)} is a working business email address for ${strongText(businessName)}. Confirming it adds a trust signal to your MyLocalTrade profile.`,
        text: `Please confirm that ${toEmail} is a working business email address for ${businessName}. Confirming it adds a trust signal to your MyLocalTrade profile.`,
      },
      { kind: "cta", label: "Confirm this email address", url: verifyUrl },
      { kind: "linkFallback", url: verifyUrl },
      {
        kind: "paragraph",
        text: "This link expires in 24 hours. If you didn't request this, you can safely ignore this email.",
        muted: true,
      },
    ],
    footer: { reasonLine: ACCOUNT_REASON_LINE },
  });
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
  const { html, text } = renderMlt({
    variant: "neutral",
    heading: "New support message",
    preheader: `Contact form: ${opts.subject}`,
    blocks: [
      { kind: "warningBanner", text: "Contact support — reply within 48 hours" },
      {
        kind: "paragraph",
        text: "New support message received via the in-app contact form.",
        muted: true,
      },
      {
        kind: "rows",
        rows: [
          ["From", `${opts.fromName} <${opts.fromEmail}>`],
          ["Subject", opts.subject],
          ["Reply by", replyByDate],
        ],
      },
      { kind: "panel", title: "Message", text: opts.message },
    ],
    footer: {
      reasonLine: "Sent via the MyLocalTrade app · Service Provider LTD · 48h SLA",
    },
  });
  await dispatchEmail({
    category: "contact",
    to: { email: SUPPORT_EMAIL },
    from: { email: CONTACT_FROM_EMAIL, name: "MyLocalTrade Contact Form" },
    replyTo: { email: opts.fromEmail, name: opts.fromName },
    subject: `[CONTACT - Reply within 48h] ${sanitizeHeaderValue(opts.subject)}`,
    html,
    text,
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

const EARLY_ACCESS_TYPE_LABELS: Record<string, string> = {
  customer: "Customer",
  trader: "Trader",
  other: "Other",
};

/**
 * Landing-site "Join Early Access" signup → internal notification.
 * Goes to the noreply@ inbox from the standard sender identity, with
 * reply-to set to the signer-up so a direct reply reaches them.
 * Returns the delivery channel so the route can fail loudly when no
 * transport delivered the lead (there is no DB fallback for this form).
 */
export async function sendEarlyAccessNotificationEmail(opts: {
  name: string;
  email: string;
  type: string;
  town?: string | null;
  message?: string | null;
}): Promise<"brevo" | "smtp" | "none" | "skipped"> {
  const INBOX_EMAIL = "noreply@mylocaltrade.co.uk";
  const typeLabel = EARLY_ACCESS_TYPE_LABELS[opts.type] ?? opts.type;
  const blocks: EmailBlock[] = [
    {
      kind: "paragraph",
      text: "Someone joined the early access list on the website.",
      muted: true,
    },
    {
      kind: "rows",
      rows: [
        ["Name", opts.name],
        ["Email", opts.email],
        ["I am a", typeLabel],
        ["Town / area", opts.town?.trim() || "—"],
      ],
    },
  ];
  if (opts.message?.trim()) {
    blocks.push({ kind: "panel", title: "Message", text: opts.message.trim() });
  }
  const { html, text } = renderMlt({
    variant: "neutral",
    heading: "New early access signup",
    preheader: `${opts.name} (${typeLabel}) joined the list`,
    blocks,
    footer: {
      reasonLine:
        "Sent via the mylocaltrade.co.uk early access form · reply goes straight to the signer-up",
    },
  });
  return dispatchEmail({
    category: "contact",
    to: { email: INBOX_EMAIL },
    from: { email: FROM_EMAIL, name: FROM_NAME },
    replyTo: { email: opts.email, name: opts.name },
    subject: `[EARLY ACCESS] ${sanitizeHeaderValue(opts.name)} (${typeLabel}) joined the list`,
    html,
    text,
    tag: "early-access-notify",
  });
}

/**
 * Double opt-in confirmation email (Phase 2A). Strictly neutral: it only
 * asks the recipient to confirm that they requested MyLocalTrade Early
 * Access emails — no promotions, no marketing copy.
 *
 * SECURITY: `confirmUrl` carries the single-use raw token. It must NEVER be
 * logged — the dispatcher only logs tag/recipient/subject, never the body.
 * Returns the real dispatch channel so the caller can record send
 * success/failure accurately (never "sent" just because it was queued).
 */
export async function sendEarlyAccessConfirmationEmail(opts: {
  toEmail: string;
  toName: string;
  confirmUrl: string;
}): Promise<"brevo" | "smtp" | "none" | "skipped"> {
  const { html, text } = renderMlt({
    variant: "neutral",
    heading: "Confirm your email address",
    preheader: "Confirm your MyLocalTrade Early Access request.",
    blocks: [
      { kind: "greeting", name: opts.toName },
      {
        kind: "paragraph",
        text: "We received a request to receive MyLocalTrade Early Access emails at this address. To confirm it was you, please press the button below.",
      },
      { kind: "cta", label: "Confirm my email", url: opts.confirmUrl },
      {
        kind: "paragraph",
        text: "This link expires in 48 hours. If the button doesn't work, copy and paste this address into your browser:",
        muted: true,
      },
      { kind: "linkFallback", url: opts.confirmUrl, note: "" },
      {
        kind: "paragraph",
        text: "If you didn't request this, you can safely ignore this email — nothing will be sent to you.",
        muted: true,
      },
    ],
    footer: { notMonitored: true, companyIdentity: true },
  });
  return dispatchEmail({
    category: "contact",
    to: { email: opts.toEmail, name: opts.toName },
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: "Confirm your MyLocalTrade Early Access request",
    html,
    text,
    tag: "early-access-confirm",
  });
}

/**
 * Campaign TEST email (Phase 2B) — a single preview copy sent to an
 * authorised administrator, never to list recipients. This is not a bulk
 * marketing send, so the shared dispatcher is appropriate; real campaign
 * delivery goes through the Brevo marketing-campaign pipeline instead.
 * The caller renders the full branded campaign HTML and counts this send
 * against the daily marketing quota (test emails burn real credits).
 */
export async function sendEarlyAccessCampaignTestEmail(opts: {
  toEmail: string;
  toName: string;
  subject: string;
  html: string;
  text: string;
}): Promise<"brevo" | "smtp" | "none" | "skipped"> {
  return dispatchEmail({
    category: "contact",
    to: { email: opts.toEmail, name: opts.toName },
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: `[TEST] ${sanitizeHeaderValue(opts.subject)}`,
    html: opts.html,
    text: opts.text,
    tag: "early-access-campaign-test",
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
  const sf = opts.specialistFields ?? null;
  const propertyTypeLabel = sf?.propertyType
    ? ENQUIRY_PROPERTY_TYPE_LABELS[sf.propertyType] ?? sf.propertyType
    : null;
  const tenureLabel = sf?.tenure ? ENQUIRY_TENURE_LABELS[sf.tenure] ?? sf.tenure : null;
  const urgencyLabel = sf?.urgency
    ? ENQUIRY_URGENCY_LABELS[sf.urgency] ?? sf.urgency
    : null;
  const detailsRows = [
    ["From", opts.customerName],
    ["Service required", opts.serviceRequired],
    urgencyLabel ? ["Urgency", urgencyLabel] : null,
    propertyTypeLabel ? ["Property type", propertyTypeLabel] : null,
    tenureLabel ? ["Customer is", tenureLabel] : null,
    opts.preferredDate ? ["Preferred date", opts.preferredDate] : null,
    opts.phone ? ["Phone", opts.phone] : null,
  ].filter(Boolean) as Array<[string, string]>;
  const { html, text } = renderMlt({
    variant: "trader",
    heading: "You have a new lead",
    preheader: `New enquiry from ${opts.customerName} for ${opts.serviceRequired}`,
    blocks: [
      { kind: "greeting", name: opts.toName },
      {
        kind: "paragraph",
        text: "You have a new lead on MyLocalTrade. Reply quickly to win the job.",
      },
      { kind: "rows", rows: detailsRows },
      { kind: "panel", title: "Customer message", text: opts.message },
      { kind: "cta", label: "Open my leads", url: dashboardUrl },
    ],
    footer: { reasonLine: ACCOUNT_REASON_LINE },
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject: `New enquiry: ${sanitizeHeaderValue(opts.serviceRequired)}`,
    html,
    text,
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
  const { html, text } = renderMlt({
    variant: "customer",
    heading: "Your enquiry has been sent",
    preheader: `We've sent your enquiry to ${opts.traderBusinessName}`,
    blocks: [
      { kind: "greeting", name: opts.toName || "there" },
      {
        kind: "html",
        html: `Thanks for using MyLocalTrade. We've sent your enquiry to ${em(opts.traderBusinessName)} for ${strongText(opts.serviceRequired)}.`,
        text: `Thanks for using MyLocalTrade. We've sent your enquiry to ${opts.traderBusinessName} for ${opts.serviceRequired}.`,
      },
      {
        kind: "paragraph",
        text: "Most verified traders reply within a day. You'll get a notification as soon as they respond, and you can chat with them directly in the app.",
        muted: true,
      },
      { kind: "panel", title: "Your message", text: opts.message },
      {
        kind: "paragraph",
        text: "For your safety, please keep all conversation inside MyLocalTrade until you're confident in the trader. Never share your bank details, and don't pay for or deposit against any work before it's agreed.",
        muted: true,
      },
    ],
    footer: { reasonLine: ACCOUNT_REASON_LINE },
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName ?? undefined },
    subject: `We've sent your enquiry to ${sanitizeHeaderValue(opts.traderBusinessName)}`,
    html,
    text,
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
  const urgency = typeof opts.urgency === "string" ? opts.urgency : null;
  const isUrgent = urgency === "urgent";
  const blocks: EmailBlock[] = [{ kind: "greeting", name: opts.toName }];
  if (isUrgent) {
    blocks.push({ kind: "warningBanner", text: "Customer marked this job as ASAP" });
  }
  blocks.push(
    {
      kind: "html",
      html: `You still have an unanswered lead from ${em(opts.customerName)} for ${strongText(opts.serviceRequired)}.`,
      text: `You still have an unanswered lead from ${opts.customerName} for ${opts.serviceRequired}.`,
    },
    {
      kind: "paragraph",
      text: "Customers usually go with the first trader who replies. Open the lead and send a quick reply to win the job.",
      muted: true,
    },
    { kind: "cta", label: "Open my leads", url: dashboardUrl },
  );
  const { html, text } = renderMlt({
    variant: "trader",
    heading: "Unanswered lead on MyLocalTrade",
    preheader: isUrgent
      ? `${opts.customerName} marked this ${opts.serviceRequired} enquiry as ASAP`
      : `You haven't opened ${opts.customerName}'s ${opts.serviceRequired} enquiry yet`,
    blocks,
    footer: {
      reasonLine: ACCOUNT_REASON_LINE,
      unsubscribe: {
        url: opts.unsubscribeUrl,
        label: "Unsubscribe from these reminders",
      },
    },
  });
  const subjectBase = `Unanswered lead from ${sanitizeHeaderValue(opts.customerName)}`;
  const subjectWithService = `${subjectBase} — ${sanitizeHeaderValue(opts.serviceRequired)}`;
  const subject = isUrgent ? `[ASAP] ${subjectWithService}` : subjectWithService;
  const channel = await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${opts.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    tag: "lead-reminder",
  });
  // The reminder scheduler uses this boolean to decide whether to keep the
  // claim (so it isn't retried) or release it for another attempt. Only
  // report success when a real transport actually delivered the message.
  // Only a real transport counts as delivered — "skipped" (placeholder
  // recipient) must not report success or the reminder is never retried
  // nor flagged, silently.
  return channel === "brevo" || channel === "smtp";
}

export async function sendDocumentRejectedEmail(opts: {
  toEmail: string;
  toName: string;
  documentType: string;
  reason: string;
}): Promise<void> {
  const { html, text } = renderMlt({
    variant: "trader",
    heading: "Document needs your attention",
    preheader: `Your ${opts.documentType} could not be approved`,
    blocks: [
      { kind: "greeting", name: opts.toName },
      {
        kind: "html",
        html: `Your ${strongText(opts.documentType)} document could not be approved.`,
        text: `Your ${opts.documentType} document could not be approved.`,
      },
      { kind: "panel", title: "Reviewer note", text: opts.reason, tone: "warning" },
      {
        kind: "paragraph",
        text: `Please open the app, go to your trader dashboard, and upload a replacement ${opts.documentType} document to resolve this.`,
        muted: true,
      },
    ],
    footer: { reasonLine: ACCOUNT_REASON_LINE },
  });
  await dispatchEmail({
    category: "verification",
    to: { email: opts.toEmail, name: opts.toName },
    subject: `Action required: ${opts.documentType} not approved`,
    html,
    text,
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
  const stars = "★".repeat(opts.rating) + "☆".repeat(5 - opts.rating);
  const { html, text } = renderMlt({
    variant: "trader",
    heading: "A new review was approved",
    preheader: `${opts.customerName} left you a ${opts.rating}-star review`,
    blocks: [
      { kind: "greeting", name: opts.toName },
      {
        kind: "paragraph",
        text: "A new review on your MyLocalTrade profile has been approved by our moderation team and is now public.",
      },
      {
        kind: "panel",
        title: `${stars} — ${opts.customerName}`,
        text: opts.reviewText,
        tone: "success",
      },
      {
        kind: "paragraph",
        text: "Open the trader dashboard to reply publicly — a quick, friendly response builds trust with future customers.",
        muted: true,
      },
    ],
    footer: { reasonLine: ACCOUNT_REASON_LINE },
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject: `New ${opts.rating}-star review on your profile`,
    html,
    text,
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
  const { html, text } = renderMlt({
    variant: "customer",
    heading: "The trader replied to your review",
    preheader: `${opts.traderName} replied to your review on MyLocalTrade`,
    blocks: [
      { kind: "greeting", name: opts.toName },
      {
        kind: "html",
        html: `${em(opts.traderName)} just posted a public reply to your review.`,
        text: `${opts.traderName} just posted a public reply to your review.`,
      },
      { kind: "panel", title: "Your review", text: opts.reviewText },
      { kind: "panel", title: "Trader's reply", text: opts.replyText },
      {
        kind: "paragraph",
        text: "You can view the full conversation on the trader's profile in the MyLocalTrade app.",
        muted: true,
      },
    ],
    footer: { reasonLine: ACCOUNT_REASON_LINE },
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject: `${sanitizeHeaderValue(opts.traderName)} replied to your review`,
    html,
    text,
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
  const blocks: EmailBlock[] = [
    { kind: "greeting", name: opts.toName },
    opts.businessName
      ? {
          kind: "html",
          html: `Good news — your MyLocalTrade trader profile for ${em(opts.businessName)} has been approved.`,
          text: `Good news — your MyLocalTrade trader profile for ${opts.businessName} has been approved.`,
        }
      : {
          kind: "paragraph",
          text: "Good news — your MyLocalTrade trader profile has been approved.",
        },
    {
      kind: "panel",
      title: "What this means",
      text: "Your profile is visible to customers searching on MyLocalTrade, provided you have an active subscription and your required documents remain valid.",
      tone: "success",
    },
  ];
  if (opts.adminNotes) {
    blocks.push({ kind: "panel", title: "Note from our team", text: opts.adminNotes });
  }
  blocks.push({
    kind: "list",
    title: "Next steps",
    items: [
      "Open the MyLocalTrade app and check your dashboard.",
      "Make sure your subscription is active so customers can contact you.",
      "Reply quickly to new leads — most customers go with the first trader who replies.",
    ],
  });
  const { html, text } = renderMlt({
    variant: "trader",
    heading: "Your profile has been approved",
    preheader: "Your trader profile is now live on MyLocalTrade.",
    blocks,
    footer: { reasonLine: ACCOUNT_REASON_LINE },
  });
  await dispatchEmail({
    category: "verification",
    to: { email: opts.toEmail, name: opts.toName },
    subject: "Your MyLocalTrade profile has been approved",
    html,
    text,
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
  const { html, text } = renderMlt({
    variant: "trader",
    heading: "Time to re-confirm your details",
    preheader: "A quick check to keep your verified profile up to date.",
    blocks: [
      { kind: "greeting", name: opts.toName },
      opts.businessName
        ? {
            kind: "html",
            html: `It's time for the periodic re-check of your MyLocalTrade trader profile for ${em(opts.businessName)}. This keeps your "Documents reviewed" trust badge current for customers.`,
            text: `It's time for the periodic re-check of your MyLocalTrade trader profile for ${opts.businessName}. This keeps your "Documents reviewed" trust badge current for customers.`,
          }
        : {
            kind: "paragraph",
            text: 'It\'s time for the periodic re-check of your MyLocalTrade trader profile. This keeps your "Documents reviewed" trust badge current for customers.',
          },
      {
        kind: "panel",
        title: "What we need",
        text: "Please open the app and confirm your key documents (such as your public liability insurance) are still valid and up to date.",
        tone: "warning",
      },
      {
        kind: "list",
        title: "Next steps",
        items: [
          "Open the MyLocalTrade app and go to your trader dashboard.",
          "Re-confirm your details, or upload a fresh document if anything has expired.",
          `If you do not re-confirm within ${opts.graceDays} days, your profile will be temporarily hidden from search until you do.`,
        ],
      },
    ],
    footer: { reasonLine: ACCOUNT_REASON_LINE },
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject: "Time to re-confirm your MyLocalTrade details",
    html,
    text,
    tag: "trader-revalidation-due",
  });
}

export async function sendTraderRevalidationOverdueEmail(opts: {
  toEmail: string;
  toName: string;
  businessName?: string | null;
}): Promise<void> {
  const { html, text } = renderMlt({
    variant: "trader",
    heading: "Your profile is hidden until you re-confirm",
    preheader: "Re-confirm your details to restore your profile in search.",
    blocks: [
      { kind: "greeting", name: opts.toName },
      opts.businessName
        ? {
            kind: "html",
            html: `We asked you to re-confirm the details on your MyLocalTrade trader profile for ${em(opts.businessName)}, but we haven't heard back. To keep customers safe, your profile is now temporarily hidden from search.`,
            text: `We asked you to re-confirm the details on your MyLocalTrade trader profile for ${opts.businessName}, but we haven't heard back. To keep customers safe, your profile is now temporarily hidden from search.`,
          }
        : {
            kind: "paragraph",
            text: "We asked you to re-confirm the details on your MyLocalTrade trader profile, but we haven't heard back. To keep customers safe, your profile is now temporarily hidden from search.",
          },
      {
        kind: "panel",
        title: "How to restore your profile",
        text: "Open the app, re-confirm your key documents are still valid, and your profile will be visible to customers again straight away.",
        tone: "danger",
      },
    ],
    footer: { reasonLine: ACCOUNT_REASON_LINE },
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject: "Your MyLocalTrade profile is hidden until you re-confirm",
    html,
    text,
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
  const isOverdue = opts.stage === "overdue";
  const headline = isOverdue
    ? "A verified trader missed their re-validation and has been hidden"
    : "A verified trader is due for re-validation";
  const { html, text } = renderMlt({
    variant: "neutral",
    heading: "Trader re-validation alert",
    preheader: `${opts.traderName} — re-validation ${opts.stage}`,
    blocks: [
      { kind: "paragraph", text: `${headline}.` },
      {
        kind: "rows",
        rows: [
          ["Trader", opts.traderName],
          ["Business", opts.businessName || "(none)"],
          ["Email", opts.traderEmail],
        ],
      },
      {
        kind: "panel",
        title: "Status",
        text: isOverdue
          ? "The trader did not re-confirm within the grace period and is now hidden from public search."
          : "The trader has been prompted to re-confirm their key documents.",
        tone: isOverdue ? "danger" : "warning",
      },
      {
        kind: "paragraph",
        text: "Open the admin console to review this trader if needed.",
        muted: true,
      },
    ],
    footer: { reasonLine: "Internal operations alert · MyLocalTrade admin" },
  });
  await dispatchEmail({
    category: "contact",
    to: { email: SUPPORT_EMAIL },
    from: { email: FROM_EMAIL, name: "MyLocalTrade Re-validation" },
    subject: `[RE-VALIDATION ${isOverdue ? "OVERDUE" : "DUE"}] ${sanitizeHeaderValue(opts.traderEmail)}`,
    html,
    text,
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
  provider: "apple" | "demo";
  withinCoolingOff: boolean;
  note?: string | null;
}): Promise<void> {
  const SUPPORT_EMAIL = "contact@serviceproviderltd.co.uk";
  const providerLabel =
    opts.provider === "apple" ? "Apple (App Store / in-app purchase)" : "Demo";
  const coolingLabel = opts.withinCoolingOff
    ? "Within 14-day cooling-off window"
    : "Outside cooling-off window";
  const handoff =
    opts.provider === "apple"
      ? "Apple owns this subscription — any cancellation/refund is handled by Apple. Assist the trader; do not attempt to issue a refund from our side."
      : "Our team processes this cancellation/refund directly.";
  const blocks: EmailBlock[] = [
    {
      kind: "paragraph",
      text: "A trader has filed a cancellation request from the app.",
    },
    {
      kind: "rows",
      rows: [
        ["Trader", opts.traderName],
        ["Business", opts.businessName || "(none)"],
        ["Email", opts.traderEmail],
        ["Provider", providerLabel],
      ],
    },
    {
      kind: "panel",
      title: coolingLabel,
      text: handoff,
      tone: opts.withinCoolingOff ? "success" : "warning",
    },
  ];
  if (opts.note) {
    blocks.push({ kind: "panel", title: "Trader note", text: opts.note });
  }
  blocks.push({
    kind: "paragraph",
    text: "Open the admin console to action this request.",
    muted: true,
  });
  const { html, text } = renderMlt({
    variant: "neutral",
    heading: "A trader has requested to cancel",
    preheader: `${opts.traderName} — cancellation request (${coolingLabel.toLowerCase()})`,
    blocks,
    footer: { reasonLine: "Internal operations alert · MyLocalTrade admin" },
  });
  await dispatchEmail({
    category: "contact",
    to: { email: SUPPORT_EMAIL },
    from: { email: FROM_EMAIL, name: "MyLocalTrade Cancellations" },
    subject: `[CANCELLATION ${opts.withinCoolingOff ? "COOLING-OFF" : "REQUEST"}] ${sanitizeHeaderValue(opts.traderEmail)}`,
    html,
    text,
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
  const { html, text } = renderMlt({
    variant: "trader",
    heading: "Update on your application",
    preheader: "Your trader application was not approved.",
    blocks: [
      { kind: "greeting", name: opts.toName },
      {
        kind: "paragraph",
        text: "Thank you for applying to list your business on MyLocalTrade. After reviewing your application, we are not able to approve your trader profile at this time.",
      },
      { kind: "panel", title: "Reason", text: opts.reason, tone: "danger" },
      {
        kind: "paragraph",
        text: "You can update your information and re-apply at any time.",
      },
      {
        kind: "paragraph",
        text: "Your account remains active so you can update your details and apply again in the future.",
        muted: true,
      },
    ],
    footer: { reasonLine: ACCOUNT_REASON_LINE },
  });
  await dispatchEmail({
    category: "verification",
    to: { email: opts.toEmail, name: opts.toName },
    subject: "Update on your MyLocalTrade application",
    html,
    text,
    tag: "trader-rejected",
  });
}

export async function sendTraderMoreInfoRequestedEmail(opts: {
  toEmail: string;
  toName: string;
  notes: string;
}): Promise<void> {
  const { html, text } = renderMlt({
    variant: "trader",
    heading: "More information needed",
    preheader: "Our team needs a few more details to review your application.",
    blocks: [
      { kind: "greeting", name: opts.toName },
      {
        kind: "paragraph",
        text: "Thanks for submitting your trader application. Before we can complete our review, we need a little more information from you.",
      },
      { kind: "panel", title: "What we need", text: opts.notes, tone: "warning" },
      {
        kind: "list",
        title: "Next steps",
        items: [
          "Open the MyLocalTrade app and go to your trader dashboard",
          "Update or upload the requested information",
          "Once submitted, our team will review your application again",
        ],
      },
    ],
    footer: { reasonLine: ACCOUNT_REASON_LINE },
  });
  await dispatchEmail({
    category: "verification",
    to: { email: opts.toEmail, name: opts.toName },
    subject: "More information needed for your MyLocalTrade application",
    html,
    text,
    tag: "trader-more-info",
  });
}

export async function sendTraderSuspendedEmail(opts: {
  toEmail: string;
  toName: string;
  reason: string;
}): Promise<void> {
  const { html, text } = renderMlt({
    variant: "trader",
    heading: "Your account has been suspended",
    preheader: "Your trader profile is no longer visible on MyLocalTrade.",
    blocks: [
      { kind: "greeting", name: opts.toName },
      {
        kind: "paragraph",
        text: "Your MyLocalTrade trader profile has been suspended by our team and is no longer visible to customers.",
      },
      { kind: "panel", title: "Reason", text: opts.reason, tone: "danger" },
    ],
    footer: { reasonLine: ACCOUNT_REASON_LINE },
  });
  await dispatchEmail({
    category: "verification",
    to: { email: opts.toEmail, name: opts.toName },
    subject: "Your MyLocalTrade account has been suspended",
    html,
    text,
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
  // Truncate preview to a safe length so we never leak entire long messages.
  const trimmed =
    opts.preview.length > 140 ? opts.preview.slice(0, 140) + "…" : opts.preview;
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
  const safeSenderHeader = sanitizeHeaderValue(opts.senderName);
  const safeServiceHeader = trimmedService ? sanitizeHeaderValue(trimmedService) : "";
  const subjectBase =
    opts.senderRole === "trader"
      ? `New reply from ${safeSenderHeader}`
      : `New message from ${safeSenderHeader}`;
  const subject = safeServiceHeader
    ? `${subjectBase} — Re: ${safeServiceHeader}`
    : subjectBase;
  // The RECIPIENT's role is the opposite side of the conversation — trusted
  // server-side data, never a client-supplied value.
  const recipientVariant: EmailVariant =
    opts.senderRole === "trader" ? "customer" : "trader";
  const blocks: EmailBlock[] = [{ kind: "greeting", name: opts.toName }];
  if (trimmedService) {
    blocks.push({
      kind: "html",
      html: `Re: ${strongText(trimmedService)}`,
      text: `Re: ${trimmedService}`,
      muted: true,
    });
  }
  blocks.push(
    {
      kind: "html",
      html: `You have a new message from ${em(opts.senderName)} on MyLocalTrade.`,
      text: `You have a new message from ${opts.senderName} on MyLocalTrade.`,
    },
    { kind: "panel", text: trimmed },
    { kind: "cta", label: "Open conversation", url: openUrl },
  );
  if (recipientVariant === "customer") {
    blocks.push({
      kind: "paragraph",
      text: "For your safety, never share your bank details, and don't pay for any work before you've verified the trader and agreed what's being done.",
      muted: true,
    });
  }
  const { html, text } = renderMlt({
    variant: recipientVariant,
    heading: "New message on MyLocalTrade",
    preheader: trimmedService
      ? `${opts.senderName} replied about your ${trimmedService} enquiry`
      : `${opts.senderName} sent you a message on MyLocalTrade`,
    blocks,
    footer: { reasonLine: ACCOUNT_REASON_LINE },
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject,
    html,
    text,
    tag: `new-message[conv=${opts.conversationId}]`,
  });
}

// ---------------------------------------------------------------------------
// Job completion lifecycle senders
// ---------------------------------------------------------------------------

/** Trader marked the job done → ask the customer to confirm (or report). */
export async function sendWorkMarkedCompleteEmail(opts: {
  toEmail: string;
  toName: string;
  businessName: string;
  jobReference?: string | null;
  conversationId: number;
}): Promise<void> {
  const refText = opts.jobReference ? ` (job ${opts.jobReference})` : "";
  const openUrl = `${getOpenLinkBase()}/open?c=${opts.conversationId}`;
  const { html, text } = renderMlt({
    variant: "customer",
    heading: "Work marked as completed",
    preheader: `${opts.businessName} marked your job as complete — please review and confirm.`,
    blocks: [
      { kind: "greeting", name: opts.toName },
      {
        kind: "html",
        html: `${em(opts.businessName)} has marked the work on your job${escapeEmailHtml(refText)} as ${strongText("completed")}.`,
        text: `${opts.businessName} has marked the work on your job${refText} as completed.`,
      },
      {
        kind: "list",
        title: "Please take a moment to:",
        items: [
          "Confirm completion if you're happy the work is done",
          "Reply in the conversation if something isn't right",
          "Leave a review once you've confirmed — it helps other customers",
        ],
      },
      { kind: "cta", label: "Review the job", url: openUrl },
    ],
    footer: { reasonLine: ACCOUNT_REASON_LINE },
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject: `Work marked as completed${opts.jobReference ? ` — job ${sanitizeHeaderValue(opts.jobReference)}` : ""}`,
    html,
    text,
    tag: `work-marked-complete[conv=${opts.conversationId}]`,
  });
}

/** Customer confirmed completion → invite them to leave a review. */
export async function sendReviewInviteEmail(opts: {
  toEmail: string;
  toName: string;
  businessName: string;
  traderProfileId: number;
  conversationId: number;
}): Promise<void> {
  const openUrl = `${getOpenLinkBase()}/open?c=${opts.conversationId}`;
  const { html, text } = renderMlt({
    variant: "customer",
    heading: "How did it go?",
    preheader: `Leave a review for ${opts.businessName} on MyLocalTrade.`,
    blocks: [
      { kind: "greeting", name: opts.toName },
      {
        kind: "html",
        html: `Thanks for confirming your job with ${em(opts.businessName)} is complete.`,
        text: `Thanks for confirming your job with ${opts.businessName} is complete.`,
      },
      {
        kind: "paragraph",
        text: "Your review is public and helps other customers hire with confidence. It only takes a minute.",
      },
      { kind: "cta", label: "Leave a review", url: openUrl },
    ],
    footer: { reasonLine: ACCOUNT_REASON_LINE },
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject: `How did it go with ${sanitizeHeaderValue(opts.businessName)}?`,
    html,
    text,
    tag: `review-invite[conv=${opts.conversationId}]`,
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
  const supportUrl = `${getOpenLinkBase()}/open?t=support`;
  const blocks: EmailBlock[] = [
    { kind: "greeting", name: opts.toName },
    {
      kind: "html",
      html: `We've received your request to delete your MyLocalTrade account. Your account is now ${strongText("deactivated")} — you have been signed out of the app, your push notifications have been turned off, and your trader profile (if any) is no longer visible to customers.`,
      text: "We've received your request to delete your MyLocalTrade account. Your account is now deactivated — you have been signed out of the app, your push notifications have been turned off, and your trader profile (if any) is no longer visible to customers.",
    },
  ];
  if (opts.reason) {
    blocks.push({ kind: "panel", title: "Reason you gave", text: opts.reason });
  }
  blocks.push(
    {
      kind: "paragraph",
      text: "Our admin team will finalise the deletion once any required legal retention period has passed. We may keep a minimal record of certain data (for example, completed transactions) where the law requires us to do so.",
    },
    {
      kind: "html",
      html: `${strongText("Changed your mind?")} You can cancel this request from the app's "Delete account" screen for as long as the account is still in the deactivated state.`,
      text: 'Changed your mind? You can cancel this request from the app\'s "Delete account" screen for as long as the account is still in the deactivated state.',
      muted: true,
    },
    {
      kind: "html",
      html: `If you did not request this, please <a href="${supportUrl}" style="color: #12B8D4; text-decoration: underline;">contact us through the app's support form</a> immediately.`,
      text: `If you did not request this, please contact us through the app's support form immediately: ${supportUrl}`,
      muted: true,
    },
  );
  const { html, text } = renderMlt({
    variant: "neutral",
    heading: "Account deletion request received",
    preheader: "We've received your request to delete your MyLocalTrade account.",
    blocks,
    footer: { reasonLine: ACCOUNT_REASON_LINE },
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject: "Your MyLocalTrade account deletion request",
    html,
    text,
    tag: "account-deletion-received",
  });
}

export async function sendAccountDeletionCancelledEmail(opts: {
  toEmail: string;
  toName: string;
}): Promise<void> {
  const { html, text } = renderMlt({
    variant: "neutral",
    heading: "Account deletion cancelled",
    preheader: "Your MyLocalTrade account has been restored.",
    blocks: [
      { kind: "greeting", name: opts.toName },
      {
        kind: "paragraph",
        text: "Welcome back. Your MyLocalTrade account is no longer scheduled for deletion and you can sign in again.",
      },
      {
        kind: "paragraph",
        text: "Note: if you are a trader, your profile will only return to public listings once your verification status and subscription are still in good standing.",
        muted: true,
      },
    ],
    footer: { reasonLine: ACCOUNT_REASON_LINE },
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject: "Your MyLocalTrade account has been restored",
    html,
    text,
    tag: "account-deletion-cancelled",
  });
}

export async function sendAccountDeletionCompletedEmail(opts: {
  toEmail: string;
  toName: string;
}): Promise<void> {
  const { html, text } = renderMlt({
    variant: "neutral",
    heading: "Your account has been deleted",
    preheader: "Your MyLocalTrade account has now been permanently deleted.",
    blocks: [
      { kind: "greeting", name: opts.toName },
      {
        kind: "html",
        html: `This is to confirm that your MyLocalTrade account has now been ${strongText("permanently deleted")}. Your personal details have been removed from our systems and your account can no longer be signed in to or restored.`,
        text: "This is to confirm that your MyLocalTrade account has now been permanently deleted. Your personal details have been removed from our systems and your account can no longer be signed in to or restored.",
      },
      {
        kind: "paragraph",
        text: "Where the law requires it, we may retain a minimal record of certain data (for example, completed transactions) for the applicable retention period.",
        muted: true,
      },
      {
        kind: "paragraph",
        text: "You're welcome back any time — you can create a new account with this email address whenever you like. Thank you for having been part of MyLocalTrade.",
        muted: true,
      },
    ],
    footer: {},
  });
  await dispatchEmail({
    category: "notifications",
    to: { email: opts.toEmail, name: opts.toName },
    subject: "Your MyLocalTrade account has been permanently deleted",
    html,
    text,
    tag: "account-deletion-completed",
  });
}

export async function sendAdminAccountDeletionAlertEmail(opts: {
  userEmail: string;
  userFullName: string;
  userRole: string;
  reason?: string | null;
}): Promise<void> {
  const SUPPORT_EMAIL = "contact@serviceproviderltd.co.uk";
  const { html, text } = renderMlt({
    variant: "neutral",
    heading: "New account deletion request",
    preheader: `${opts.userFullName} has requested account deletion`,
    blocks: [
      {
        kind: "paragraph",
        text: "A user has just requested account deletion. The account is already locked and the trader profile (if any) is hidden from customers.",
      },
      {
        kind: "rows",
        rows: [
          ["Name", opts.userFullName],
          ["Email", opts.userEmail],
          ["Role", opts.userRole],
        ],
      },
      {
        kind: "panel",
        title: "Reason",
        text: opts.reason || "(none provided)",
        tone: "warning",
      },
      {
        kind: "paragraph",
        text: "Open the admin console → Account deletions to review and finalise the request.",
        muted: true,
      },
    ],
    footer: { reasonLine: "Internal operations alert · MyLocalTrade admin" },
  });
  await dispatchEmail({
    category: "contact",
    to: { email: SUPPORT_EMAIL },
    from: { email: FROM_EMAIL, name: "MyLocalTrade Account Deletions" },
    subject: `[ACCOUNT DELETION] ${sanitizeHeaderValue(opts.userEmail)}`,
    html,
    text,
    headers: {
      "X-MyLocalTrade-Type": "account-deletion-admin-alert",
    },
    tag: "account-deletion-admin",
  });
}

// ---------------------------------------------------------------------------
// Company Teams — employee invitation
// ---------------------------------------------------------------------------

/**
 * Invite someone to join a trader's business as a team member.
 *
 * The link carries the RAW single-use invite token (only its SHA-256 hash is
 * stored server-side) through the /open?j= deep-link bounce page into the
 * app's join screen. Account-setup mail → category "verification": no
 * unsubscribe header, same policy as OTP/verification email.
 *
 * Recipient has no account yet → neutral variant (never guess a role).
 */
export async function sendCompanyInviteEmail(opts: {
  toEmail: string;
  businessName: string;
  inviterName: string;
  token: string;
  expiresInDays: number;
}): Promise<void> {
  const joinUrl = `${getOpenLinkBase()}/open?j=${encodeURIComponent(opts.token)}`;
  const { html, text } = renderMlt({
    variant: "neutral",
    heading: `Join ${opts.businessName} on MyLocalTrade`,
    preheader: `${opts.inviterName} has invited you to join ${opts.businessName}'s team.`,
    blocks: [
      { kind: "greeting", name: "" },
      {
        kind: "html",
        html: `${em(opts.inviterName)} has invited you to join ${em(opts.businessName)} as a team member on MyLocalTrade.`,
        text: `${opts.inviterName} has invited you to join ${opts.businessName} as a team member on MyLocalTrade.`,
      },
      {
        kind: "paragraph",
        text: "Tap the button below on your phone to create your own login and start seeing the business's enquiries and messages.",
      },
      { kind: "cta", label: "Join the team", url: joinUrl },
      {
        kind: "paragraph",
        text: `This invitation expires in ${opts.expiresInDays} days and can only be used once. If you weren't expecting it, you can safely ignore this email.`,
        muted: true,
      },
    ],
    footer: {},
  });
  await dispatchEmail({
    category: "verification",
    to: { email: opts.toEmail },
    subject: `${sanitizeHeaderValue(opts.inviterName)} invited you to join ${sanitizeHeaderValue(opts.businessName)} on MyLocalTrade`,
    html,
    text,
    tag: "company-invite",
  });
}
