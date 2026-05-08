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

    const existing = await db.select().from(usersTable).where(eq(usersTable.email, body.email)).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    const passwordHash = await bcryptjs.hash(body.password, 12);
    const verificationToken = generateVerificationToken();

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
      });

      return user;
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

    const newToken = generateVerificationToken();
    await db.update(usersTable)
      .set({ emailVerificationToken: newToken, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    sendVerificationEmail(user.email, user.fullName, newToken).catch((err) =>
      req.log.error({ err }, "Failed to send verification email")
    );

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
