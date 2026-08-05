import { Router, type IRouter } from "express";
import bcryptjs from "bcryptjs";
import { randomInt } from "crypto";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { authMiddleware } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { logAudit } from "../lib/trader-status";
import { deliverTraderPhoneOtp } from "../lib/otp-delivery";
import {
  isTwilioVerifyConfigured,
  startPhoneVerification,
  checkPhoneVerification,
  toUkE164,
} from "../lib/twilio-verify";
import { takePhoneSendSlot, canonicalPhoneKey } from "./trader-phone";

// -----------------------------------------------------------------------------
// Customer phone verification — SMS only.
//
// Mirrors the trader onboarding flow (trader-phone.ts) with the same
// guardrails (per-number hourly cap, per-account 60s cooldown, 10 min TTL,
// 5 attempts) but operates on the users table and uses the CUSTOMER Twilio
// Verify Service (SMS-only; see twilio-verify.ts — customers must never be
// sent RCS). Phone is optional at registration; this flow is what unlocks
// contacting traders (see customer-phone-gate.ts).
// -----------------------------------------------------------------------------

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

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return phone;
  return `••• ••• ${digits.slice(-4)}`;
}

async function loadCustomer(req: AuthenticatedRequest) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.userId))
    .limit(1);
  if (!user || user.role !== "customer") return null;
  return user;
}

router.post("/customer/phone/send-otp", authMiddleware, async (req, res) => {
  try {
    const auth = req as AuthenticatedRequest;
    const user = await loadCustomer(auth);
    if (!user) {
      res.status(403).json({ error: "Customer account required" });
      return;
    }

    if (!user.emailVerified) {
      res.status(400).json({ error: "Verify your email before requesting a phone code." });
      return;
    }
    if (user.phoneVerified) {
      res.status(400).json({ error: "Your phone number is already verified." });
      return;
    }

    // Phone was optional at registration, so this call may both set and
    // verify the number in one go.
    const newPhoneRaw = typeof (req.body as { phone?: unknown })?.phone === "string"
      ? (req.body as { phone: string }).phone
      : null;

    let phoneToUse = user.phone;
    if (newPhoneRaw && newPhoneRaw.trim().length > 0) {
      if (!UK_PHONE_REGEX.test(newPhoneRaw.trim())) {
        res.status(400).json({ error: "Please enter a valid UK mobile number (07… or +447…)." });
        return;
      }
      phoneToUse = normalisePhone(newPhoneRaw);
    }
    if (!phoneToUse || phoneToUse.trim().length === 0) {
      res.status(400).json({ error: "Please enter a UK mobile number first." });
      return;
    }

    // Per-account resend cooldown (durable — lives in the DB).
    if (user.phoneOtpLastSentAt) {
      const elapsed = Date.now() - user.phoneOtpLastSentAt.getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        res.status(429).json({
          error: `Please wait ${retryAfter}s before requesting another code.`,
          retryAfter,
        });
        return;
      }
    }

    // Per-number hourly cap, shared with the trader flow so the same number
    // cannot be bombed through both endpoints.
    const phoneSlot = takePhoneSendSlot(canonicalPhoneKey(phoneToUse));
    if (!phoneSlot.allowed) {
      res.status(429).json({
        error: "Too many codes requested for this number. Please try again later.",
        retryAfter: phoneSlot.retryAfter,
      });
      return;
    }

    // Primary path: Twilio Verify (customer SMS-only service) sends the SMS
    // and owns the code — no local hash (phoneOtpHash = null).
    if (isTwilioVerifyConfigured("customer")) {
      const e164 = toUkE164(phoneToUse);
      if (!e164) {
        res.status(400).json({ error: "Please enter a valid UK mobile number (07… or +447…)." });
        return;
      }

      try {
        const started = await startPhoneVerification(e164, "customer");
        if (!started.ok) {
          req.log.error({ userId: user.id, status: started.status }, "Twilio Verify start not pending (customer)");
          res.status(503).json({ error: "Could not send verification code. Please try again shortly." });
          return;
        }
      } catch (err) {
        req.log.error({ err, userId: user.id }, "Twilio Verify start threw (customer)");
        res.status(503).json({ error: "Could not send verification code. Please try again shortly." });
        return;
      }

      await db
        .update(usersTable)
        .set({
          phone: e164,
          phoneOtpHash: null,
          phoneOtpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
          phoneOtpAttempts: 0,
          phoneOtpLastSentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, user.id));

      req.log.info({ userId: user.id, channel: "sms" }, "Customer phone OTP dispatched via Twilio Verify");
      logAudit({ userId: user.id, action: "PHONE_OTP_SENT", details: { phone: e164, channel: "sms" } });

      res.json({
        message: "Verification code sent by SMS.",
        phoneMasked: maskPhone(e164),
        expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
        // Twilio owns the code — never surface it, even in dev.
        mockCode: undefined,
      });
      return;
    }

    // Fallback path (no Twilio configured, e.g. local dev): self-generated
    // code delivered by email — same transport helper as the trader flow.
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
      req.log.error({ err, userId: user.id }, "Customer phone OTP delivery threw");
      res.status(503).json({ error: "Could not send verification code. Please try again shortly." });
      return;
    }
    if (!delivery.delivered) {
      req.log.error({ userId: user.id }, "Customer phone OTP not delivered (no transport)");
      res.status(503).json({ error: "Could not send verification code. Please try again shortly." });
      return;
    }

    await db
      .update(usersTable)
      .set({
        phone: phoneToUse,
        phoneOtpHash: codeHash,
        phoneOtpExpiresAt: expiresAt,
        phoneOtpAttempts: 0,
        phoneOtpLastSentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));

    req.log.info(
      { userId: user.id, phone: phoneToUse, channel: delivery.channel, delivered: delivery.delivered },
      "Customer phone OTP dispatched",
    );

    logAudit({
      userId: user.id,
      action: "PHONE_OTP_SENT",
      details: { phone: phoneToUse, channel: delivery.channel },
    });

    res.json({
      message:
        delivery.channel === "email"
          ? "Verification code sent to your email."
          : "Verification code sent.",
      phoneMasked: maskPhone(phoneToUse),
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      // Dev-only convenience; always undefined in production.
      mockCode: process.env.NODE_ENV === "production" ? undefined : code,
    });
  } catch (error) {
    req.log.error({ err: error }, "Customer send phone OTP failed");
    res.status(500).json({ error: "Could not send verification code." });
  }
});

