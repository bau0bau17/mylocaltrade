import { Router, type IRouter } from "express";
import bcryptjs from "bcryptjs";
import { randomInt } from "crypto";
import { db } from "@workspace/db";
import { traderProfilesTable, usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { authMiddleware } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { TRADER_STATUS, logAudit } from "../lib/trader-status";
import { deliverTraderPhoneOtp } from "../lib/otp-delivery";
import {
  fetchVerificationAttemptOutcome,
  isTwilioVerifyConfigured,
  startPhoneVerification,
  checkPhoneVerification,
  toUkE164,
} from "../lib/twilio-verify";

const router: IRouter = Router();

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const UK_PHONE_REGEX = /^(\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}$/;

function generateOtp(): string {
  return String(randomInt(100000, 1000000));
}

function normalisePhone(input: string): string {
  return input.replace(/\s+/g, "").trim();
}

// Per-number send cap (SMS-bombing protection). Applies to EVERY send-otp call
// — including the default "verify my registered number" flow — keyed on the
// canonical E.164 so 07…/+447…/447… variants of the same number share one
// bucket. This complements the per-device (IP) cap in app.ts and the per-account
// 60s cooldown below. In-memory, matching this codebase's existing
// express-rate-limit MemoryStore approach (per-instance under autoscale).
const PHONE_SEND_WINDOW_MS = 60 * 60 * 1000;
const PHONE_SEND_MAX = 5;
const phoneSendCounts = new Map<string, { count: number; resetAt: number }>();

export function takePhoneSendSlot(phoneKey: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  // Opportunistic sweep so the map cannot grow without bound.
  if (phoneSendCounts.size > 2000) {
    for (const [key, entry] of phoneSendCounts) {
      if (entry.resetAt <= now) phoneSendCounts.delete(key);
    }
  }
  const existing = phoneSendCounts.get(phoneKey);
  if (!existing || existing.resetAt <= now) {
    phoneSendCounts.set(phoneKey, { count: 1, resetAt: now + PHONE_SEND_WINDOW_MS });
    return { allowed: true };
  }
  if (existing.count >= PHONE_SEND_MAX) {
    return { allowed: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }
  existing.count += 1;
  return { allowed: true };
}

export function canonicalPhoneKey(phone: string): string {
  return toUkE164(phone) ?? normalisePhone(phone).toLowerCase();
}

async function loadTrader(req: AuthenticatedRequest) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId)).limit(1);
  if (!user || user.role !== "trader") return null;
  const [profile] = await db.select().from(traderProfilesTable).where(eq(traderProfilesTable.userId, user.id)).limit(1);
  if (!profile) return null;
  return { user, profile };
}

