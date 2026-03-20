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
import { generateToken, authMiddleware } from "../lib/auth";
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
    const [user] = await db.insert(usersTable).values({
      email: body.email,
      passwordHash,
      fullName: body.fullName,
      phone: body.phone || null,
      role: "customer",
      isActive: true,
    }).returning();

    const token = generateToken(user.id, user.role);

    res.status(201).json({
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

    const result = await db.transaction(async (tx) => {
      const [user] = await tx.insert(usersTable).values({
        email: body.email,
        passwordHash,
        fullName: body.contactName,
        phone: body.phone,
        role: "trader",
        isActive: false,
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

    const user = result;
    const token = generateToken(user.id, user.role);

    res.status(201).json({
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

export default router;
