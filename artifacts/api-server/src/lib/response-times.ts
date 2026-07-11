import { db } from "@workspace/db";
import { conversationsTable, messagesTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";

// Compute the median time (in minutes) between a customer's enquiry and the
// trader's first reply, over the last 90 days, for the given trader profile
// IDs. Returns a Map<traderProfileId, medianMinutes>. Traders with no
// qualifying samples are simply absent from the map (rendered as null on the
// wire).
export async function computeResponseTimes(
  traderProfileIds: number[],
): Promise<Map<number, number>> {
  if (traderProfileIds.length === 0) return new Map();
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // For each conversation tied to one of the given traders, find the customer's
  // initial message time (= conversation.createdAt is fine, but we use the
  // first customer message to be safe) and the trader's first reply, then the
  // delta in minutes. We only consider conversations where the trader actually
  // replied so non-responders don't artificially deflate the median.
  const rows = await db.execute<{
    trader_profile_id: number;
    minutes: number;
  }>(sql`
    SELECT
      c.trader_profile_id,
      EXTRACT(EPOCH FROM (trader_first.first_at - customer_first.first_at)) / 60.0 AS minutes
    FROM ${conversationsTable} c
    JOIN LATERAL (
      SELECT MIN(m.created_at) AS first_at
      FROM ${messagesTable} m
      WHERE m.conversation_id = c.id AND m.sender_role = 'customer'
    ) customer_first ON TRUE
    JOIN LATERAL (
      SELECT MIN(m.created_at) AS first_at
      FROM ${messagesTable} m
      WHERE m.conversation_id = c.id AND m.sender_role = 'trader'
    ) trader_first ON TRUE
    WHERE c.trader_profile_id IN (${sql.raw(traderProfileIds.map((id) => Number(id)).join(","))})
      AND c.created_at >= ${since}
      AND customer_first.first_at IS NOT NULL
      AND trader_first.first_at IS NOT NULL
      AND trader_first.first_at > customer_first.first_at
  `);

  const buckets = new Map<number, number[]>();
  for (const row of rows.rows ?? []) {
    const id = Number(row.trader_profile_id);
    const minutes = Number(row.minutes);
    if (!Number.isFinite(id) || !Number.isFinite(minutes) || minutes < 0) continue;
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id)!.push(minutes);
  }
  const result = new Map<number, number>();
  for (const [id, samples] of buckets) {
    if (samples.length < 2) continue; // need at least 2 samples to be meaningful
    samples.sort((a, b) => a - b);
    const mid = Math.floor(samples.length / 2);
    const median =
      samples.length % 2 === 0
        ? (samples[mid - 1] + samples[mid]) / 2
        : samples[mid];
    result.set(id, Math.round(median));
  }
  return result;
}
