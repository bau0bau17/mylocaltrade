import type { Request } from "express";

export type UserRole = "customer" | "trader" | "admin";

export interface AuthenticatedRequest extends Request {
  userId: number;
  userRole: UserRole;
}
