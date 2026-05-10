import jwt from "jsonwebtoken";
import crypto from "crypto";
import { eq, sql } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import type { AuthenticatedRequest } from "./types";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET environment variable is required in production");
  }
  return "dev-only-" + crypto.randomBytes(16).toString("hex");
}

const JWT_SECRET = getJwtSecret();

export function generateToken(userId: number, role: string, tokenVersion = 1): string {
  return jwt.sign({ userId, role, tokenVersion }, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): { userId: number; role: string; tokenVersion: number } {
  const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; role: string; tokenVersion?: number };
  return {
    userId: decoded.userId,
    role: decoded.role,
    tokenVersion: decoded.tokenVersion ?? 1,
  };
}

export function generatePollToken(userId: number): string {
  return jwt.sign({ userId, purpose: "verify-poll" }, JWT_SECRET, { expiresIn: "24h" });
}

export function verifyPollToken(token: string): { userId: number } {
  const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; purpose?: string };
  if (decoded.purpose !== "verify-poll") {
    throw new Error("Invalid token purpose");
  }
  return { userId: decoded.userId };
}

/** Token kinds used for one-click email unsubscribe links. Each kind is
 *  scoped: a token issued for one kind cannot be replayed against another. */
export type UnsubscribeKind = "lead_reminder";

/** Issue a long-lived signed token that lets the recipient of a transactional
 *  email turn off a specific notification kind without logging in. */
export function generateUnsubscribeToken(traderProfileId: number, kind: UnsubscribeKind): string {
  return jwt.sign(
    { traderProfileId, kind, purpose: "email-unsubscribe" },
    JWT_SECRET,
    { expiresIn: "365d" },
  );
}

export function verifyUnsubscribeToken(token: string): {
  traderProfileId: number;
  kind: UnsubscribeKind;
} {
  const decoded = jwt.verify(token, JWT_SECRET) as {
    traderProfileId?: number;
    kind?: string;
    purpose?: string;
  };
  if (decoded.purpose !== "email-unsubscribe") {
    throw new Error("Invalid token purpose");
  }
  if (typeof decoded.traderProfileId !== "number") {
    throw new Error("Invalid token payload");
  }
  if (decoded.kind !== "lead_reminder") {
    throw new Error("Unknown unsubscribe kind");
  }
  return { traderProfileId: decoded.traderProfileId, kind: decoded.kind };
}

/**
 * Load the user backing a bearer token and verify the token is still valid
 * against the current database state. Returns null if the account should no
 * longer be trusted.
 *
 * Rejection rules:
 *  - Account not found (hard-deleted or never existed).
 *  - `deletedAt` is set (soft-deleted account).
 *  - Admin account with `isActive = false` (deactivated staff).
 *  - `tokenVersion` in the JWT does not match the DB value — this is the
 *    revocation mechanism: incrementing the column immediately invalidates
 *    all previously issued tokens for that user.
 *
 * Note: `isActive = false` for non-admin roles (trader, customer) reflects
 * subscription / onboarding state and is intentionally allowed, mirroring
 * the login route behaviour.
 */
async function loadActiveUser(
  userId: number,
  tokenVersion: number,
): Promise<{
  id: number;
  role: "customer" | "trader" | "admin";
} | null> {
  const [user] = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      isActive: usersTable.isActive,
      tokenVersion: usersTable.tokenVersion,
      deletedAt: usersTable.deletedAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) return null;
  if (user.deletedAt) return null;
  if (user.role === "admin" && !user.isActive) return null;
  if (user.tokenVersion !== tokenVersion) return null;

  return { id: user.id, role: user.role as "customer" | "trader" | "admin" };
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  let decoded: { userId: number; role: string; tokenVersion: number };
  try {
    const token = authHeader.substring(7);
    decoded = verifyToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  try {
    const user = await loadActiveUser(decoded.userId, decoded.tokenVersion);
    if (!user) {
      res.status(401).json({ error: "Account is no longer active" });
      return;
    }
    (req as AuthenticatedRequest).userId = user.id;
    (req as AuthenticatedRequest).userRole = user.role;
    next();
  } catch (err) {
    req.log?.error({ err }, "authMiddleware account lookup failed");
    res.status(500).json({ error: "Authentication check failed" });
  }
}

export function adminOnly(req: Request, res: Response, next: NextFunction): void {
  if ((req as AuthenticatedRequest).userRole !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

export function traderOnly(req: Request, res: Response, next: NextFunction): void {
  if ((req as AuthenticatedRequest).userRole !== "trader") {
    res.status(403).json({ error: "This action is only available for trader accounts" });
    return;
  }
  next();
}

export function customerOnly(req: Request, res: Response, next: NextFunction): void {
  if ((req as AuthenticatedRequest).userRole !== "customer") {
    res.status(403).json({ error: "This action is only available for customer accounts" });
    return;
  }
  next();
}

/**
 * Immediately revoke all currently issued tokens for a user by incrementing
 * their `tokenVersion`. Any token carrying the old version will be rejected
 * on the next authenticated request, even if the JWT itself has not expired.
 *
 * Pass a Drizzle transaction `tx` when calling inside an existing transaction
 * so the version bump is atomic with the surrounding state change.
 */
export async function revokeUserSessions(
  userId: number,
  tx?: typeof db,
): Promise<void> {
  const executor = tx ?? db;
  await executor
    .update(usersTable)
    .set({ tokenVersion: sql`${usersTable.tokenVersion} + 1` })
    .where(eq(usersTable.id, userId));
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.substring(7);
      const decoded = verifyToken(token);
      const user = await loadActiveUser(decoded.userId, decoded.tokenVersion);
      if (user) {
        (req as AuthenticatedRequest).userId = user.id;
        (req as AuthenticatedRequest).userRole = user.role;
      }
    } catch {
      // ignore — treat as anonymous
    }
  }
  next();
}
