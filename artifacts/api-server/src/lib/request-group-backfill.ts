import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Assign a request_group_id to every enquiry that predates structured quotes,
 * so the Compare Offers screen can group historical enquiries by original
 * request. Enquiries from the same customer for the same (normalised)
 * service description share one group id — the same heuristic used at
 * creation time for pre-feature rows. Idempotent: only fills NULL rows, so it
 * settles to a no-op after the first successful run.
 */
export async function backfillRequestGroups(): Promise<void> {
  try {
    await db.execute(sql`
      WITH groups AS (
        SELECT customer_id,
               lower(btrim(service_required)) AS service_key,
               gen_random_uuid()::text AS gid
        FROM enquiries
        WHERE request_group_id IS NULL
        GROUP BY customer_id, lower(btrim(service_required))
      )
      UPDATE enquiries e
      SET request_group_id = g.gid
      FROM groups g
      WHERE e.request_group_id IS NULL
        AND e.customer_id = g.customer_id
        AND lower(btrim(e.service_required)) = g.service_key
    `);
  } catch (err) {
    logger.error({ err }, "Request group backfill failed");
  }
}
