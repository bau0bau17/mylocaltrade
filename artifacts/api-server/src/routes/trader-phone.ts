import { Router, type IRouter } from "express";
import bcryptjs from "bcryptjs";
import { db } from "@workspace/db";
import { traderProfilesTable, usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { authMiddleware } from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { TRADER_STATUS, logAudit } from "../lib/trader-status";

const router: IRouter = Router();

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const UK_PHONE_REGEX = /^(\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}$/;

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalisePhone(input: string): string {
  return input.replace(/\s+/g, "").trim();
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

    // Optional: allow updating phone in same call.
    const newPhoneRaw = typeof (req.body as { phone?: unknown })?.phone === "string"
      ? (req.body as { phone: string }).phone
      : null;

    let phoneToUse = profile.phone;
    if (newPhoneRaw && newPhoneRaw.trim().length > 0) {
      const cleaned = normalisePhone(newPhoneRaw);
      if (!UK_PHONE_REGEX.test(newPhoneRaw.trim())) {
        res.status(400).json({ error: "Please enter a valid UK mobile number (07… or +447…)." });
        return;
      }
      phoneToUse = cleaned;
    }

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

    const code = generateOtp();
    const codeHash = await bcryptjs.hash(code, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

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

    // MOCK SMS — print to server console. Replace with real SMS provider later.
    req.log.info({ userId: user.id, phone: phoneToUse, code }, "[MOCK SMS] Trader phone OTP");

    logAudit({ userId: user.id, action: "PHONE_OTP_SENT", details: { phone: phoneToUse } });

    res.json({
      message: "Verification code sent.",
      phoneMasked: maskPhone(phoneToUse),
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      // Mock-only convenience: include code in dev so testers can grab it without server logs.
      // TODO Phase 8: gate behind NODE_ENV !== 'production' (already true here for now).
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

    if (!profile.phoneOtpHash || !profile.phoneOtpExpiresAt) {
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

    const ok = await bcryptjs.compare(code, profile.phoneOtpHash);
    if (!ok) {
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

export default router;
