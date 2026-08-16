import { Router, type IRouter } from "express";
import bcryptjs from "bcryptjs";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  traderAuditLogTable,
  pushTokensTable,
} from "@workspace/db/schema";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  authMiddleware,
  authMiddlewareAllowDeletion,
  generateToken,
  revokeUserSessions,
} from "../lib/auth";
import type { AuthenticatedRequest } from "../lib/types";
import { logAudit } from "../lib/trader-status";
import {
  sendAccountDeletionReceivedEmail,
  sendAccountDeletionCancelledEmail,
  sendAdminAccountDeletionAlertEmail,
} from "../lib/email";
import {
  findActiveEmployeeMembership,
  handoverActiveJobsToOwner,
  logJobsHandedToOwner,
  notifyJobsHandedToOwner,
} from "../lib/job-assignment";
import { sendPushToUser } from "../lib/push-notifications";

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

    // Bump tokenVersion (revokes every other device) and capture the new
    // value so we can mint a fresh token for THIS device — the user must
    // remain signed in here to be able to cancel the request from the same
    // screen without contacting support.
    const txResult = await db.transaction(async (tx) => {
      // Conditional transition guard (NULL → REQUESTED): a concurrent double
      // submit matches zero rows here and changes nothing, which also makes
      // the company-job handover below — and its customer-facing side
      // effects — at-most-once by construction.
      const [updated] = await tx
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
        .where(and(eq(usersTable.id, userId), isNull(usersTable.deletionStatus)))
        .returning({ tokenVersion: usersTable.tokenVersion });
      if (!updated) return null;
      await tx.delete(pushTokensTable).where(eq(pushTokensTable.userId, userId));
      if (user.role === "trader") {
        await tx
          .update(traderProfilesTable)
          .set({ isActive: false, updatedAt: now })
          .where(eq(traderProfilesTable.userId, userId));
      }
      // Company Teams: from this moment the account is locked out (token
      // version bumped, the auth middleware refuses deletion-flagged users),
      // so any LIVE job assigned to an employee must move to the owner NOW —
      // not days later when an admin finalises the deletion. The membership
      // row itself stays ACTIVE so a cancelled request restores the member
      // cleanly; the terminal admin routes revoke it. Deliberately
      // flag-independent, like the handover helper itself: sweeping zero
      // rows is harmless, stranding a live job on a dead account is not.
      // Completed/cancelled jobs keep their historical assignee.
      let handedOver: Awaited<ReturnType<typeof handoverActiveJobsToOwner>> = [];
      const membership =
        user.role === "trader" ? await findActiveEmployeeMembership(tx, userId) : null;
      if (membership) {
        handedOver = await handoverActiveJobsToOwner(tx, {
          traderProfileId: membership.traderProfileId,
          fromUserId: userId,
          ownerUserId: membership.ownerUserId,
        });
      }
      return { tokenVersion: updated.tokenVersion, membership, handedOver };
    });
    if (!txResult) {
      // Race loser: someone (this user on another device, most likely)
      // submitted first. Mirror the pre-check's 409 with the fresh status.
      const [current] = await db
        .select({ deletionStatus: usersTable.deletionStatus })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      res.status(409).json({
        error: "Your account is already in the deletion lifecycle.",
        code: "ALREADY_REQUESTED",
        deletionStatus: current?.deletionStatus ?? "REQUESTED",
      });
      return;
    }
    const refreshedToken = generateToken(user.id, user.role, txResult.tokenVersion);

    void logAudit({
      userId,
      action: "ACCOUNT_DELETION_REQUESTED",
      details: { role: user.role, reasonProvided: !!reason },
    });
    void logAudit({ userId, action: "ACCOUNT_ACCESS_DISABLED" });
    if (user.role === "trader") {
      void logAudit({ userId, action: "TRADER_PROFILE_HIDDEN_FOR_DELETION" });
    }
    // Post-commit, winner-only: the conditional transition above ran at most
    // once, so these side effects can never duplicate.
    if (txResult.membership && txResult.handedOver.length > 0) {
      const { membership, handedOver } = txResult;
      void logJobsHandedToOwner({
        traderProfileId: membership.traderProfileId,
        conversations: handedOver,
        removedUserId: userId,
        ownerUserId: membership.ownerUserId,
        actorUserId: userId,
        reason: "account-deletion",
      }).catch((err) => req.log.warn({ err }, "Deletion handover audit failed"));
      void (async () => {
        await notifyJobsHandedToOwner({
          conversations: handedOver,
          ownerUserId: membership.ownerUserId,
          businessName: membership.businessName,
          onError: (err, conversationId) =>
            req.log.warn({ err, conversationId }, "Deletion handover notification failed"),
        });
        // Unlike member removal (owner-initiated, no self-notification), the
        // owner did NOT trigger this handover — tell them their workload
        // changed. ONE summary push, not one per job.
        const count = handedOver.length;
        await sendPushToUser(membership.ownerUserId, {
          title: "Jobs handed to you",
          body: `${count === 1 ? "1 live job is" : `${count} live jobs are`} now assigned to you after a team member's account was deactivated.`,
          data: {
            type: "job_reassigned",
            ...(count === 1 ? { conversationId: handedOver[0].id } : {}),
          },
        });
      })().catch((err) => req.log.warn({ err }, "Deletion handover notifications failed"));
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
      // Fresh token bound to the bumped tokenVersion. The mobile client must
      // swap its stored token to this value so the user stays signed in
      // *here* (other devices were revoked) and can reach the cancel route.
      token: refreshedToken,
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
 * Reachable in BOTH the active state and the pending-deletion states:
 * the standard auth middleware answers pending accounts with a 403
 * ACCOUNT_DELETION_PENDING (not a session-killing 401), and this route
 * uses authMiddlewareAllowDeletion so the same token can read the
 * lifecycle snapshot and drive the cancel flow.
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
 * The requesting device keeps a valid session token after submitting a
 * deletion request (the standard middleware answers it with 403
 * ACCOUNT_DELETION_PENDING rather than revoking it), so the mobile app can
 * call this endpoint directly from the delete-account screen. Password +
 * checkbox confirmation are still mandatory.
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
    // Conditional transition guard: the pre-read above races against an
    // admin finalising (anonymise/complete) this very request. Cancelling
    // must NEVER resurrect a terminal account — the UPDATE only wins while
    // the status is still one of the two cancellable states, and every side
    // effect below (profile restore, audit, email) is winner-only.
    const won = await db.transaction(async (tx) => {
      const [updated] = await tx
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
        .where(
          and(
            eq(usersTable.id, userId),
            inArray(usersTable.deletionStatus, ["REQUESTED", "DISABLED_PENDING_RETENTION"]),
          ),
        )
        .returning({ id: usersTable.id });
      if (!updated) return false;
      // Mirror of the request path, which hides the trader profile
      // (isActive=false). Cancelling must restore it or the trader stays
      // invisible in public listings forever. Safe blanket restore: only the
      // deletion request and the terminal admin anonymise write
      // isActive=false, and neither state can coexist with a cancellable
      // request. Public visibility still requires the verification status
      // checks (isTraderProfilePublic) on top of this flag.
      if (user.role === "trader") {
        await tx
          .update(traderProfilesTable)
          .set({ isActive: true, updatedAt: now })
          .where(eq(traderProfilesTable.userId, userId));
      }
      return true;
    });
    if (!won) {
      res.status(409).json({
        error: "This account is not in a cancellable deletion state.",
        code: "NOT_CANCELLABLE",
      });
      return;
    }

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
