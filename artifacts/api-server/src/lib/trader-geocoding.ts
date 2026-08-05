import { db } from "@workspace/db";
import { traderProfilesTable } from "@workspace/db/schema";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { geocodeUkLocation, type FetchLike, type GeoPoint } from "./geocode";

/**
 * Periodic sweep that resolves each trader's base `postcode` to coordinates
 * for search-radius filtering. Deliberately the ONLY writer of trader coords:
 * postcode edits happen on several routes (onboarding, profile edit, admin,
 * approved change requests), and hooking every write path would be exactly
 * the kind of duplicated-rule maintenance trap we avoid. Instead, coords are
 * trusted only while geocodedPostcode === postcode, so any postcode change
 * automatically re-queues the row for the next sweep (≤5 min latency, which
 * is far shorter than the time a new trader takes to become publicly listed).
 */

const POSTCODES_IO_BASE = "https://api.postcodes.io";
// Bounded per run: the 5-minute cadence drains any backlog quickly without
// hammering the free geocoder; a no-op run costs one indexed SELECT.
const SWEEP_LIMIT = 200;
const BULK_CHUNK = 100; // postcodes.io bulk-lookup maximum per request

export type TraderGeocodeSweepResult = {
  scanned: number;
  geocoded: number;
  unresolved: number;
  skipped?: boolean;
};

async function bulkPostcodeLookup(
  postcodes: string[],
  fetchImpl: FetchLike,
): Promise<Map<string, GeoPoint | null> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetchImpl(`${POSTCODES_IO_BASE}/postcodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postcodes }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: unknown };
    if (!Array.isArray(json?.result)) return null;
    const map = new Map<string, GeoPoint | null>();
    for (const entry of json.result as Array<{ query?: unknown; result?: unknown }>) {
      if (typeof entry?.query !== "string") continue;
      const r = entry.result as { latitude?: unknown; longitude?: unknown } | null;
      const latitude = typeof r?.latitude === "number" && Number.isFinite(r.latitude) ? r.latitude : null;
      const longitude = typeof r?.longitude === "number" && Number.isFinite(r.longitude) ? r.longitude : null;
      map.set(entry.query, latitude != null && longitude != null ? { latitude, longitude } : null);
    }
    return map;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function geocodeMissingTraderCoords(
  fetchImpl: FetchLike = fetch,
): Promise<TraderGeocodeSweepResult> {
  const rows = await db
    .select({ id: traderProfilesTable.id, postcode: traderProfilesTable.postcode })
    .from(traderProfilesTable)
    .where(
      and(
        isNotNull(traderProfilesTable.postcode),
        ne(traderProfilesTable.postcode, ""),
        sql`${traderProfilesTable.geocodedPostcode} IS DISTINCT FROM ${traderProfilesTable.postcode}`,
      ),
    )
    .limit(SWEEP_LIMIT);

  if (rows.length === 0) return { scanned: 0, geocoded: 0, unresolved: 0 };

  let geocoded = 0;
  let unresolved = 0;

  for (let i = 0; i < rows.length; i += BULK_CHUNK) {
    const chunk = rows.slice(i, i + BULK_CHUNK);
    const results = await bulkPostcodeLookup(
      chunk.map((r) => r.postcode.trim()),
      fetchImpl,
    );
    // Whole-call failure (network/5xx): leave the chunk untouched — the next
    // sweep retries. Rows are never marked unresolved on a transient failure.
    if (!results) continue;

    for (const row of chunk) {
      const key = row.postcode.trim();
      const hasDefinitiveAnswer = results.has(key);
      let point = results.get(key) ?? null;
      // Bulk not-found: retry via the single-lookup path, which also
      // understands outcode-only values like "MK9" (bulk is full-postcode
      // only) and shares the geocode_cache.
      if (!point) point = await geocodeUkLocation(key, fetchImpl);

      if (point) {
        await db
          .update(traderProfilesTable)
          .set({
            latitude: point.latitude,
            longitude: point.longitude,
            geocodedPostcode: row.postcode,
          })
          .where(eq(traderProfilesTable.id, row.id));
        geocoded += 1;
      } else if (hasDefinitiveAnswer) {
        // Definitive not-found: stamp geocodedPostcode with null coords so the
        // row is not retried every 5 minutes forever. A postcode edit re-queues.
        await db
          .update(traderProfilesTable)
          .set({ latitude: null, longitude: null, geocodedPostcode: row.postcode })
          .where(eq(traderProfilesTable.id, row.id));
        unresolved += 1;
      }
      // No definitive answer (echo mismatch): retry on the next sweep.
    }
  }

  return { scanned: rows.length, geocoded, unresolved };
}

let sweepRunning = false;

/** Overlap guard for the scheduler: a slow run must not stack a second one. */
export async function sweepTraderGeocoding(
  fetchImpl: FetchLike = fetch,
): Promise<TraderGeocodeSweepResult> {
  if (sweepRunning) return { scanned: 0, geocoded: 0, unresolved: 0, skipped: true };
  sweepRunning = true;
  try {
    return await geocodeMissingTraderCoords(fetchImpl);
  } finally {
    sweepRunning = false;
  }
}
