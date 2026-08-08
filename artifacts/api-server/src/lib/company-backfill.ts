import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";
import { companyTeamsEnabled } from "./company-membership";

/**
 * Company Teams boot-time backfill (idempotent, additive, data-only).
 *
 * 1. Every trader profile gets exactly one ACTIVE OWNER membership row for
 *    its owning user. `ON CONFLICT DO NOTHING` on the (profile, user) unique
 *    index makes re-runs free; existing rows are never modified, so a later
 *    revocation is never resurrected.
 *
 * 2. While COMPANY_TEAMS_ENABLED is OFF, conversations mirror their assignee
 *    from traderUserId (the sole trader IS the assignee — matches reality
 *    for every pre-teams job). Deliberately NOT run when the flag is ON:
 *    once shared leads ship, an unclaimed conversation legitimately has a
 *    NULL assignee and must not be auto-assigned at boot.
 *
 * Runs after listen() (same pattern as the admin bootstrap): failures are
 * logged loudly but never crash or block startup, and the helper's owner
 * fallback keeps every business fully functional even if this never ran.
 */
export async function ensureCompanyTeamsBackfill(): Promise<void> {
  try {
    const membersResult = await db.execute(sql`
      INSERT INTO company_members (trader_profile_id, user_id, role, status)
      SELECT tp.id, tp.user_id, 'OWNER', 'ACTIVE'
      FROM trader_profiles tp
      ON CONFLICT (trader_profile_id, user_id) DO NOTHING
    `);

    let conversationsBackfilled = 0;
    if (!companyTeamsEnabled()) {
      const convResult = await db.execute(sql`
        UPDATE conversations
        SET assigned_trader_user_id = trader_user_id,
            assigned_at = created_at
        WHERE assigned_trader_user_id IS NULL
      `);
      conversationsBackfilled = convResult.rowCount ?? 0;
    }

    const ownersBackfilled = membersResult.rowCount ?? 0;
    if (ownersBackfilled > 0 || conversationsBackfilled > 0) {
      logger.info(
        {
          event: "company_teams_backfill",
          ownersBackfilled,
          conversationsBackfilled,
        },
        "Company teams backfill applied",
      );
    }
  } catch (err) {
    // Loud but non-fatal: the membership resolver's owner fallback keeps all
    // existing single-login businesses working even without the backfill.
    logger.error({ err }, "Company teams backfill failed");
  }
}
