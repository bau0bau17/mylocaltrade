import { and, eq, gte, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  earlyAccessRegistrationsTable,
  earlyAccessCampaignRecipientsTable,
  earlyAccessCampaignEventsTable,
  type EarlyAccessCampaign,
  type EarlyAccessCampaignType,
} from "@workspace/db/schema";

/**
 * Campaign engine helpers (Phase 2B): server-side recipient eligibility,
 * daily quota accounting, content validation and the controlled branded
 * email template.
 *
 * INVARIANTS:
 * - Eligibility is ALWAYS computed here from the local database — recipient
 *   counts or filters supplied by the admin UI are never trusted.
 * - The local database is the source of truth for consent and suppression.
 * - The template accepts plain-text fields + one validated HTTPS CTA URL;
 *   arbitrary HTML/scripts can never reach an email body.
 */

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

const t = earlyAccessRegistrationsTable;

/**
 * Recipients must have confirmed email ownership (double opt-in), hold the
 * relevant CONFIRMED consent, and have no voluntary unsubscribe, no admin
 * suppression and no deliverability suppression (hard bounce / complaint /
 * block). Phase 1 legacy rows (consent recorded but never confirmed) are
 * NOT eligible — they count as "confirmation pending".
 */
export function eligibilityCondition(type: EarlyAccessCampaignType) {
  return and(
    isNotNull(t.confirmedAt),
    type === "launch" ? isNotNull(t.launchConsentAt) : isNotNull(t.marketingConsentAt),
    isNull(t.unsubscribedAt),
    isNull(t.emailSuppressedAt),
  )!;
}

export type AudienceBreakdown = {
  eligible: number;
  /** Confirmed ownership but the required consent axis is missing. */
  excludedConsentMissing: number;
  /** Never confirmed ownership (incl. Phase 1 legacy + pending/expired). */
  excludedConfirmationPending: number;
  /** Voluntary unsubscribe, admin suppression or bounce/complaint/block. */
  excludedUnsubscribedOrSuppressed: number;
  total: number;
};

/** Server-side audience calculation — the ONLY source of recipient counts. */
export async function computeAudience(
  type: EarlyAccessCampaignType,
): Promise<AudienceBreakdown> {
  const consentCol = type === "launch" ? t.launchConsentAt : t.marketingConsentAt;
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      eligible: sql<number>`count(*) filter (where ${eligibilityCondition(type)})::int`,
      excludedUnsubscribedOrSuppressed: sql<number>`count(*) filter (where ${t.unsubscribedAt} is not null or ${t.emailSuppressedAt} is not null)::int`,
      excludedConfirmationPending: sql<number>`count(*) filter (where ${t.unsubscribedAt} is null and ${t.emailSuppressedAt} is null and ${t.confirmedAt} is null)::int`,
      excludedConsentMissing: sql<number>`count(*) filter (where ${t.unsubscribedAt} is null and ${t.emailSuppressedAt} is null and ${t.confirmedAt} is not null and ${consentCol} is null)::int`,
    })
    .from(t);
  return row;
}

/** Eligible rows for snapshotting, ordered stably. */
export async function selectEligibleRegistrations(
  executor: Pick<typeof db, "select">,
  type: EarlyAccessCampaignType,
) {
  return executor
    .select({
      id: t.id,
      name: t.name,
      emailNormalized: t.emailNormalized,
    })
    .from(t)
    .where(eligibilityCondition(type))
    .orderBy(t.id);
}

// ---------------------------------------------------------------------------
// Daily quota
// ---------------------------------------------------------------------------

/** Brevo Free plan: 300 sends/day shared with transactional email. */
const BREVO_FREE_PLAN_DAILY_LIMIT = 300;

