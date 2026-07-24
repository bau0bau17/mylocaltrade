import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Shared rate-limit counter store. Replaces the default express-rate-limit
 * in-memory store so that limits are enforced globally across all instances
 * in an autoscaled deployment.
 *
 * Each row holds the hit count for one (limiter-prefix + client-IP) key
 * within the current window. Rows are cleaned up lazily (when the window
 * resets) and periodically by a background interval in PgRateLimitStore.
 */
export const rateLimitHitsTable = pgTable(
  "rate_limit_hits",
  {
    key: text("key").primaryKey(),
    hits: integer("hits").notNull().default(0),
    resetTime: timestamp("reset_time").notNull(),
  },
  (table) => ({
    resetTimeIdx: index("rate_limit_hits_reset_time_idx").on(table.resetTime),
  }),
);

export type RateLimitHit = typeof rateLimitHitsTable.$inferSelect;
