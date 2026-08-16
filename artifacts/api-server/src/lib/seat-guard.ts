import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { userSeatSuspended, SEAT_SUSPENDED_RESPONSE } from "./job-assignment";
import type { AuthenticatedRequest } from "./types";

// --- Seat-suspension mutation guard (Company Teams billing) ---
//
// A seat-suspended EMPLOYEE keeps read access but must be refused on EVERY
// company-acting write. The job-scoped writes (messages, quotes, bookings…)
// are already gated inside canActOnJob/claimOrRequireAssigned; this express
// middleware closes the remaining trader-side mutations that don't pass
// through the job-claim path (conversation mute/report, review replies,
// profile edits, revalidation, business-email verification).
//
// Behaviour notes:
//   - No-op for customers and admins (fast path, no DB query) — safe on
//     mixed-audience routes like conversation mute/report.
//   - Owners are never seat-suspended (userSeatSuspended matches EMPLOYEE
//     memberships only), so owner flows are untouched.
//   - Deliberately independent of TEAM_BILLING_ENFORCED, mirroring
//     userSeatSuspended: a suspension row means a suspension regardless of
//     who wrote it. With no suspensions this is a no-op, keeping flag-off
//     behaviour identical.
export async function requireActiveSeat(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { userId, userRole } = req as AuthenticatedRequest;
    if (userRole !== "trader") {
      next();
      return;
    }
    if (await userSeatSuspended(db, userId)) {
      res.status(403).json(SEAT_SUSPENDED_RESPONSE);
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