function intFromEnv(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

export function marketingDailySendCap(): number {
  return intFromEnv("MARKETING_DAILY_SEND_CAP", 200, 10_000);
}

export function transactionalDailyReserve(): number {
  return intFromEnv("TRANSACTIONAL_EMAIL_DAILY_RESERVE", 100, 10_000);
}

/**
 * The cap we actually enforce per UTC day: the configured marketing cap,
 * never exceeding what the plan allows once the transactional reserve is
 * set aside. Brevo does not expose a reliable remaining-quota API on the
 * free plan, so this LOCAL conservative budget is authoritative.
 */
export function effectiveDailyCap(): number {
  return Math.min(
    marketingDailySendCap(),
    Math.max(0, BREVO_FREE_PLAN_DAILY_LIMIT - transactionalDailyReserve()),
  );
}

/** Start of the current UTC day (Brevo's daily quota window). */
function utcDayStart(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * Advisory lock serializing every quota check-and-consume across the whole
 * process fleet (batch reservation AND test sends). Without it two
 * concurrent transactions can read the same remaining quota and both spend
 * it, blowing past the daily cap. Acquire with acquireQuotaLock(tx) inside
 * the transaction that checks quota AND records its consumption.
 */
const QUOTA_ADVISORY_LOCK_KEY = 771_482_3001n;

export async function acquireQuotaLock(
  tx: Pick<typeof db, "execute">,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${sql.raw(QUOTA_ADVISORY_LOCK_KEY.toString())})`,
  );
}

/**
 * Marketing sends already consumed today across ALL campaigns: recipients
 * marked sent/delivered today + test emails (test sends burn real credits
 * too). 'sending' reservations also count — they may already have reached
 * Brevo, so the conservative reading protects the transactional reserve.
 * (A crashed reservation stops counting once the next run recovers it.)
 */
export async function marketingSendsToday(
  executor: Pick<typeof db, "select">,
): Promise<number> {
  const dayStart = utcDayStart();
  const r = earlyAccessCampaignRecipientsTable;
  const [sent] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(r)
    .where(
      sql`(${r.sentAt} >= ${dayStart} OR ${r.status} = 'sending')`,
    );
  const e = earlyAccessCampaignEventsTable;
  const [tests] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(e)
    .where(
      and(
        eq(e.kind, "TEST_SENT"),
        gte(e.createdAt, dayStart),
        sql`(${e.details} ->> 'ok')::boolean = true`,
      ),
    );
  return (sent?.count ?? 0) + (tests?.count ?? 0);
}

export async function remainingDailyQuota(
  executor: Pick<typeof db, "select">,
): Promise<number> {
  return Math.max(0, effectiveDailyCap() - (await marketingSendsToday(executor)));
}

/** Max test emails per campaign per UTC day (they consume real credits). */
export const TEST_SEND_DAILY_LIMIT_PER_CAMPAIGN = 5;

export async function testSendsTodayForCampaign(
  executor: Pick<typeof db, "select">,
  campaignId: number,
): Promise<number> {
  const e = earlyAccessCampaignEventsTable;
  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(e)
    .where(
      and(
        eq(e.campaignId, campaignId),
        eq(e.kind, "TEST_SENT"),
        gte(e.createdAt, utcDayStart()),
      ),
    );
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Content validation
// ---------------------------------------------------------------------------

/** HTTPS-only, parseable, no embedded credentials, sane length. */
export function validateCtaUrl(url: string): string | null {
  if (url.length > 500) return "CTA URL is too long (max 500 characters).";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "CTA URL is not a valid URL.";
  }
  if (parsed.protocol !== "https:") return "CTA URL must use HTTPS.";
  if (parsed.username || parsed.password)
    return "CTA URL must not contain credentials.";
  if (!parsed.hostname.includes("."))
    return "CTA URL must use a fully-qualified host.";
  return null;
}

/** All content requirements for sending (test or real). Draft saves are laxer. */
export function validateCampaignContent(c: EarlyAccessCampaign): string[] {
  const errors: string[] = [];
  if (!c.name.trim()) errors.push("Internal name is required.");
  if (!c.subject.trim()) errors.push("Subject is required.");
  if (c.subject.length > 150) errors.push("Subject is too long.");
  if (!c.heading.trim()) errors.push("Heading is required.");
  if (!c.bodyText.trim()) errors.push("Message body is required.");
  if (c.bodyText.length > 5000) errors.push("Message body is too long.");
  if (!c.ctaLabel.trim()) errors.push("CTA label is required.");
  if (!c.ctaUrl.trim()) {
    errors.push("CTA URL is required.");
  } else {
    const urlError = validateCtaUrl(c.ctaUrl);
    if (urlError) errors.push(urlError);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Branded template
// ---------------------------------------------------------------------------

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** First word of the stored name, for the greeting. */
export function firstNameOf(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  return first || "there";
}

export type RenderOptions = {
  /**
   * Literal greeting name (test sends / previews) — mutually exclusive with
   * brevoMergeTags. Escaped before rendering.
   */
  greetingName?: string;
  /**
   * Bulk mode: greeting + unsubscribe link come from Brevo per-contact
   * attributes (FIRSTNAME, EA_UNSUB_TOKEN) so every recipient gets their own
   * personalised copy from ONE campaign HTML.
   */
  brevoMergeTags?: boolean;
  /** Literal unsubscribe URL (test/preview mode). */
  unsubscribeUrl?: string;
  isTest?: boolean;
};

/**
 * The ONLY way campaign content becomes an email body. Every field is
 * escaped plain text; the sole link targets are the validated HTTPS CTA
 * URL, the privacy policy and the unsubscribe endpoints. No admin-supplied
 * HTML ever passes through.
 */
export function renderCampaignEmail(
  campaign: Pick<
    EarlyAccessCampaign,
    "type" | "subject" | "previewText" | "heading" | "bodyText" | "ctaLabel" | "ctaUrl"
  >,
  opts: RenderOptions,
): { html: string; text: string } {
  const publicBase = "https://mylocaltrade.co.uk";
  const greeting = opts.brevoMergeTags
    ? `Hi {{ contact.FIRSTNAME | default : "there" }},`
    : `Hi ${escapeHtml(opts.greetingName || "there")},`;
  const greetingText = opts.brevoMergeTags
    ? `Hi {{ contact.FIRSTNAME | default : "there" }},`
    : `Hi ${opts.greetingName || "there"},`;
  const unsubscribeHref = opts.brevoMergeTags
    ? `${publicBase}/unsubscribe?token={{ contact.EA_UNSUB_TOKEN }}`
    : escapeHtml(opts.unsubscribeUrl ?? `${publicBase}/unsubscribe`);

  const paragraphsHtml = campaign.bodyText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("\n    ");

  const testBanner = opts.isTest
    ? `<div style="background: #7C2D12; color: #FDBA74; font-size: 13px; font-weight: 700; text-align: center; padding: 8px; border-radius: 8px; margin-bottom: 20px;">TEST EMAIL — not sent to the campaign audience</div>`
    : "";

  // Brevo requires an unsubscribe mechanism in campaign HTML; the mirrored
  // native tag keeps their one-click/List-Unsubscribe support intact while
  // our signed link drives the local suppression state directly.
  const brevoNativeUnsub = opts.brevoMergeTags
    ? ` · <a href="{{ unsubscribe }}" style="color: #6B7280; text-decoration: underline;">One-click unsubscribe</a>`
    : "";

  const safeCtaUrl = escapeHtml(campaign.ctaUrl);
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(campaign.subject)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0B1120; margin: 0; padding: 40px 20px;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(campaign.previewText)}</div>
  <div style="max-width: 560px; margin: 0 auto; background: #111827; border-radius: 16px; padding: 40px; border: 1px solid #1F2937;">
    ${testBanner}
    <div style="text-align: center; margin-bottom: 28px;">
      <h1 style="color: #F9FAFB; font-size: 22px; font-weight: 700; margin: 0;">MyLocalTrade</h1>
    </div>
    <h2 style="color: #F9FAFB; font-size: 20px; font-weight: 700; margin: 0 0 16px;">${escapeHtml(campaign.heading)}</h2>
    <p style="color: #E5E7EB; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">${greeting}</p>
    ${paragraphsHtml}
    <div style="text-align: center; margin: 28px 0;">
      <a href="${safeCtaUrl}" style="display: inline-block; background: #00B4D8; color: #06121F; font-size: 16px; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 10px;">${escapeHtml(campaign.ctaLabel)}</a>
    </div>
    <p style="color: #9CA3AF; font-size: 13px; line-height: 1.6; margin: 0 0 24px;">
      If the button doesn't work, copy and paste this address into your browser:<br>
      <span style="color: #6B7280; word-break: break-all;">${safeCtaUrl}</span>
    </p>
    <hr style="border: none; border-top: 1px solid #1F2937; margin: 0 0 20px;">
    <p style="color: #6B7280; font-size: 12px; text-align: center; margin: 0 0 8px;">
      You're receiving this because you joined the MyLocalTrade Early Access list and confirmed your email address.
    </p>
    <p style="color: #6B7280; font-size: 12px; text-align: center; margin: 0 0 8px;">
      <a href="${unsubscribeHref}" style="color: #6B7280; text-decoration: underline;">Unsubscribe</a>${brevoNativeUnsub} · <a href="${publicBase}/privacy-policy" style="color: #6B7280; text-decoration: underline;">Privacy Policy</a> · <a href="${publicBase}/contact" style="color: #6B7280; text-decoration: underline;">Contact us</a>
    </p>
    <p style="color: #6B7280; font-size: 12px; text-align: center; margin: 0;">
      MyLocalTrade · Service Provider LTD · Company No: 15830141 · 71-75 Shelton Street, London, WC2H 9JQ
    </p>
  </div>
</body>
</html>`;

  const text = `${opts.isTest ? "[TEST EMAIL]\n\n" : ""}${campaign.heading}

${greetingText}

${campaign.bodyText.trim()}

${campaign.ctaLabel}: ${campaign.ctaUrl}

—
You're receiving this because you joined the MyLocalTrade Early Access list and confirmed your email address.
Unsubscribe: ${opts.brevoMergeTags ? `${publicBase}/unsubscribe?token={{ contact.EA_UNSUB_TOKEN }}` : (opts.unsubscribeUrl ?? `${publicBase}/unsubscribe`)}
Privacy Policy: ${publicBase}/privacy-policy · Contact: ${publicBase}/contact
MyLocalTrade · Service Provider LTD · Company No: 15830141 · 71-75 Shelton Street, London, WC2H 9JQ`;

  return { html, text };
}
