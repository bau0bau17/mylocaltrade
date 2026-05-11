import {
  pgTable,
  serial,
  integer,
  varchar,
  boolean,
  timestamp,
  text,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Limited-supply marketing promo codes (e.g. "FIRST20" — first 20 traders
 * get £5/month off their subscription for the first month). The code defines
 * the offer; an individual trader's claim lives in `promoRedemptionsTable`.
 *
 * - `discountGbp`: flat amount off the monthly price, in GBP (whole pounds).
 * - `maxRedemptions`: hard cap on how many traders can claim this code in
 *   total. Once that many redemptions exist, validation rejects further
 *   attempts even if the code is still flagged active.
 * - `applicablePlans`: list of plan ids the code can be applied to. For the
 *   launch promo this is `["premium", "elite"]` (the £20 and £30 plans).
 * - `validForDays`: how long the discount stays active for an individual
 *   trader after they redeem. Drives the countdown shown in the trader app.
 */
export const promoCodesTable = pgTable("promo_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  description: text("description"),
  discountGbp: integer("discount_gbp").notNull(),
  maxRedemptions: integer("max_redemptions").notNull(),
  applicablePlans: text("applicable_plans").array().notNull(),
  validForDays: integer("valid_for_days").notNull().default(30),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PromoCode = typeof promoCodesTable.$inferSelect;
