import type { Store, Options, ClientRateLimitInfo } from "express-rate-limit";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * PostgreSQL-backed store for express-rate-limit.
 *
 * Replaces the default in-memory store so that rate-limit counters are shared
 * across all instances in an autoscaled deployment. Each limiter is given a
 * unique `prefix` so that keys from different limiters (same IP, different
 * routes) never collide in the table.
 *
 * Atomic upsert via ON CONFLICT ensures there are no race conditions under
 * concurrent requests from the same IP. Expired rows are cleaned up lazily
 * (the upsert resets hits+resetTime when the stored resetTime has passed)
 * and periodically by a background interval.
 */
export class PgRateLimitStore implements Store {
  private windowMs: number;
  private readonly keyPrefix: string;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Read by express-rate-limit's `singleCount` validation. Global (non
   * `localKeys`) stores are grouped by constructor name, so without a public
   * `prefix` every PgRateLimitStore looks like ONE store to the validator and
   * any request that passes through two pg-backed limiters (a per-route
   * limiter + the global /api limiter) logs a false-positive
   * ERR_ERL_DOUBLE_COUNT ValidationError. The real DB keys are namespaced with
   * this same prefix, so actual double increments within one limiter are still
   * caught.
   */
  readonly prefix: string;

  constructor(keyPrefix: string) {
    this.keyPrefix = keyPrefix;
    this.prefix = `${keyPrefix}:`;
    this.windowMs = 60 * 1000;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.cleanupTimer = setInterval(() => {
      void this.cleanup();
    }, CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const prefixedKey = `${this.keyPrefix}:${key}`;
    const resetTime = new Date(Date.now() + this.windowMs);

    const result = await db.execute(sql`
      INSERT INTO rate_limit_hits (key, hits, reset_time)
      VALUES (${prefixedKey}, 1, ${resetTime})
      ON CONFLICT (key) DO UPDATE
        SET hits = CASE
              WHEN rate_limit_hits.reset_time <= NOW() THEN 1
              ELSE rate_limit_hits.hits + 1
            END,
            reset_time = CASE
              WHEN rate_limit_hits.reset_time <= NOW() THEN ${resetTime}
              ELSE rate_limit_hits.reset_time
            END
      RETURNING hits, reset_time AS "resetTime"
    `);

    const row = result.rows[0] as { hits: number; resetTime: Date };
    return {
      totalHits: Number(row.hits),
      resetTime: new Date(row.resetTime),
    };
  }

  async decrement(key: string): Promise<void> {
    const prefixedKey = `${this.keyPrefix}:${key}`;
    await db.execute(sql`
      UPDATE rate_limit_hits
      SET hits = GREATEST(0, hits - 1)
      WHERE key = ${prefixedKey} AND reset_time > NOW()
    `);
  }

  async resetKey(key: string): Promise<void> {
    const prefixedKey = `${this.keyPrefix}:${key}`;
    await db.execute(sql`
      DELETE FROM rate_limit_hits WHERE key = ${prefixedKey}
    `);
  }

  private async cleanup(): Promise<void> {
    try {
      await db.execute(sql`
        DELETE FROM rate_limit_hits WHERE reset_time <= NOW()
      `);
    } catch (err) {
      logger.warn({ err }, "PgRateLimitStore: cleanup failed");
    }
  }
}

export function createPgStore(prefix: string): PgRateLimitStore {
  return new PgRateLimitStore(prefix);
}
