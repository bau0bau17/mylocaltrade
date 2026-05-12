import { Router, type IRouter } from "express";
import bcryptjs from "bcryptjs";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  traderAuditLogTable,
  pushTokensTable,
} from "@workspace/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  authMiddleware,
  authMiddlewareAllowDeletion,
  revokeUserSessions,
} from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { logAudit } from "../lib/trader-status";
import {
  sendAccountDeletionReceivedEmail,
  sendAccountDeletionCancelledEmail,
  sendAdminAccountDeletionAlertEmail,
} from "../lib/email";

const router: IRouter = Router();

// Rate limiting on the password-confirm step. We MUST NOT log the password
// itself anywhere — only the count of recent failed confirmations.
const PASSWORD_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_ATTEMPT_MAX = 5;

const DeletionRequestBody = z.object({
  password: z.string().min(1, "Password is required"),
  confirm: z.literal(true, { message: "You must tick the confirmation box." }),
  reason: z
    .string()
    .trim()
    .max(2000, "Reason is too long (max 2000 characters).")
    .optional()
    .nullable(),
});

const DeletionCancelBody = z.object({
  password: z.string().min(1, "Password is required"),
  confirm: z.literal(true, { message: "You must tick the confirmation box." }),
});

async function recentFailedAttempts(userId: number): Promise<number> {
  const windowStart = new Date(Date.now() - PASSWORD_ATTEMPT_WINDOW_MS);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(traderAuditLogTable)
    .where(
      and(
        eq(traderAuditLogTable.userId, userId),
        eq(traderAuditLogTable.action, "ACCOUNT_DELETION_RATE_LIMITED"),
        gte(traderAuditLogTable.createdAt, windowStart),
      ),
    );
  return count ?? 0;
}

/**
 * POST /api/account/deletion-request
 * Authenticated. Mandatory password + checkbox confirmation.
 *
 * Effect (atomic):
 *   - users.deletionStatus = 'REQUESTED'
 *   - users.deletionRequestedAt = now()
 *   - users.accountDisabledAt = now()
 *   - users.tokenVersion += 1  (revokes every active session immediately)
 *   - push tokens deleted
 *   - trader_profiles.isActive = false (hides from public listings)
 *   - audit: ACCOUNT_DELETION_REQUESTED, ACCOUNT_ACCESS_DISABLED,
 *            TRADER_PROFILE_HIDDEN_FOR_DELETION (if trader)
 *
 * Best-effort, non-blocking: confirmation email to the user, alert email to
 * admin support.
 */
router.post("/account/deletion-request", authMiddleware, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const body = DeletionRequestBody.parse(req.body);

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    // Admins must not delete their own account through this self-service flow.
    if (user.role === "admin") {
      res.status(403).json({
        error: "Admin accounts cannot be deleted from the app. Please contact another administrator.",
      });
      return;
    }
    if (user.deletionStatus) {
      res.status(409).json({
        error: "Your account is already in the deletion lifecycle.",
        code: "ALREADY_REQUESTED",
        deletionStatus: user.deletionStatus,
      });
      return;
    }

    // Rate limit on bad password before anything else.
    const failed = await recentFailedAttempts(userId);
    if (failed >= PASSWORD_ATTEMPT_MAX) {
      res.status(429).json({
        error:
          "Too many incorrect password attempts. Please wait 15 minutes before trying again.",
        code: "RATE_LIMITED",
      });
      return;
    }

    const passwordOk = await bcryptjs.compare(body.password, user.passwordHash);
    if (!passwordOk) {
      // Log the FAILURE itself — never the password value.
      await logAudit({
        userId,
        action: "ACCOUNT_DELETION_RATE_LIMITED",
        notes: "Password mismatch on deletion request",
      });
      res.status(401).json({
        error: "Incorrect password.",
        code: "INVALID_PASSWORD",
        attemptsRemaining: Math.max(0, PASSWORD_ATTEMPT_MAX - (failed + 1)),
      });
      return;
    }

    const now = new Date();
    const reason = body.reason?.trim() || null;

    await db.transaction(async (tx) => {
      await tx
        .update(usersTable)
        .set({
          deletionStatus: "REQUESTED",
          deletionRequestedAt: now,
          deletionReason: reason,
          accountDisabledAt: now,
          // Marketing opt-out is implied — no further nudges of any kind.
          marketingOptOutAt: now,
          // Revoke every active session.
          tokenVersion: sql`${usersTable.tokenVersion} + 1`,
          updatedAt: now,
        })
        .where(eq(usersTable.id, userId));
      await tx.delete(pushTokensTable).where(eq(pushTokensTable.userId, userId));
      if (user.role === "trader") {
        await tx
          .update(traderProfilesTable)
          .set({ isActive: false, updatedAt: now })
          .where(eq(traderProfilesTable.userId, userId));
      }
    });

    void logAudit({
      userId,
      action: "ACCOUNT_DELETION_REQUESTED",
      details: { role: user.role, reasonProvided: !!reason },
    });
    void logAudit({ userId, action: "ACCOUNT_ACCESS_DISABLED" });
    if (user.role === "trader") {
      void logAudit({ userId, action: "TRADER_PROFILE_HIDDEN_FOR_DELETION" });
    }

    sendAccountDeletionReceivedEmail({
      toEmail: user.email,
      toName: user.fullName,
      reason,
    }).catch((err) => req.log.error({ err }, "Deletion email to user failed"));
    sendAdminAccountDeletionAlertEmail({
      userEmail: user.email,
      userFullName: user.fullName,
      userRole: user.role,
      reason,
    }).catch((err) => req.log.error({ err }, "Deletion alert email to admin failed"));

    res.json({
      ok: true,
      deletionStatus: "REQUESTED",
      deletionRequestedAt: now.toISOString(),
      message:
        "Your account has been deactivated. Our admin team will finalise deletion shortly. You can cancel this from the same screen if you change your mind.",
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      const first = error.issues[0];
      res.status(400).json({
        error: first?.message ?? "Invalid request",
        code: "VALIDATION_ERROR",
      });
      return;
    }
    req.log.error({ err: error }, "Account deletion request failed");
    res.status(500).json({ error: "Failed to submit deletion request." });
  }
});

