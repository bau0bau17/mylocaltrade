import jwt from "jsonwebtoken";
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
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

export function generateToken(userId: number, role: string): string {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): { userId: number; role: string } {
  return jwt.verify(token, JWT_SECRET) as { userId: number; role: string };
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

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    (req as AuthenticatedRequest).userId = decoded.userId;
    (req as AuthenticatedRequest).userRole = decoded.role as "customer" | "trader" | "admin";
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
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

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.substring(7);
      const decoded = verifyToken(token);
      (req as AuthenticatedRequest).userId = decoded.userId;
      (req as AuthenticatedRequest).userRole = decoded.role as "customer" | "trader" | "admin";
    } catch {
      // ignore
    }
  }
  next();
}
