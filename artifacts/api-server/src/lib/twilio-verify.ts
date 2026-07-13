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

// Which Verify Service a flow belongs to. Pre-launch plan: traders use a
// Verify Service that may enable RCS; customers use a *separate, SMS-only*
// Verify Service. Until TWILIO_VERIFY_SERVICE_SID_CUSTOMER is set, the
// customer flow falls back to the shared service — but always over the SMS
// channel (RCS is never requested for customers).
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
}

export async function startPhoneVerification(
  phoneE164: string,
  kind: VerifyServiceKind = "trader",
): Promise<StartVerificationResult> {
  const client = getClient();
  if (!client) return { ok: false };
  const serviceSid = twilioCreds(kind).serviceSid as string;
  // Channel is always "sms" here. If the trader service later enables RCS,
  // that is a service-level Twilio setting — the customer service must stay
  // SMS-only, which the split service SIDs above preserve.
  const verification = await client.verify.v2
    .services(serviceSid)
    .verifications.create({ to: phoneE164, channel: "sms" });
  return { ok: verification.status === "pending", status: verification.status };
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