router.post("/trader/phone/send-otp", authMiddleware, async (req, res) => {
  try {
    const auth = req as AuthenticatedRequest;
    const ctx = await loadTrader(auth);
    if (!ctx) {
      res.status(403).json({ error: "Trader account required" });
      return;
    }
    const { user, profile } = ctx;

    if (!user.emailVerified) {
      res.status(400).json({ error: "Verify your email before requesting a phone code." });
      return;
    }
    if (profile.phoneVerified) {
      res.status(400).json({ error: "Your phone number is already verified." });
      return;
    }

    // Optional: allow updating the phone in the same call.
    const newPhoneRaw = typeof (req.body as { phone?: unknown })?.phone === "string"
      ? (req.body as { phone: string }).phone
      : null;

    let phoneToUse = profile.phone;
    if (newPhoneRaw && newPhoneRaw.trim().length > 0) {
      if (!UK_PHONE_REGEX.test(newPhoneRaw.trim())) {
        res.status(400).json({ error: "Please enter a valid UK mobile number (07… or +447…)." });
        return;
      }
      phoneToUse = normalisePhone(newPhoneRaw);
    }

    // Per-account resend cooldown — durable guardrail against resend spam and
    // SMS cost (works across autoscale instances since it lives in the DB).
    if (profile.phoneOtpLastSentAt) {
      const elapsed = Date.now() - profile.phoneOtpLastSentAt.getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        res.status(429).json({
          error: `Please wait ${retryAfter}s before requesting another code.`,
          retryAfter,
        });
        return;
      }
    }

    // Per-number hourly cap — applies to both the registered-number and the
    // "different number" flows, keyed on the canonical number.
    const phoneSlot = takePhoneSendSlot(canonicalPhoneKey(phoneToUse));
    if (!phoneSlot.allowed) {
      res.status(429).json({
        error: "Too many codes requested for this number. Please try again later.",
        retryAfter: phoneSlot.retryAfter,
      });
      return;
    }

    // Primary path: Twilio Verify sends the SMS and owns the code. We store no
    // local hash (phoneOtpHash = null) so /verify knows to check against Twilio.
    if (isTwilioVerifyConfigured()) {
      const e164 = toUkE164(phoneToUse);
      if (!e164) {
        res.status(400).json({ error: "Please enter a valid UK mobile number (07… or +447…)." });
        return;
      }

      try {
        const started = await startPhoneVerification(e164, "trader");
        if (!started.ok) {
          req.log.error({ userId: user.id, status: started.status }, "Twilio Verify start not pending");
          res.status(503).json({ error: "Could not send verification code. Please try again shortly." });
          return;
        }
        observeVerificationAttempt(auth, user.id, started.verificationAttemptSid);
      } catch (err) {
        const code =
          typeof err === "object" && err !== null && "code" in err
            ? String((err as { code?: unknown }).code)
            : undefined;
        req.log.error(
          { userId: user.id, provider: "twilio_verify", code },
          "Twilio Verify start threw",
        );
        res.status(503).json({ error: "Could not send verification code. Please try again shortly." });
        return;
      }

      await db
        .update(traderProfilesTable)
        .set({
          phone: e164,
          phoneOtpHash: null,
          phoneOtpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
          phoneOtpAttempts: 0,
          phoneOtpLastSentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(traderProfilesTable.userId, user.id));

      req.log.info(
        { userId: user.id, provider: "twilio_verify", outcome: "pending" },
        "Trader phone OTP dispatched via Twilio Verify",
      );
      logAudit({
        userId: user.id,
        action: "PHONE_OTP_SENT",
        details: { provider: "twilio_verify", outcome: "pending" },
      });

      res.json({
        message: "Verification code sent.",
        phoneMasked: maskPhone(e164),
        expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
        // Twilio owns the code — never surface it, even in dev.
        mockCode: undefined,
      });
      return;
    }

    // Fallback path (no Twilio configured, e.g. local dev): self-generated code
    // delivered by email, reusing the existing verification logic unchanged.
    const code = generateOtp();
    const codeHash = await bcryptjs.hash(code, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    let delivery: Awaited<ReturnType<typeof deliverTraderPhoneOtp>>;
    try {
      delivery = await deliverTraderPhoneOtp({
        code,
        email: user.email,
        name: user.fullName,
        phone: phoneToUse,
        expiresInMinutes: Math.round(OTP_TTL_MS / 60000),
      });
    } catch (err) {
      req.log.error({ err, userId: user.id }, "Trader phone OTP delivery threw");
      res.status(503).json({ error: "Could not send verification code. Please try again shortly." });
      return;
    }
    if (!delivery.delivered) {
      req.log.error({ userId: user.id }, "Trader phone OTP not delivered (no transport)");
      res.status(503).json({ error: "Could not send verification code. Please try again shortly." });
      return;
    }

    await db
      .update(traderProfilesTable)
      .set({
        phone: phoneToUse,
        phoneOtpHash: codeHash,
        phoneOtpExpiresAt: expiresAt,
        phoneOtpAttempts: 0,
        phoneOtpLastSentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(traderProfilesTable.userId, user.id));

    req.log.info(
      { userId: user.id, channel: delivery.channel, delivered: delivery.delivered },
      "Trader phone OTP dispatched",
    );

    logAudit({
      userId: user.id,
      action: "PHONE_OTP_SENT",
      details: { channel: delivery.channel },
    });

    res.json({
      message:
        delivery.channel === "email"
          ? "Verification code sent to your email."
          : "Verification code sent.",
      phoneMasked: maskPhone(phoneToUse),
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      // Dev-only convenience: include the code in non-production so testers can
      // grab it without opening the inbox. Always undefined in production.
      mockCode: process.env.NODE_ENV === "production" ? undefined : code,
    });
  } catch (error) {
    req.log.error({ err: error }, "Send OTP failed");
    res.status(500).json({ error: "Could not send verification code." });
  }
});

router.post("/trader/phone/verify", authMiddleware, async (req, res) => {
  try {
    const auth = req as AuthenticatedRequest;
    const ctx = await loadTrader(auth);
    if (!ctx) {
      res.status(403).json({ error: "Trader account required" });
      return;
    }
    const { user, profile } = ctx;

    const codeRaw = (req.body as { code?: unknown })?.code;
    const code = typeof codeRaw === "string" ? codeRaw.trim() : "";
    if (!/^\d{6}$/.test(code)) {
      res.status(400).json({ error: "Enter the 6-digit code." });
      return;
    }

    if (profile.phoneVerified) {
      res.json({ message: "Phone already verified.", phoneVerified: true });
      return;
    }

    // A send must have happened (this window is set by both the Twilio and the
    // email path), otherwise there is nothing to check.
    if (!profile.phoneOtpExpiresAt) {
      res.status(400).json({ error: "Request a verification code first." });
      return;
    }
    if (profile.phoneOtpExpiresAt.getTime() < Date.now()) {
      res.status(400).json({ error: "This code has expired. Please request a new one." });
      return;
    }
    if (profile.phoneOtpAttempts >= MAX_ATTEMPTS) {
      res.status(429).json({ error: "Too many incorrect attempts. Please request a new code." });
      return;
    }

    // Twilio path when configured and no local hash is pending; otherwise fall
    // back to comparing the locally-generated (email) code.
    const useTwilio = isTwilioVerifyConfigured() && !profile.phoneOtpHash;

    let approved = false;
    if (useTwilio) {
      const e164 = toUkE164(profile.phone);
      if (!e164) {
        res.status(400).json({ error: "Request a verification code first." });
        return;
      }
      try {
        const result = await checkPhoneVerification(e164, code, "trader");
        approved = result.approved;
      } catch (err) {
        const code =
          typeof err === "object" && err !== null && "code" in err
            ? String((err as { code?: unknown }).code)
            : undefined;
        req.log.error(
          { userId: user.id, provider: "twilio_verify", code },
          "Twilio Verify check threw",
        );
        res.status(503).json({ error: "Could not verify code. Please try again shortly." });
        return;
      }
    } else {
      if (!profile.phoneOtpHash) {
        res.status(400).json({ error: "Request a verification code first." });
        return;
      }
      approved = await bcryptjs.compare(code, profile.phoneOtpHash);
    }

    if (!approved) {
      await db
        .update(traderProfilesTable)
        .set({
          phoneOtpAttempts: sql`${traderProfilesTable.phoneOtpAttempts} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(traderProfilesTable.userId, user.id));
      logAudit({ userId: user.id, action: "PHONE_OTP_FAILED" });
      res.status(400).json({
        error: "Incorrect code.",
        attemptsRemaining: Math.max(0, MAX_ATTEMPTS - (profile.phoneOtpAttempts + 1)),
      });
      return;
    }

    const nextStatus =
      profile.verificationStatus === TRADER_STATUS.PENDING_PHONE_VERIFICATION
        ? TRADER_STATUS.PROFILE_INCOMPLETE
        : profile.verificationStatus;

    await db
      .update(traderProfilesTable)
      .set({
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
        phoneOtpHash: null,
        phoneOtpExpiresAt: null,
        phoneOtpAttempts: 0,
        verificationStatus: nextStatus,
        updatedAt: new Date(),
      })
      .where(eq(traderProfilesTable.userId, user.id));

    logAudit({ userId: user.id, action: "PHONE_VERIFIED" });

    res.json({ message: "Phone verified.", phoneVerified: true, verificationStatus: nextStatus });
  } catch (error) {
    req.log.error({ err: error }, "Verify OTP failed");
    res.status(500).json({ error: "Could not verify code." });
  }
});

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return phone;
  return `••• ••• ${digits.slice(-4)}`;
}

function observeVerificationAttempt(
  req: AuthenticatedRequest,
  userId: number,
  verificationAttemptSid?: string,
): void {
  if (!verificationAttemptSid) {
    req.log.warn({ userId }, "Twilio Verify response did not include an attempt SID");
    return;
  }

  const delaysMs = [2_000, 8_000, 30_000];
  void (async () => {
    for (const delayMs of delaysMs) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delayMs);
        timer.unref?.();
      });
      try {
        const outcome = await fetchVerificationAttemptOutcome(verificationAttemptSid);
        if (!outcome || outcome.channel === "unknown") continue;
        req.log.info(
          {
            userId,
            provider: "twilio_verify",
            verificationAttemptSid,
            channel: outcome.channel,
            messageStatus: outcome.messageStatus,
            conversionStatus: outcome.conversionStatus,
          },
          "Trader phone OTP delivery outcome",
        );
        return;
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String((error as { code?: unknown }).code)
            : undefined;
        req.log.warn(
          { userId, provider: "twilio_verify", verificationAttemptSid, code },
          "Could not read Twilio Verify delivery outcome",
        );
      }
    }
  })();
}

export default router;
