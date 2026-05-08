import { Router, type IRouter } from "express";
import bcryptjs from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, traderProfilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  RegisterCustomerBody,
  RegisterTraderBody,
  LoginBody,
} from "@workspace/api-zod";
import { generateToken, authMiddleware, generatePollToken, verifyPollToken } from "../lib/auth";
import { sendVerificationEmail, generateVerificationToken } from "../lib/email";
import type { AuthenticatedRequest } from "../lib/types";
import { TRADER_STATUS, logAudit, buildOnboardingChecklist, statusMessage, isTraderProfilePublic, evaluateBusinessProfileComplete, evaluateDocumentsComplete } from "../lib/trader-status";
import { traderDocumentsTable } from "@workspace/db/schema";

const RESEND_COOLDOWN_MS = 60 * 1000;

const router: IRouter = Router();

router.post("/auth/register/customer", async (req, res) => {
  try {
    const body = RegisterCustomerBody.parse(req.body);

    const existing = await db.select().from(usersTable).where(eq(usersTable.email, body.email)).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    const passwordHash = await bcryptjs.hash(body.password, 12);
    const verificationToken = generateVerificationToken();

    const [user] = await db.insert(usersTable).values({
      email: body.email,
      passwordHash,
      fullName: body.fullName,
      phone: body.phone || null,
      role: "customer",
      isActive: false,
      emailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationSentAt: new Date(),
    }).returning();

    sendVerificationEmail(user.email, user.fullName, verificationToken).catch((err) =>
      req.log.error({ err }, "Failed to send verification email")
    );

    res.status(201).json({
      message: "Account created. Please check your email to verify your address before logging in.",
      email: user.email,
      pollToken: generatePollToken(user.id),
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    req.log.error({ err: error }, "Customer registration failed");
    res.status(500).json({ error: "Registration failed" });
  }
});

router.post("/auth/register/trader", async (req, res) => {
  try {
    const body = RegisterTraderBody.parse(req.body);

    // Phase 1: extra fields not yet in OpenAPI spec — validate ad-hoc.
    const extra = req.body as {
      confirmPassword?: string;
      termsAccepted?: boolean;
      privacyAccepted?: boolean;
    };

    if (!extra.confirmPassword || extra.confirmPassword !== body.password) {
      res.status(400).json({ error: "Passwords do not match" });
      return;
    }
    if (extra.termsAccepted !== true || extra.privacyAccepted !== true) {
      res.status(400).json({ error: "You must accept the Terms and Privacy Policy to continue." });
      return;
    }

    const existing = await db.select().from(usersTable).where(eq(usersTable.email, body.email)).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    const passwordHash = await bcryptjs.hash(body.password, 12);
    const verificationToken = generateVerificationToken();
    const now = new Date();

    const result = await db.transaction(async (tx) => {
      const [user] = await tx.insert(usersTable).values({
        email: body.email,
        passwordHash,
        fullName: body.contactName,
        phone: body.phone,
        role: "trader",
        isActive: false,
        emailVerified: false,
        emailVerificationToken: verificationToken,
        emailVerificationSentAt: now,
      }).returning();

      await tx.insert(traderProfilesTable).values({
        userId: user.id,
        businessName: body.businessName,
        contactName: body.contactName,
        email: body.email,
        phone: body.phone,
        mainCategory: body.mainCategory,
        town: body.town,
        postcode: body.postcode,
        isActive: false,
        verificationStatus: TRADER_STATUS.PENDING_EMAIL_VERIFICATION,
        termsAcceptedAt: now,
        privacyAcceptedAt: now,
      });

      return user;
    });

    logAudit({
      userId: result.id,
      action: "TRADER_ACCOUNT_CREATED",
      details: { email: result.email, businessName: body.businessName, mainCategory: body.mainCategory },
    });

    sendVerificationEmail(result.email, result.fullName, verificationToken).catch((err) =>
      req.log.error({ err }, "Failed to send verification email")
    );

    res.status(201).json({
      message: "Account created. Please check your email to verify your address before logging in.",
      email: result.email,
      pollToken: generatePollToken(result.id),
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    req.log.error({ err: error }, "Trader registration failed");
    res.status(500).json({ error: "Registration failed" });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const body = LoginBody.parse(req.body);

    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, body.email)).limit(1);
    if (!user) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const valid = await bcryptjs.compare(body.password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    if (!user.emailVerified) {
      res.status(403).json({
        error: "Please verify your email address before logging in.",
        code: "EMAIL_NOT_VERIFIED",
        email: user.email,
      });
      return;
    }

    const token = generateToken(user.id, user.role);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isActive: user.isActive,
        plan: user.plan,
        createdAt: user.createdAt.toISOString(),
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    req.log.error({ err: error }, "Login failed");
    res.status(500).json({ error: "Login failed" });
  }
});

router.get("/auth/verify-email", async (req, res) => {
  const { token } = req.query as { token?: string };

  if (!token) {
    res.status(400).send(verifyPage("Invalid Link", "No verification token provided.", false));
    return;
  }

  try {
    const [user] = await db.select().from(usersTable)
      .where(eq(usersTable.emailVerificationToken, token))
      .limit(1);

    if (!user) {
      res.status(404).send(verifyPage("Link Expired", "This verification link is invalid or has already been used.", false));
      return;
    }

    if (user.emailVerified) {
      res.send(verifyPage("Already Verified", "Your email is already verified. You can log in to the app.", true));
      return;
    }

    await db.update(usersTable)
      .set({
        emailVerified: true,
        emailVerificationToken: null,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id));

    // Trader status transition: PENDING_EMAIL_VERIFICATION -> PENDING_PHONE_VERIFICATION
    // Only transition if currently in the email-pending state (idempotent, never downgrade).
    if (user.role === "trader") {
      const [profile] = await db
        .select()
        .from(traderProfilesTable)
        .where(eq(traderProfilesTable.userId, user.id))
        .limit(1);
      if (profile && profile.verificationStatus === TRADER_STATUS.PENDING_EMAIL_VERIFICATION) {
        await db
          .update(traderProfilesTable)
          .set({
            verificationStatus: TRADER_STATUS.PENDING_PHONE_VERIFICATION,
            updatedAt: new Date(),
          })
          .where(eq(traderProfilesTable.userId, user.id));
      }
    }

    logAudit({ userId: user.id, action: "EMAIL_VERIFIED" });

    res.send(verifyPage("Email Verified!", "Your email has been verified. You can now log in to MyLocalTrade.", true));
  } catch (error) {
    req.log.error({ err: error }, "Email verification failed");
    res.status(500).send(verifyPage("Error", "Something went wrong. Please try again.", false));
  }
});

router.post("/auth/resend-verification", async (req, res) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (!user) {
      res.json({ message: "If an account exists, a verification email has been sent." });
      return;
    }

    if (user.emailVerified) {
      res.json({ message: "Your email is already verified. You can log in." });
      return;
    }

    // Rate limit: 60s cooldown between resends
    if (user.emailVerificationSentAt) {
      const elapsed = Date.now() - new Date(user.emailVerificationSentAt).getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        const retryIn = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        res.status(429).json({
          error: `Please wait ${retryIn}s before requesting another email.`,
          retryAfterSeconds: retryIn,
        });
        return;
      }
    }

    const newToken = generateVerificationToken();
    await db.update(usersTable)
      .set({ emailVerificationToken: newToken, emailVerificationSentAt: new Date(), updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    sendVerificationEmail(user.email, user.fullName, newToken).catch((err) =>
      req.log.error({ err }, "Failed to send verification email")
    );

    logAudit({ userId: user.id, action: "EMAIL_VERIFICATION_RESENT" });

    res.json({ message: "Verification email sent. Please check your inbox." });
  } catch (error) {
    req.log.error({ err: error }, "Resend verification failed");
    res.status(500).json({ error: "Failed to resend verification email" });
  }
});

router.get("/auth/verification-status", async (req, res) => {
  try {
    const { token } = req.query as { token?: string };
    if (!token) {
      res.status(400).json({ error: "Token is required" });
      return;
    }
    let userId: number;
    try {
      ({ userId } = verifyPollToken(token));
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      res.json({ verified: false });
      return;
    }
    res.json({ verified: !!user.emailVerified });
  } catch (error) {
    req.log.error({ err: error }, "Check verification status failed");
    res.status(500).json({ error: "Failed to check status" });
  }
});

router.get("/auth/me", authMiddleware, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive,
      plan: user.plan,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (error) {
    req.log.error({ err: error }, "Get user failed");
    res.status(500).json({ error: "Failed to get user" });
  }
});

router.get("/trader/onboarding-status", authMiddleware, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user || user.role !== "trader") {
      res.status(403).json({ error: "Only traders can view onboarding status." });
      return;
    }
    const [profile] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, userId))
      .limit(1);
    if (!profile) {
      res.status(404).json({ error: "Trader profile not found." });
      return;
    }

    const businessProfile = evaluateBusinessProfileComplete(profile);
    const docs = await db
      .select()
      .from(traderDocumentsTable)
      .where(eq(traderDocumentsTable.userId, userId));
    const documents = evaluateDocumentsComplete(docs);

    res.json({
      verificationStatus: profile.verificationStatus,
      message: statusMessage(profile),
      isPublic: isTraderProfilePublic(user, profile),
      emailVerified: user.emailVerified,
      phoneVerified: profile.phoneVerified,
      businessProfileCompleted: profile.businessProfileCompleted,
      documentsSubmitted: profile.documentsSubmitted,
      isActive: profile.isActive,
      rejectionReason: profile.rejectionReason,
      adminNotes: profile.adminNotes,
      checklist: buildOnboardingChecklist(user, profile),
      businessProfile,
      documents,
      email: user.email,
      businessName: profile.businessName,
    });
  } catch (error) {
    req.log.error({ err: error }, "Get onboarding status failed");
    res.status(500).json({ error: "Failed to get onboarding status" });
  }
});

function verifyPage(title: string, message: string, success: boolean): string {
  const icon = success ? "✅" : "❌";
  const color = success ? "#06D6A0" : "#EF4444";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — MyLocalTrade</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0B1120; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px;">
  <div style="max-width: 420px; width: 100%; background: #111827; border-radius: 16px; padding: 48px 40px; text-align: center; border: 1px solid #1F2937;">
    <div style="font-size: 48px; margin-bottom: 16px;">${icon}</div>
    <h1 style="color: #F9FAFB; font-size: 24px; font-weight: 700; margin: 0 0 12px;">${title}</h1>
    <p style="color: #9CA3AF; font-size: 16px; line-height: 1.6; margin: 0 0 32px;">${message}</p>
    ${success ? `<p style="color: ${color}; font-size: 15px; font-weight: 600; margin: 0;">Open the MyLocalTrade app and log in.</p>` : `<p style="color: #6B7280; font-size: 14px; margin: 0;">Please request a new verification email from the app.</p>`}
    <hr style="border: none; border-top: 1px solid #1F2937; margin: 32px 0 16px;">
    <p style="color: #374151; font-size: 12px; margin: 0;">MyLocalTrade · Service Provider LTD</p>
  </div>
</body>
</html>`;
}

export default router;
