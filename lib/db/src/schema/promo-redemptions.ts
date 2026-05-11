import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { promoCodesTable } from "./promo-codes";

/**
 * One row per trader/code claim. The `userId.unique()` constraint enforces
 * that a trader can only ever redeem one promo code (matches the marketing
 * intent — the launch promo is a one-shot offer per business).
 *
 * Prices are stored as the GBP amounts shown to the trader at the moment of
 * redemption, so admin reporting + the in-app countdown reflect what the
 * trader actually agreed to even if plan pricing changes later.
 */
export const promoRedemptionsTable = pgTable("promo_code_redemptions", {
  id: serial("id").primaryKey(),
  promoCodeId: integer("promo_code_id")
    .notNull()
    .references(() => promoCodesTable.id),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id)
    .unique(),
  planId: varchar("plan_id", { length: 20 }).notNull(),
  originalPriceGbp: integer("original_price_gbp").notNull(),
  discountGbp: integer("discount_gbp").notNull(),
  discountedPriceGbp: integer("discounted_price_gbp").notNull(),
  redeemedAt: timestamp("redeemed_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export type PromoRedemption = typeof promoRedemptionsTable.$inferSelect;
