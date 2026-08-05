import { pgTable, serial, varchar, boolean, timestamp, doublePrecision } from "drizzle-orm/pg-core";

// Server-side geocoding cache for search anchors (the customer's "near"
// string: a place name, postcode or outcode). One row per normalized query so
// repeat searches never re-hit the external geocoder. `resolved=false` with a
// row present is a cached definitive not-found; transient network failures
// are never cached (the next search retries).
export const geocodeCacheTable = pgTable("geocode_cache", {
  id: serial("id").primaryKey(),
  query: varchar("query", { length: 120 }).notNull().unique(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type GeocodeCacheRow = typeof geocodeCacheTable.$inferSelect;
