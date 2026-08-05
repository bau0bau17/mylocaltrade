import { db } from "@workspace/db";
import { geocodeCacheTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

/**
 * UK geocoding for search-radius anchors, backed by postcodes.io (free, no
 * API key, Open Government data — UK-only, which is exactly our market).
 *
 * Layered caching keeps the external service out of the hot path:
 *   1. in-process LRU-ish Map (per instance),
 *   2. geocode_cache table (shared, permanent — place coordinates don't move),
 *   3. postcodes.io lookup (postcode / outcode / place search).
 *
 * Failure semantics matter: a definitive not-found IS cached (negative row),
 * a transient network failure is NOT cached and simply yields null so the
 * caller degrades gracefully (search skips the radius filter).
 */

export type GeoPoint = { latitude: number; longitude: number };

// Minimal fetch shape so tests can inject a stub without pulling in DOM types.
export type FetchLike = (
  url: string,
  init?: {
    signal?: AbortSignal;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

const POSTCODES_IO_BASE = "https://api.postcodes.io";
const REQUEST_TIMEOUT_MS = 3500;
const MEMORY_CACHE_MAX = 500;

// Full postcode ("MK9 3XS") and outcode ("MK9") shapes route to the dedicated
// endpoints; everything else is treated as a place name (OS Open Names).
const FULL_POSTCODE_RE = /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/;
const OUTCODE_RE = /^[A-Za-z]{1,2}\d[A-Za-z\d]?$/;

export function normalizeGeoQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 120);
}

const memoryCache = new Map<string, GeoPoint | null>();

function remember(key: string, value: GeoPoint | null): GeoPoint | null {
  if (memoryCache.size >= MEMORY_CACHE_MAX) {
    const oldest = memoryCache.keys().next().value;
    if (oldest !== undefined) memoryCache.delete(oldest);
  }
  memoryCache.set(key, value);
  return value;
}

/** Test seam: lets tests re-seed geocode_cache rows and have them honoured. */
export function clearGeocodeMemoryCache(): void {
  memoryCache.clear();
}

type LookupOutcome =
  | { kind: "found"; point: GeoPoint }
  | { kind: "not_found" }
  | { kind: "error" };

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pointFrom(obj: unknown): GeoPoint | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  const latitude = num(rec["latitude"]);
  const longitude = num(rec["longitude"]);
  return latitude != null && longitude != null ? { latitude, longitude } : null;
}

async function fetchPoint(
  url: string,
  extract: (json: unknown) => GeoPoint | null,
  fetchImpl: FetchLike,
): Promise<LookupOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (res.status === 404) return { kind: "not_found" };
    if (!res.ok) return { kind: "error" };
    const json = await res.json();
    const point = extract(json);
    return point ? { kind: "found", point } : { kind: "not_found" };
  } catch {
    return { kind: "error" };
  } finally {
    clearTimeout(timer);
  }
}

function resultOf(json: unknown): unknown {
  return json && typeof json === "object" ? (json as Record<string, unknown>)["result"] : null;
}

/**
 * Resolve a UK place name / postcode / outcode to coordinates, or null when
 * it cannot be resolved (unknown place OR transient geocoder failure — the
 * caller must treat null as "no anchor", never as an error).
 */
export async function geocodeUkLocation(
  raw: string,
  fetchImpl: FetchLike = fetch,
): Promise<GeoPoint | null> {
  const query = normalizeGeoQuery(raw);
  if (!query) return null;

  if (memoryCache.has(query)) return memoryCache.get(query) ?? null;

  try {
    const [cached] = await db
      .select()
      .from(geocodeCacheTable)
      .where(eq(geocodeCacheTable.query, query))
      .limit(1);
    if (cached) {
      const point =
        cached.resolved && cached.latitude != null && cached.longitude != null
          ? { latitude: cached.latitude, longitude: cached.longitude }
          : null;
      return remember(query, point);
    }
  } catch (err) {
    logger.warn({ err, query }, "Geocode cache read failed");
  }

  let outcome: LookupOutcome;
  if (FULL_POSTCODE_RE.test(query)) {
    outcome = await fetchPoint(
      `${POSTCODES_IO_BASE}/postcodes/${encodeURIComponent(query)}`,
      (j) => pointFrom(resultOf(j)),
      fetchImpl,
    );
  } else if (OUTCODE_RE.test(query)) {
    outcome = await fetchPoint(
      `${POSTCODES_IO_BASE}/outcodes/${encodeURIComponent(query)}`,
      (j) => pointFrom(resultOf(j)),
      fetchImpl,
    );
  } else {
    outcome = await fetchPoint(
      `${POSTCODES_IO_BASE}/places?q=${encodeURIComponent(query)}&limit=1`,
      (j) => {
        const result = resultOf(j);
        return pointFrom(Array.isArray(result) ? result[0] : null);
      },
      fetchImpl,
    );
  }

  if (outcome.kind === "error") {
    // Transient: no caching, so the next search retries.
    logger.warn({ query }, "Geocode lookup failed (transient)");
    return null;
  }

  const point = outcome.kind === "found" ? outcome.point : null;
  try {
    await db
      .insert(geocodeCacheTable)
      .values({
        query,
        latitude: point?.latitude ?? null,
        longitude: point?.longitude ?? null,
        resolved: point != null,
      })
      .onConflictDoUpdate({
        target: geocodeCacheTable.query,
        set: {
          latitude: point?.latitude ?? null,
          longitude: point?.longitude ?? null,
          resolved: point != null,
        },
      });
  } catch (err) {
    logger.warn({ err, query }, "Geocode cache write failed");
  }
  return remember(query, point);
}