/**
 * GET /api/account/deletion-status
 * Authenticated. Always returns a flat status snapshot so the mobile app
 * can render the right UI on the delete-account screen and show a banner
 * elsewhere if the request is in flight.
 *
 * Note: the auth middleware blocks REQUESTED/DISABLED/ANONYMISED accounts
 * at the bearer-token check, so this route is normally only reachable in
 * the ACTIVE state. The shape below still describes the lifecycle so the
 * client can show the cancel-flow on a fresh sign-in token (issued after
 * a successful cancel).
 */
router.get("/account/deletion-status", authMiddlewareAllowDeletion, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const [user] = await db
      .select({
        deletionStatus: usersTable.deletionStatus,
        deletionRequestedAt: usersTable.deletionRequestedAt,
        deletionReason: usersTable.deletionReason,
        scheduledHardDeleteAt: usersTable.scheduledHardDeleteAt,
        retentionUntil: usersTable.retentionUntil,
        retentionReason: usersTable.retentionReason,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    res.json({
      deletionStatus: user.deletionStatus,
      deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
      deletionReason: user.deletionReason,
      scheduledHardDeleteAt: user.scheduledHardDeleteAt?.toISOString() ?? null,
      retentionUntil: user.retentionUntil?.toISOString() ?? null,
      retentionReason: user.retentionReason,
      canCancel:
        user.deletionStatus === "REQUESTED" ||
        user.deletionStatus === "DISABLED_PENDING_RETENTION",
    });
  } catch (error) {
    req.log.error({ err: error }, "Deletion status fetch failed");
    res.status(500).json({ error: "Failed to load deletion status." });
  }
});

/**
 * POST /api/account/deletion-cancel
 * Authenticated. Mandatory password + checkbox confirmation.
 *
 * Cancel rules:
 *  - Allowed only when deletionStatus is REQUESTED or DISABLED_PENDING_RETENTION.
 *  - Cancelling does NOT bypass other gates: trader profiles still need a
 *    valid verification status + active subscription before they re-appear in
 *    public listings (handled by the existing isTraderProfilePublic logic).
 *
 * Note: because the auth middleware locks deletion-flagged accounts out, the
 * caller cannot reach this route with a normal session. It is exposed for
 * admin-on-behalf-of flows and for direct programmatic use; the mobile app
 * routes its cancel through admin support today. Kept for parity with the
 * GDPR specification and so a future "magic-link to cancel" email can plug in.
 */
router.post("/account/deletion-cancel", authMiddlewareAllowDeletion, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const body = DeletionCancelBody.parse(req.body);
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    if (
      user.deletionStatus !== "REQUESTED" &&
      user.deletionStatus !== "DISABLED_PENDING_RETENTION"
    ) {
      res.status(409).json({
        error: "This account is not in a cancellable deletion state.",
        code: "NOT_CANCELLABLE",
      });
      return;
    }

    const failed = await recentFailedAttempts(userId);
    if (failed >= PASSWORD_ATTEMPT_MAX) {
      res.status(429).json({
        error:
          "Too many incorrect password attempts. Please wait 15 minutes before trying again.",
        code: "RATE_LIMITED",
      });
      return;
    }
    const passwordOk = await bcryptjs.compare(body.password, user.passwordHash);
    if (!passwordOk) {
      await logAudit({
        userId,
        action: "ACCOUNT_DELETION_RATE_LIMITED",
        notes: "Password mismatch on deletion cancel",
      });
      res.status(401).json({ error: "Incorrect password.", code: "INVALID_PASSWORD" });
      return;
    }

    const now = new Date();
    await db
      .update(usersTable)
      .set({
        deletionStatus: null,
        deletionRequestedAt: null,
        deletionReason: null,
        accountDisabledAt: null,
        retentionReason: null,
        retentionUntil: null,
        marketingOptOutAt: null,
        updatedAt: now,
      })
      .where(eq(usersTable.id, userId));

    void logAudit({ userId, action: "ACCOUNT_DELETION_CANCELLED" });

    sendAccountDeletionCancelledEmail({
      toEmail: user.email,
      toName: user.fullName,
    }).catch((err) => req.log.error({ err }, "Cancel email failed"));

    res.json({ ok: true, deletionStatus: null });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      const first = error.issues[0];
      res.status(400).json({
        error: first?.message ?? "Invalid request",
        code: "VALIDATION_ERROR",
      });
      return;
    }
    req.log.error({ err: error }, "Account deletion cancel failed");
    res.status(500).json({ error: "Failed to cancel deletion." });
  }
});

export default router;

// ---------------------------------------------------------------------------
// Admin-side helpers
// ---------------------------------------------------------------------------

export async function revokeUserSessionsAfterDeletion(
  userId: number,
): Promise<void> {
  await revokeUserSessions(userId);
}
