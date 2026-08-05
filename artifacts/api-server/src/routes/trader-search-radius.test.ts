import { describe, it, beforeAll, afterAll, expect } from "vitest";
import request from "supertest";

import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  geocodeCacheTable,
} from "@workspace/db/schema";
import { inArray } from "drizzle-orm";
import app from "../app";
import { clearGeocodeMemoryCache, geocodeUkLocation, type FetchLike } from "../lib/geocode";

/**
 * Search-radius filter on GET /traders. Contract under test:
 *  - anchor precedence: valid lat/lng, else server-geocoded `near` (cached),
 *  - the radius is a pure FILTER — sort behaviour inside it is unchanged,
 *  - traders without trusted coords (geocodedPostcode must equal postcode)
 *    are excluded only while a radius applies, included otherwise,
 *  - unresolvable anchors / invalid params degrade gracefully to UK-wide.
 *
 * Geometry: the anchor is Milton Keynes centre-ish (52.0406, -0.7594). One
 * trader sits exactly on the anchor (distance 0 — exercises the acos clamp),
 * one ~8 miles north, one ~40 miles north (1° latitude ≈ 69 miles), so
 * radius 10 and radius 50 split them cleanly with a wide error margin.
 *
 * No test here performs live geocoding: `near` lookups hit pre-seeded
 * geocode_cache rows, and the unit tests inject fetch stubs.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `radius-test+${label}-${SUFFIX}@example.test`;
const TEST_CATEGORY = `radius-cat-${SUFFIX}`;

const ANCHOR = { lat: 52.0406, lng: -0.7594 };
// Both normalize to themselves (lowercase, no repeated whitespace) and match
// neither postcode nor outcode shape, so they route via the cache/place path.
const NEAR_TOWN = `radius-town-${SUFFIX}`;
const NEAR_UNRESOLVED = `nowhere-${SUFFIX}`;

const createdUserIds: number[] = [];
const createdProfileIds: number[] = [];
// Cache rows we seed or that lookups in this file may write ("zz…" postcodes
// can be negatively cached if the background sweep touches our rows).
const cacheQueries = [
  NEAR_TOWN,
  NEAR_UNRESOLVED,
  "zz9 9zz",
  "zz8 8zz",
  "zq1 9zz",
  "zq2 9zz",
  "zq3 9zz",
];

async function createTrader(
  label: string,
  profileOverrides: Partial<typeof traderProfilesTable.$inferInsert>,
): Promise<number> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(label),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `Radius ${label}`,
      role: "trader",
      isActive: true,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);

  const [p] = await db
    .insert(traderProfilesTable)
    .values({
      userId: u.id,
      businessName: `Radius Trades ${label} ${SUFFIX}`,
      contactName: `Trader ${label}`,
      email: emailFor(`profile-${label}`),
      phone: "+447000000000",
      mainCategory: TEST_CATEGORY,
      town: "Milton Keynes",
      postcode: "MK9 3XS",
      isActive: true,
      businessProfileCompleted: true,
      verificationStatus: "VERIFIED",
      revalidationOverdue: false,
      ...profileOverrides,
    })
    .returning({ id: traderProfilesTable.id });
  createdProfileIds.push(p.id);
  return p.id;
}

let onAnchorId: number;
let nearbyId: number;
let farId: number;
let noCoordsId: number;
let staleCoordsId: number;

const listIds = async (query: Record<string, string | number>) => {
  const res = await request(app)
    .get("/api/traders")
    .query({ category: TEST_CATEGORY, limit: 50, ...query });
  expect(res.status).toBe(200);
  return {
    ids: (res.body.traders as { id: number }[]).map((t) => t.id),
    total: res.body.total as number,
  };
};

beforeAll(async () => {
  onAnchorId = await createTrader("on-anchor", {
    latitude: ANCHOR.lat,
    longitude: ANCHOR.lng,
    geocodedPostcode: "MK9 3XS",
    rating: 4.5,
    reviewCount: 10,
  });
  nearbyId = await createTrader("nearby-8mi", {
    postcode: "MK13 7AB",
    latitude: 52.1566, // ~8 miles due north of the anchor
    longitude: ANCHOR.lng,
    geocodedPostcode: "MK13 7AB",
    rating: 4.9,
    reviewCount: 10,
  });
  farId = await createTrader("far-40mi", {
    postcode: "LE1 5AA",
    latitude: 52.62, // ~40 miles due north
    longitude: ANCHOR.lng,
    geocodedPostcode: "LE1 5AA",
    rating: 4.8,
    reviewCount: 10,
  });
  // Never geocoded: must be excluded under a radius, included without one.
  noCoordsId = await createTrader("no-coords", {
    postcode: "ZZ9 9ZZ",
    latitude: null,
    longitude: null,
    geocodedPostcode: null,
    rating: 4.7,
  });
  // Stale coords: postcode changed since geocoding (geocodedPostcode
  // mismatch) — coords sit ON the anchor but must NOT be trusted.
  staleCoordsId = await createTrader("stale-coords", {
    postcode: "ZZ8 8ZZ",
    latitude: ANCHOR.lat,
    longitude: ANCHOR.lng,
    geocodedPostcode: "ZZ8 8XX",
    rating: 4.6,
  });

  await db.insert(geocodeCacheTable).values([
    { query: NEAR_TOWN, latitude: ANCHOR.lat, longitude: ANCHOR.lng, resolved: true },
    { query: NEAR_UNRESOLVED, latitude: null, longitude: null, resolved: false },
  ]);
  // The route reads through an in-process memory cache first; make sure it
  // picks up the rows seeded above.
  clearGeocodeMemoryCache();
});

afterAll(async () => {
  if (createdProfileIds.length) {
    await db
      .delete(traderProfilesTable)
      .where(inArray(traderProfilesTable.id, createdProfileIds));
  }
  if (createdUserIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await db.delete(geocodeCacheTable).where(inArray(geocodeCacheTable.query, cacheQueries));
  clearGeocodeMemoryCache();
});

describe("GET /traders — search radius filter", () => {
  it("radius 10 with lat/lng keeps only traders within 10 miles", async () => {
    const { ids, total } = await listIds({ radiusMiles: 10, lat: ANCHOR.lat, lng: ANCHOR.lng });
    expect(ids).toContain(onAnchorId);
    expect(ids).toContain(nearbyId);
    expect(ids).not.toContain(farId);
    expect(ids).not.toContain(noCoordsId);
    expect(ids).not.toContain(staleCoordsId);
    expect(total).toBe(2);
  });

  it("radius 50 widens to include the ~40-mile trader", async () => {
    const { ids } = await listIds({ radiusMiles: 50, lat: ANCHOR.lat, lng: ANCHOR.lng });
    expect(ids).toContain(onAnchorId);
    expect(ids).toContain(nearbyId);
    expect(ids).toContain(farId);
    expect(ids).not.toContain(noCoordsId);
    expect(ids).not.toContain(staleCoordsId);
  });

  it("no radius (UK-wide) includes traders with missing/stale coords", async () => {
    const { ids, total } = await listIds({});
    expect(ids).toEqual(
      expect.arrayContaining([onAnchorId, nearbyId, farId, noCoordsId, staleCoordsId]),
    );
    expect(total).toBe(5);
  });

  it("`near` anchor resolves via the geocode cache (no live lookup)", async () => {
    clearGeocodeMemoryCache();
    // Mixed case + surrounding spaces exercise normalization.
    const { ids } = await listIds({
      radiusMiles: 10,
      near: `  ${NEAR_TOWN.toUpperCase()}  `,
    });
    expect(ids).toContain(onAnchorId);
    expect(ids).toContain(nearbyId);
    expect(ids).not.toContain(farId);
  });

  it("unresolvable `near` degrades gracefully to UK-wide, not empty", async () => {
    clearGeocodeMemoryCache();
    const { ids } = await listIds({ radiusMiles: 10, near: NEAR_UNRESOLVED });
    expect(ids).toEqual(
      expect.arrayContaining([onAnchorId, nearbyId, farId, noCoordsId, staleCoordsId]),
    );
  });

  it("radius without any anchor is ignored (UK-wide)", async () => {
    const { ids } = await listIds({ radiusMiles: 10 });
    expect(ids).toEqual(
      expect.arrayContaining([onAnchorId, nearbyId, farId, noCoordsId, staleCoordsId]),
    );
  });

  it.each(["abc", "-5", "0"])("invalid radiusMiles %s is ignored", async (bad) => {
    const { ids } = await listIds({ radiusMiles: bad, lat: ANCHOR.lat, lng: ANCHOR.lng });
    expect(ids).toEqual(
      expect.arrayContaining([onAnchorId, nearbyId, farId, noCoordsId, staleCoordsId]),
    );
  });

  it("sort order still applies within the radius (filter, not ranking)", async () => {
    const { ids } = await listIds({
      radiusMiles: 50,
      lat: ANCHOR.lat,
      lng: ANCHOR.lng,
      sort: "rating",
    });
    // Only the three in-radius traders remain, ordered by seeded rating:
    // nearby 4.9 > far 4.8 > on-anchor 4.5.
    expect(ids).toEqual([nearbyId, farId, onAnchorId]);
  });
});

describe("GET /traders — distanceMiles (display-only)", () => {
  type TraderRow = { id: number; distanceMiles: number | null };
  const listTraders = async (query: Record<string, string | number>) => {
    const res = await request(app)
      .get("/api/traders")
      .query({ category: TEST_CATEGORY, limit: 50, ...query });
    expect(res.status).toBe(200);
    return res.body.traders as TraderRow[];
  };
  const distanceOf = (traders: TraderRow[], id: number) =>
    traders.find((t) => t.id === id)?.distanceMiles;

  it("anchor WITHOUT a radius (UK-wide): real distances for trusted coords, null otherwise", async () => {
    const traders = await listTraders({ lat: ANCHOR.lat, lng: ANCHOR.lng });
    // No filter: everyone is still returned…
    expect(traders.map((t) => t.id)).toEqual(
      expect.arrayContaining([onAnchorId, nearbyId, farId, noCoordsId, staleCoordsId]),
    );
    // …with a real distance where coords are trusted…
    expect(distanceOf(traders, onAnchorId)).toBeCloseTo(0, 1);
    expect(distanceOf(traders, nearbyId)).toBeGreaterThan(6.5);
    expect(distanceOf(traders, nearbyId)).toBeLessThan(9.5);
    expect(distanceOf(traders, farId)).toBeGreaterThan(35);
    expect(distanceOf(traders, farId)).toBeLessThan(45);
    // …and null (never a wrong number) where they are not. The stale-coords
    // trader's coords sit exactly ON the anchor — a non-null value here would
    // mean untrusted coords leaked into the distance.
    expect(distanceOf(traders, noCoordsId)).toBeNull();
    expect(distanceOf(traders, staleCoordsId)).toBeNull();
  });

  it("distances stay consistent with an active radius filter", async () => {
    const traders = await listTraders({ radiusMiles: 10, lat: ANCHOR.lat, lng: ANCHOR.lng });
    expect(traders.length).toBeGreaterThan(0);
    for (const t of traders) {
      expect(t.distanceMiles).not.toBeNull();
      expect(t.distanceMiles as number).toBeLessThanOrEqual(10);
    }
  });

  it("`near` anchor produces distances too (via the geocode cache)", async () => {
    clearGeocodeMemoryCache();
    const traders = await listTraders({ near: NEAR_TOWN });
    expect(distanceOf(traders, onAnchorId)).toBeCloseTo(0, 1);
    expect(distanceOf(traders, nearbyId)).toBeGreaterThan(6.5);
  });

  it("no anchor at all: every distance is null", async () => {
    const traders = await listTraders({});
    expect(traders.length).toBeGreaterThan(0);
    for (const t of traders) expect(t.distanceMiles).toBeNull();
  });

  it("unresolvable `near`: null distances (hidden), never wrong ones", async () => {
    clearGeocodeMemoryCache();
    const traders = await listTraders({ near: NEAR_UNRESOLVED });
    expect(traders.length).toBeGreaterThan(0);
    for (const t of traders) expect(t.distanceMiles).toBeNull();
  });
});

describe("geocodeUkLocation — failure semantics", () => {
  const okJson = (body: unknown) =>
    ({ status: 200, ok: true, json: async () => body }) as Awaited<ReturnType<FetchLike>>;

  it("definitive not-found returns null AND writes a negative cache row", async () => {
    clearGeocodeMemoryCache();
    const notFound: FetchLike = async () => ({ status: 404, ok: false, json: async () => ({}) });
    expect(await geocodeUkLocation("ZQ1 9ZZ", notFound)).toBeNull();

    const [row] = await db
      .select()
      .from(geocodeCacheTable)
      .where(inArray(geocodeCacheTable.query, ["zq1 9zz"]));
    expect(row).toBeDefined();
    expect(row.resolved).toBe(false);
  });

  it("transient failure returns null WITHOUT caching (next call retries)", async () => {
    clearGeocodeMemoryCache();
    const boom: FetchLike = async () => {
      throw new Error("network down");
    };
    expect(await geocodeUkLocation("ZQ2 9ZZ", boom)).toBeNull();

    const rows = await db
      .select()
      .from(geocodeCacheTable)
      .where(inArray(geocodeCacheTable.query, ["zq2 9zz"]));
    expect(rows).toHaveLength(0);
  });

  it("success is cached: a later call succeeds even if fetch then fails", async () => {
    clearGeocodeMemoryCache();
    const found: FetchLike = async () =>
      okJson({ result: { latitude: 51.5, longitude: -0.1 } });
    expect(await geocodeUkLocation("ZQ3 9ZZ", found)).toEqual({
      latitude: 51.5,
      longitude: -0.1,
    });

    const boom: FetchLike = async () => {
      throw new Error("network down");
    };
    // Memory cache hit — the failing fetch stub must never be reached.
    expect(await geocodeUkLocation("zq3 9zz", boom)).toEqual({
      latitude: 51.5,
      longitude: -0.1,
    });

    // And the shared DB cache row is a positive entry.
    clearGeocodeMemoryCache();
    expect(await geocodeUkLocation("ZQ3 9ZZ", boom)).toEqual({
      latitude: 51.5,
      longitude: -0.1,
    });
  });
});
