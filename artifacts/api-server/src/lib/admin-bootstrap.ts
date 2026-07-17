import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { logger } from "./logger";
import { findUserByEmail } from "./auth";

/**
 * One-time, secret-driven admin bootstrap.
 *
 * Promotes exactly the user whose email matches the ADMIN_BOOTSTRAP_EMAIL
 * secret to the "admin" role. This lets a production admin account be created
 * without writing directly to the production database and without exposing any
 * admin-creation HTTP route.
 *
 * Launch-safety guarantees (per the approved constraints):
 *  - No-op unless ADMIN_BOOTSTRAP_EMAIL is set. Removing the secret fully
 *    disables it; the function can then be deleted at leisure.
 *  - Only ever targets the single configured email. It never creates accounts,
 *    never demotes anyone, and never touches any other user or test account.
 *  - Only promotes an existing account that is email-verified, active and not
 *    in any deletion state.
 *  - Idempotent: once the target is already an admin it does nothing.
 *  - Every outcome (promotion or skip reason) is logged for auditability.
 *  - Failures are swallowed and logged so they can never crash the server.
 */
export async function bootstrapAdminFromEnv(): Promise<void> {
  const email = process.env["ADMIN_BOOTSTRAP_EMAIL"]?.trim().toLowerCase();
  if (!email) return; // Disabled: secret not set.

  try {
    // Deterministic resolver: legacy data contains case-variant duplicate
    // emails; a bare lower(email) lookup could super-admin the wrong row.
    // Prefer an existing admin-portal row (admin accounts are a separate
    // identity space from app accounts); fall back to an app row only for
    // first-ever bootstrap, where the owner's app account is promoted.
    const user =
      (await findUserByEmail(email, "admin")) ??
      (await findUserByEmail(email, "app"));

    if (!user) {
      logger.warn(
        { event: "admin_bootstrap", outcome: "user_not_found" },
        "ADMIN_BOOTSTRAP_EMAIL is set but no matching user exists yet; sign up and verify that email in production first",
      );
      return;
    }

    if (user.role === "admin") {
      // The bootstrap account is the platform owner: make sure it is always
      // a super admin (covers accounts promoted before the tier existed).
      if (!user.isSuperAdmin) {
        await db
          .update(usersTable)
          .set({ isSuperAdmin: true, updatedAt: new Date() })
          .where(eq(usersTable.id, user.id));
        logger.info(
          { event: "admin_bootstrap", userId: user.id, outcome: "upgraded_to_super_admin" },
          "Admin bootstrap: existing admin upgraded to super admin",
        );
        return;
      }
      logger.info(
        { event: "admin_bootstrap", userId: user.id, outcome: "already_admin" },
        "Admin bootstrap no-op: target user is already a super admin",
      );
      return;
    }

    if (
      !user.emailVerified ||
      !user.isActive ||
      user.deletionStatus !== null ||
      user.deletedAt !== null
    ) {
      logger.warn(
        {
          event: "admin_bootstrap",
          userId: user.id,
          emailVerified: user.emailVerified,
          isActive: user.isActive,
          deletionStatus: user.deletionStatus,
          outcome: "ineligible",
        },
        "Admin bootstrap skipped: target account must be email-verified, active and not deleted",
      );
      return;
    }

    // Promotion only. The account is already active (guarded above), so we do
    // not touch isActive or any other field — this never re-enables an account
    // that was deliberately deactivated.
    await db
      .update(usersTable)
      .set({ role: "admin", isSuperAdmin: true, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    logger.info(
      {
        event: "admin_bootstrap",
        userId: user.id,
        previousRole: user.role,
        outcome: "promoted",
      },
      "Admin bootstrap: target user promoted to admin role",
    );
  } catch (err) {
    logger.error({ event: "admin_bootstrap", err }, "Admin bootstrap failed");
  }
}
