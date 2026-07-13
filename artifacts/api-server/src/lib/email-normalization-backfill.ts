import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * One-time (but idempotent) normalization of legacy email casing.
 *
 * New registrations already store the email lowercased and every lookup is
 * case-insensitive, but accounts created before that rule kept whatever
 * casing the user typed. That allowed the same address to exist twice with
 * different capitalisation, which in turn blocked re-registration after
 * account deletion.
 *
 * Runs at startup in three steps, all inside one transaction:
 *
 *  1. Release the email on terminally-deleted accounts (ANONYMISED /
 *     COMPLETED) that still hold a real address — these predate the rule
 *     that deletion completion frees the email. Rewritten to the stable
 *     `deleted-user-<id>@deleted.mylocaltrade.invalid` placeholder, mirrored
 *     onto trader_profiles.
 *
 *  2. Lowercase every remaining mixed-case login email, skipping (and
 *     logging) any row whose lowercased address would collide with another
 *     existing row — that can only happen if two live accounts share the
 *     address in different casings, which needs human resolution.
 *
 *  3. Lowercase mixed-case trader_profiles.email mirrors (no unique
 *     constraint there, so no collision handling needed).
 *
 * Idempotent: after one successful run every step matches zero rows.
 * Failures are logged and never crash the server.
 */
export async function normalizeLegacyEmails(): Promise<void> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await runNormalization();
      return;
    } catch (err) {
      const code =
        (err as { code?: string } | null)?.code ??
        (err as { cause?: { code?: string } } | null)?.cause?.code;
      const transient = code === "23505" || code === "40001";
      if (transient && attempt < MAX_ATTEMPTS) {
        logger.warn(
          { event: "email_normalization", attempt, code },
          "Legacy email normalization hit a transient conflict; retrying",
        );
        continue;
      }
      logger.error(
        { event: "email_normalization", err },
        "Legacy email normalization failed",
      );
      return;
    }
  }
}

async function runNormalization(): Promise<void> {
  await db.transaction(async (tx) => {
      const released = await tx.execute(sql`
        UPDATE users
        SET email = 'deleted-user-' || id || '@deleted.mylocaltrade.invalid',
            updated_at = now()
        WHERE deletion_status IN ('ANONYMISED', 'COMPLETED')
          AND email NOT LIKE '%.invalid'
        RETURNING id
      `);
      const releasedIds = released.rows.map((r) => r["id"]);

      if (releasedIds.length > 0) {
        await tx.execute(sql`
          UPDATE trader_profiles tp
          SET email = u.email, updated_at = now()
          FROM users u
          WHERE tp.user_id = u.id
            AND u.id IN ${sql`(${sql.join(
              releasedIds.map((id) => sql`${id}`),
              sql`, `,
            )})`}
            AND tp.email NOT LIKE '%.invalid'
        `);
      }

      const collisions = await tx.execute(sql`
        SELECT u.id
        FROM users u
        WHERE u.email <> lower(u.email)
          AND EXISTS (
            SELECT 1 FROM users o
            WHERE o.id <> u.id AND lower(o.email) = lower(u.email)
          )
      `);

      const lowercased = await tx.execute(sql`
        UPDATE users u
        SET email = lower(u.email), updated_at = now()
        WHERE u.email <> lower(u.email)
          AND NOT EXISTS (
            SELECT 1 FROM users o
            WHERE o.id <> u.id AND lower(o.email) = lower(u.email)
          )
        RETURNING u.id
      `);

      const mirrors = await tx.execute(sql`
        UPDATE trader_profiles
        SET email = lower(email), updated_at = now()
        WHERE email <> lower(email)
        RETURNING id
      `);

      if (
        releasedIds.length > 0 ||
        lowercased.rows.length > 0 ||
        mirrors.rows.length > 0
      ) {
        logger.info(
          {
            event: "email_normalization",
            releasedUserIds: releasedIds,
            lowercasedCount: lowercased.rows.length,
            traderMirrorCount: mirrors.rows.length,
          },
          "Legacy email normalization applied",
        );
      }

      if (collisions.rows.length > 0) {
        logger.warn(
          {
            event: "email_normalization",
            collidingUserIds: collisions.rows.map((r) => r["id"]),
          },
          "Email normalization skipped rows: two live accounts share the same address in different casings; resolve manually (delete or change one of them)",
        );
      }
  });
}