router.post("/customer/phone/verify", authMiddleware, async (req, res) => {
  try {
    const auth = req as AuthenticatedRequest;
    const user = await loadCustomer(auth);
    if (!user) {
      res.status(403).json({ error: "Customer account required" });
      return;
    }

    const codeRaw = (req.body as { code?: unknown })?.code;
    const code = typeof codeRaw === "string" ? codeRaw.trim() : "";
    if (!/^\d{6}$/.test(code)) {
      res.status(400).json({ error: "Enter the 6-digit code." });
      return;
    }

    if (user.phoneVerified) {
      res.json({ message: "Phone already verified.", phoneVerified: true });
      return;
    }

    if (!user.phoneOtpExpiresAt) {
      res.status(400).json({ error: "Request a verification code first." });
      return;
    }
    if (user.phoneOtpExpiresAt.getTime() < Date.now()) {
      res.status(400).json({ error: "This code has expired. Please request a new one." });
      return;
    }
    if (user.phoneOtpAttempts >= MAX_ATTEMPTS) {
      res.status(429).json({ error: "Too many incorrect attempts. Please request a new code." });
      return;
    }

    // Twilio path when configured and no local hash is pending; otherwise the
    // locally-generated (email fallback) code.
    const useTwilio = isTwilioVerifyConfigured("customer") && !user.phoneOtpHash;

    let approved = false;
    if (useTwilio) {
      const e164 = user.phone ? toUkE164(user.phone) : null;
      if (!e164) {
        res.status(400).json({ error: "Request a verification code first." });
        return;
      }
      try {
        const result = await checkPhoneVerification(e164, code, "customer");
        approved = result.approved;
      } catch (err) {
        req.log.error({ err, userId: user.id }, "Twilio Verify check threw (customer)");
        res.status(503).json({ error: "Could not verify code. Please try again shortly." });
        return;
      }
    } else {
      if (!user.phoneOtpHash) {
        res.status(400).json({ error: "Request a verification code first." });
        return;
      }
      approved = await bcryptjs.compare(code, user.phoneOtpHash);
    }

    if (!approved) {
      await db
        .update(usersTable)
        .set({
          phoneOtpAttempts: sql`${usersTable.phoneOtpAttempts} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, user.id));
      logAudit({ userId: user.id, action: "PHONE_OTP_FAILED" });
      res.status(400).json({
        error: "Incorrect code.",
        attemptsRemaining: Math.max(0, MAX_ATTEMPTS - (user.phoneOtpAttempts + 1)),
      });
      return;
    }

    await db
      .update(usersTable)
      .set({
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
        phoneOtpHash: null,
        phoneOtpExpiresAt: null,
        phoneOtpAttempts: 0,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));

    logAudit({ userId: user.id, action: "PHONE_VERIFIED" });

    res.json({ message: "Phone verified.", phoneVerified: true });
  } catch (error) {
    req.log.error({ err: error }, "Customer verify phone OTP failed");
    res.status(500).json({ error: "Could not verify code." });
  }
});

export default router;
