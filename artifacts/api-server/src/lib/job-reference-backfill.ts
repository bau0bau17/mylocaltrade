import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Persist a readable job reference (MLT-000123) for every already-hired job that
 * predates the feature. Deterministic from the conversation id, so it matches
 * the on-the-fly fallback used at serialization time. Idempotent: it only fills
 * rows where a reference is still missing, so it settles to a no-op after the
 * first successful run.
 */
export async function backfillJobReferences(): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE conversations
      SET job_reference = 'MLT-' || lpad(id::text, 6, '0')
      WHERE customer_accepted_at IS NOT NULL AND job_reference IS NULL
    `);
  } catch (err) {
    logger.error({ err }, "Job reference backfill failed");
  }
}
