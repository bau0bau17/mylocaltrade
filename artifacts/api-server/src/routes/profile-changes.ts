import { Router, type IRouter } from "express";
import bcryptjs from "bcryptjs";
import { randomInt } from "crypto";
import { db } from "@workspace/db";
import {
  phoneChangeVerificationsTable,
  profileChangeRequestsTable,
  profileChangeRequestEventsTable,
  usersTable,
} from "@workspace/db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
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
import {
  loadChangeContext,
  traderChangeControlActive,
  customerChangeControlActive,
  createChangeRequest,
  ActiveRequestExistsError,
  serializeOwnRequest,
  normValue,
  PROTECTED_TRADER_FIELDS,
  PROTECTED_CUSTOMER_FIELDS,
} from "../lib/profile-change";
import { takePhoneSendSlot, canonicalPhoneKey } from "./trader-phone";

const router: IRouter = Router();

// Same guardrails as the onboarding phone-verification flow (Part 3: reuse
// the existing rate limiting, cooldown, expiry and attempt rules).
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
// How long a successful OTP check remains usable to submit the change request.
const VERIFIED_WINDOW_MS = 15 * 60 * 1000;
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

// ---------------------------------------------------------------------------
// GET /api/profile/change-requests — my own requests + whether change control
// applies to my account. Used by the trader Edit Profile screen and the
// customer Personal Details screen to render per-field statuses.
// ---------------------------------------------------------------------------
router.get("/profile/change-requests", authMiddleware, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const ctx = await loadChangeContext(userId);
    if (!ctx) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    const { user, profile } = ctx;

    let changeControlActive = false;
    let protectedFields: readonly string[] = [];
    if (user.role === "trader") {
      changeControlActive = profile ? traderChangeControlActive(profile) : false;
      protectedFields = PROTECTED_TRADER_FIELDS;
    } else if (user.role === "customer") {
      changeControlActive = customerChangeControlActive(user);
      protectedFields = PROTECTED_CUSTOMER_FIELDS;
    }

    const rows = await db
      .select()
      .from(profileChangeRequestsTable)
      .where(eq(profileChangeRequestsTable.userId, userId))
      .orderBy(desc(profileChangeRequestsTable.createdAt))
      .limit(30);

    res.json({
      changeControlActive,
      protectedFields,
      // Current live (approved) values so client screens can show what is
      // active while a change request is pending.
      currentValues: {
        fullName: user.fullName,
        phone: user.phone ?? null,
        // Customer phone-verification status (users table). For traders the
        // authoritative flag lives on trader_profiles instead.
        phoneVerified: user.role === "customer" ? user.phoneVerified : undefined,
      },
      requests: rows.map(serializeOwnRequest),
    });
  } catch (error) {
    req.log.error({ err: error }, "List own change requests failed");
    res.status(500).json({ error: "Failed to load change requests" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/profile/change-requests/:id/cancel — withdraw my own active
// request (e.g. after an admin asked for more information).
// ---------------------------------------------------------------------------
router.post(
  "/profile/change-requests/:id/cancel",
  authMiddleware,
  async (req, res) => {
    try {
      const { userId, userRole } = req as AuthenticatedRequest;
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid request id" });
        return;
      }

      const [updated] = await db
        .update(profileChangeRequestsTable)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(
          and(
            eq(profileChangeRequestsTable.id, id),
            eq(profileChangeRequestsTable.userId, userId),
            inArray(profileChangeRequestsTable.status, ["PENDING", "NEEDS_INFO"]),
          ),
        )
        .returning();
      if (!updated) {
        res.status(404).json({ error: "No active change request found" });
        return;
      }

      await db.insert(profileChangeRequestEventsTable).values({
        requestId: updated.id,
        actorUserId: userId,
        actorRole: userRole === "trader" ? "trader" : "customer",
        eventType: "CANCELLED",
        note: null,
      });
      logAudit({
        userId,
        action: "PROFILE_CHANGE_CANCELLED",
        details: { requestId: updated.id, field: updated.field },
      });

      res.json({ request: serializeOwnRequest(updated) });
    } catch (error) {
      req.log.error({ err: error }, "Cancel change request failed");
      res.status(500).json({ error: "Failed to cancel change request" });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/profile/phone-change/send-otp — start verification of a PROPOSED
// new number. Mirrors the onboarding flow (Twilio Verify primary, email
// fallback) but never touches the live phone fields: state lives in
// phone_change_verifications until the request is created.
// ---------------------------------------------------------------------------
router.post("/profile/phone-change/send-otp", authMiddleware, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const ctx = await loadChangeContext(userId);
    if (!ctx || (ctx.user.role !== "trader" && ctx.user.role !== "customer")) {
      res.status(403).json({ error: "Customer or trader account required" });
      return;
    }
    const { user, profile } = ctx;

    if (!user.emailVerified) {
      res.status(400).json({ error: "Verify your email before requesting a phone code." });
      return;
    }

    const phoneRaw = typeof (req.body as { phone?: unknown })?.phone === "string"
      ? (req.body as { phone: string }).phone.trim()
      : "";
    if (!phoneRaw || !UK_PHONE_REGEX.test(phoneRaw)) {
      res.status(400).json({ error: "Please enter a valid UK mobile number (07… or +447…)." });
      return;
    }

    // No-op guard: proposing the number already on record is not a change.
    const currentPhone = user.role === "trader" ? profile?.phone ?? null : user.phone;
    if (
      currentPhone &&
      (toUkE164(currentPhone) ?? normalisePhone(currentPhone)) ===
        (toUkE164(phoneRaw) ?? normalisePhone(phoneRaw))
    ) {
      res.status(400).json({ error: "This is already your current phone number." });
      return;
    }

    // An active request for the phone field blocks starting another change.
    const [activePhoneReq] = await db
      .select({ id: profileChangeRequestsTable.id })
      .from(profileChangeRequestsTable)
      .where(
        and(
          eq(profileChangeRequestsTable.userId, userId),
          eq(profileChangeRequestsTable.field, "phone"),
          inArray(profileChangeRequestsTable.status, ["PENDING", "NEEDS_INFO"]),
        ),
      )
      .limit(1);
    if (activePhoneReq) {
      res.status(409).json({
        error:
          "A phone number change is already pending review. Please wait for a decision before submitting another change.",
      });
      return;
    }

    // Per-account resend cooldown (durable, in the DB).
    const [existing] = await db
      .select()
      .from(phoneChangeVerificationsTable)
      .where(eq(phoneChangeVerificationsTable.userId, userId))
      .limit(1);
    if (existing?.otpLastSentAt) {
      const elapsed = Date.now() - existing.otpLastSentAt.getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        res.status(429).json({
          error: `Please wait ${retryAfter}s before requesting another code.`,
          retryAfter,
        });
        return;
      }
    }

    // Per-number hourly cap shared with the onboarding flow (same in-memory
    // bucket, so a number cannot be bombed by mixing the two flows).
    const slot = takePhoneSendSlot(canonicalPhoneKey(phoneRaw));
    if (!slot.allowed) {
      res.status(429).json({
        error: "Too many codes requested for this number. Please try again later.",
        retryAfter: slot.retryAfter,
      });
      return;
    }

    const now = new Date();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    if (isTwilioVerifyConfigured()) {
      const e164 = toUkE164(phoneRaw);
      if (!e164) {
        res.status(400).json({ error: "Please enter a valid UK mobile number (07… or +447…)." });
        return;
      }
      try {
        const started = await startPhoneVerification(e164);
        if (!started.ok) {
          req.log.error({ userId, status: started.status }, "Twilio Verify start not pending (phone change)");
          res.status(503).json({ error: "Could not send verification code. Please try again shortly." });
          return;
        }
      } catch (err) {
        req.log.error({ err, userId }, "Twilio Verify start threw (phone change)");
        res.status(503).json({ error: "Could not send verification code. Please try again shortly." });
        return;
      }

      await db
        .insert(phoneChangeVerificationsTable)
        .values({
          userId,
          phone: e164,
          otpHash: null,
          otpExpiresAt: expiresAt,
          otpAttempts: 0,
          otpLastSentAt: now,
          verifiedAt: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: phoneChangeVerificationsTable.userId,
          set: {
            phone: e164,
            otpHash: null,
            otpExpiresAt: expiresAt,
            otpAttempts: 0,
            otpLastSentAt: now,
            verifiedAt: null,
            updatedAt: now,
          },
        });

      logAudit({ userId, action: "PHONE_OTP_SENT", details: { phone: e164, channel: "sms", purpose: "phone_change" } });
      res.json({
        message: "Verification code sent by SMS.",
        phoneMasked: maskPhone(e164),
        expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
        mockCode: undefined,
      });
      return;
    }

    // Fallback (no Twilio configured, e.g. local dev): email-delivered code.
    const phoneToUse = normalisePhone(phoneRaw);
    const code = generateOtp();
    const codeHash = await bcryptjs.hash(code, 10);
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
      req.log.error({ err, userId }, "Phone change OTP delivery threw");
      res.status(503).json({ error: "Could not send verification code. Please try again shortly." });
      return;
    }
    if (!delivery.delivered) {
      req.log.error({ userId }, "Phone change OTP not delivered (no transport)");
      res.status(503).json({ error: "Could not send verification code. Please try again shortly." });
      return;
    }

    await db
      .insert(phoneChangeVerificationsTable)
      .values({
        userId,
        phone: phoneToUse,
        otpHash: codeHash,
        otpExpiresAt: expiresAt,
        otpAttempts: 0,
        otpLastSentAt: now,
        verifiedAt: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: phoneChangeVerificationsTable.userId,
        set: {
          phone: phoneToUse,
          otpHash: codeHash,
          otpExpiresAt: expiresAt,
          otpAttempts: 0,
          otpLastSentAt: now,
          verifiedAt: null,
          updatedAt: now,
        },
      });

    logAudit({ userId, action: "PHONE_OTP_SENT", details: { phone: phoneToUse, channel: delivery.channel, purpose: "phone_change" } });
    res.json({
      message:
        delivery.channel === "email"
          ? "Verification code sent to your email."
          : "Verification code sent.",
      phoneMasked: maskPhone(phoneToUse),
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      mockCode: process.env.NODE_ENV === "production" ? undefined : code,
    });
  } catch (error) {
    req.log.error({ err: error }, "Phone change send OTP failed");
    res.status(500).json({ error: "Could not send verification code." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/profile/phone-change/verify — check the OTP and, on success,
// create the pending change request. The live number is NOT replaced; it
// stays active until an admin approves the request.
// ---------------------------------------------------------------------------
router.post("/profile/phone-change/verify", authMiddleware, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const ctx = await loadChangeContext(userId);
    if (!ctx || (ctx.user.role !== "trader" && ctx.user.role !== "customer")) {
      res.status(403).json({ error: "Customer or trader account required" });
      return;
    }
    const { user, profile } = ctx;

    const codeRaw = (req.body as { code?: unknown })?.code;
    const code = typeof codeRaw === "string" ? codeRaw.trim() : "";
    if (!/^\d{6}$/.test(code)) {
      res.status(400).json({ error: "Enter the 6-digit code." });
      return;
    }

    const [pending] = await db
      .select()
      .from(phoneChangeVerificationsTable)
      .where(eq(phoneChangeVerificationsTable.userId, userId))
      .limit(1);
    if (!pending || !pending.otpExpiresAt) {
      res.status(400).json({ error: "Request a verification code first." });
      return;
    }
    if (pending.otpExpiresAt.getTime() < Date.now()) {
      res.status(400).json({ error: "This code has expired. Please request a new one." });
      return;
    }
    if (pending.otpAttempts >= MAX_ATTEMPTS) {
      res.status(429).json({ error: "Too many incorrect attempts. Please request a new code." });
      return;
    }

    const useTwilio = isTwilioVerifyConfigured() && !pending.otpHash;
    let approved = false;
    if (useTwilio) {
      const e164 = toUkE164(pending.phone);
      if (!e164) {
        res.status(400).json({ error: "Request a verification code first." });
        return;
      }
      try {
        const result = await checkPhoneVerification(e164, code);
        approved = result.approved;
      } catch (err) {
        req.log.error({ err, userId }, "Twilio Verify check threw (phone change)");
        res.status(503).json({ error: "Could not verify code. Please try again shortly." });
        return;
      }
    } else {
      if (!pending.otpHash) {
        res.status(400).json({ error: "Request a verification code first." });
        return;
      }
      approved = await bcryptjs.compare(code, pending.otpHash);
    }

    if (!approved) {
      await db
        .update(phoneChangeVerificationsTable)
        .set({ otpAttempts: pending.otpAttempts + 1, updatedAt: new Date() })
        .where(eq(phoneChangeVerificationsTable.userId, userId));
      logAudit({ userId, action: "PHONE_OTP_FAILED", details: { purpose: "phone_change" } });
      res.status(400).json({
        error: "Incorrect code.",
        attemptsRemaining: Math.max(0, MAX_ATTEMPTS - (pending.otpAttempts + 1)),
      });
      return;
    }

    const verifiedAt = new Date();
    await db
      .update(phoneChangeVerificationsTable)
      .set({
        verifiedAt,
        otpHash: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        updatedAt: verifiedAt,
      })
      .where(eq(phoneChangeVerificationsTable.userId, userId));

    // Change control not yet active (e.g. trader still onboarding) shouldn't
    // reach this flow, but if it does, apply the number directly rather than
    // creating a review request nobody needs.
    const role = user.role as "trader" | "customer";
    const controlActive =
      role === "trader"
        ? profile != null && traderChangeControlActive(profile)
        : customerChangeControlActive(user);

    const currentPhone = role === "trader" ? profile?.phone ?? null : user.phone;

    if (!controlActive) {
      // Pre-establishment accounts use the onboarding verify flow instead.
      res.status(409).json({
        error:
          role === "trader"
            ? "Your profile has not been submitted for review yet — update your phone number from Edit Profile or the phone verification step."
            : "Your account is not yet established. Verify your email first.",
      });
      return;
    }

    if (verifiedAt.getTime() - (pending.otpLastSentAt?.getTime() ?? 0) > VERIFIED_WINDOW_MS + OTP_TTL_MS) {
      res.status(400).json({ error: "This verification has expired. Please request a new code." });
      return;
    }

    let request;
    try {
      request = await createChangeRequest({
        userId,
        role,
        traderProfileId: profile?.id ?? null,
        field: "phone",
        currentValue: normValue(currentPhone),
        proposedValue: pending.phone,
        phoneOtpVerified: true,
        phoneOtpVerifiedAt: verifiedAt,
      });
    } catch (err) {
      if (err instanceof ActiveRequestExistsError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }

    // Clear the verification row so the proof cannot be replayed.
    await db
      .delete(phoneChangeVerificationsTable)
      .where(eq(phoneChangeVerificationsTable.userId, userId));

    res.json({
      message:
        "Your new number has been verified and submitted for review. Your current approved number will remain active while we review the request.",
      request: serializeOwnRequest(request),
    });
  } catch (error) {
    req.log.error({ err: error }, "Phone change verify failed");
    res.status(500).json({ error: "Could not verify code." });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/account/personal-details — customer identity edits (full name).
// Before the account is established (email verified) the change applies
// directly; afterwards it becomes a pending change request. Phone changes
// always go through the OTP flow above.
// ---------------------------------------------------------------------------
router.put("/account/personal-details", authMiddleware, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const ctx = await loadChangeContext(userId);
    if (!ctx || ctx.user.role !== "customer") {
      res.status(403).json({ error: "Customer account required" });
      return;
    }
    const { user } = ctx;

    const body = (req.body ?? {}) as { fullName?: unknown; phone?: unknown };
    if (body.phone !== undefined) {
      res.status(400).json({
        error: "Phone number changes must be verified first. Use the change phone number flow.",
        code: "PHONE_CHANGE_REQUIRES_VERIFICATION",
      });
      return;
    }

    const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
    if (fullName.length < 2 || fullName.length > 255) {
      res.status(400).json({ error: "Please enter your full name." });
      return;
    }

    if (normValue(fullName) === normValue(user.fullName)) {
      res.json({ message: "No changes to save.", changeRequests: [], fullName: user.fullName });
      return;
    }

    if (!customerChangeControlActive(user)) {
      await db
        .update(usersTable)
        .set({ fullName, updatedAt: new Date() })
        .where(eq(usersTable.id, userId));
      res.json({ message: "Your details have been updated.", changeRequests: [], fullName });
      return;
    }

    let request;
    try {
      request = await createChangeRequest({
        userId,
        role: "customer",
        field: "fullName",
        currentValue: normValue(user.fullName),
        proposedValue: fullName,
      });
    } catch (err) {
      if (err instanceof ActiveRequestExistsError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }

    res.json({
      message:
        "Your changes have been submitted for review. Your current approved information will remain active while we review the request. We’ll contact you if we need any additional information. Reviews can take up to 48 hours.",
      changeRequests: [serializeOwnRequest(request)],
      fullName: user.fullName,
    });
  } catch (error) {
    req.log.error({ err: error }, "Update personal details failed");
    res.status(500).json({ error: "Failed to update personal details" });
  }
});

export default router;
