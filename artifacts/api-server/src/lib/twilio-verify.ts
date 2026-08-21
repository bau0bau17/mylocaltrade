import twilio from "twilio";

// Twilio Verify integration for phone (SMS) OTP.
//
// With Twilio Verify, Twilio generates, stores, expires and checks the code on
// their side — we never see or persist the code. We keep our own cooldown /
// attempt guardrails in routes/trader-phone.ts purely to cap SMS cost; Twilio
// Verify also enforces its own per-number limits on top.
//
// Credentials come from three secrets (never hard-code them):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID
// When they are absent (e.g. local dev), callers fall back to the existing
// self-generated email OTP path.
//
// Note: Twilio's built-in "Test Credentials" do NOT work with the Verify API —
// these must be real account credentials (a trial account is fine for testing;
// SMS can only be sent to verified numbers on a trial).

// Which Verify Service a flow belongs to. Both roles may use Verify RCS
// Upgrade; a separate customer service can be supplied with
// TWILIO_VERIFY_SERVICE_SID_CUSTOMER. Until that variable is set, the
// customer flow falls back to the shared service.
export type VerifyServiceKind = "trader" | "customer";

function serviceSidFor(kind: VerifyServiceKind): string | undefined {
  if (kind === "customer") {
    return (
      process.env.TWILIO_VERIFY_SERVICE_SID_CUSTOMER ||
      process.env.TWILIO_VERIFY_SERVICE_SID
    );
  }
  return process.env.TWILIO_VERIFY_SERVICE_SID;
}

export function twilioCreds(kind: VerifyServiceKind = "trader"): {
  accountSid?: string;
  authToken?: string;
  serviceSid?: string;
} {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    serviceSid: serviceSidFor(kind),
  };
}

export function isTwilioVerifyConfigured(kind: VerifyServiceKind = "trader"): boolean {
  const { accountSid, authToken, serviceSid } = twilioCreds(kind);
  return Boolean(accountSid && authToken && serviceSid);
}

let cachedClient: ReturnType<typeof twilio> | null = null;

function getClient(): ReturnType<typeof twilio> | null {
  const { accountSid, authToken } = twilioCreds();
  if (!accountSid || !authToken) return null;
  if (!cachedClient) {
    cachedClient = twilio(accountSid, authToken);
  }
  return cachedClient;
}

// Normalise a UK mobile number to E.164 (+447XXXXXXXXX). Accepts the common
// formats testers use — "07123 456789", "+44 7123 456789", "447123456789",
// "00447123456789" — and returns null when the input is not a plausible UK
// mobile so the caller can reject it before spending an SMS.
export function toUkE164(input: string): string | null {
  let digits = input.replace(/[\s()\-.]/g, "");
  if (digits.startsWith("+")) {
    return /^\+447\d{9}$/.test(digits) ? digits : null;
  }
  if (digits.startsWith("0044")) digits = digits.slice(4);
  else if (digits.startsWith("44")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  return /^7\d{9}$/.test(digits) ? `+44${digits}` : null;
}

export interface StartVerificationResult {
  ok: boolean;
  status?: string;
  verificationAttemptSid?: string;
}

export async function startPhoneVerification(
  phoneE164: string,
  kind: VerifyServiceKind = "trader",
): Promise<StartVerificationResult> {
  const client = getClient();
  if (!client) return { ok: false };
  const serviceSid = twilioCreds(kind).serviceSid as string;
  // channel=sms is intentional: Verify RCS Upgrade may upgrade this delivery
  // to RCS and automatically fall back to SMS when RCS is unavailable.
  const verification = await client.verify.v2
    .services(serviceSid)
    .verifications.create({ to: phoneE164, channel: "sms" });
  const typedVerification = verification as {
    status?: string;
    sendCodeAttempts?: Array<{ attemptSid?: string }>;
  };
  const latestAttempt =
    typedVerification.sendCodeAttempts?.[typedVerification.sendCodeAttempts.length - 1];
  return {
    ok: verification.status === "pending",
    status: verification.status,
    verificationAttemptSid: latestAttempt?.attemptSid,
  };
}

export type VerificationDeliveryChannel = "RCS" | "SMS fallback" | "unknown";

export interface VerificationAttemptOutcome {
  channel: VerificationDeliveryChannel;
  messageStatus?: string;
  conversionStatus?: string;
}

/**
 * Verify's RCS upgrade is represented by the RBM channel in the Attempts API.
 * The create-verification response intentionally remains unchanged, so the
 * final delivery channel is read from the attempt resource instead.
 */
export function normalizeVerificationDeliveryChannel(
  channel: unknown,
): VerificationDeliveryChannel {
  const normalized = typeof channel === "string" ? channel.toLowerCase() : "";
  if (normalized === "rbm" || normalized === "rcs") return "RCS";
  if (normalized === "sms") return "SMS fallback";
  return "unknown";
}

export async function fetchVerificationAttemptOutcome(
  verificationAttemptSid: string,
): Promise<VerificationAttemptOutcome | null> {
  const client = getClient();
  if (!client) return null;

  const attempt = await client.verify.v2
    .verificationAttempts(verificationAttemptSid)
    .fetch();
  const typedAttempt = attempt as {
    channel?: unknown;
    messageStatus?: unknown;
    conversionStatus?: unknown;
  };
  return {
    channel: normalizeVerificationDeliveryChannel(typedAttempt.channel),
    ...(typeof typedAttempt.messageStatus === "string"
      ? { messageStatus: typedAttempt.messageStatus }
      : {}),
    ...(typeof typedAttempt.conversionStatus === "string"
      ? { conversionStatus: typedAttempt.conversionStatus }
      : {}),
  };
}

export interface CheckVerificationResult {
  approved: boolean;
  status?: string;
}

export async function checkPhoneVerification(
  phoneE164: string,
  code: string,
  kind: VerifyServiceKind = "trader",
): Promise<CheckVerificationResult> {
  const client = getClient();
  if (!client) return { approved: false };
  const serviceSid = twilioCreds(kind).serviceSid as string;
  try {
    const check = await client.verify.v2
      .services(serviceSid)
      .verificationChecks.create({ to: phoneE164, code });
    return { approved: check.status === "approved", status: check.status };
  } catch (err) {
    // Twilio returns 404 when there is no pending verification for the number
    // (expired, already approved, or max check attempts reached). Treat as a
    // non-fatal "not approved" so the caller returns the standard
    // incorrect-code response rather than a 500.
    if ((err as { status?: number })?.status === 404) {
      return { approved: false, status: "expired" };
    }
    throw err;
  }
}
