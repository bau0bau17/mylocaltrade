import { pgTable, serial, integer, varchar, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { traderProfilesTable } from "./trader-profiles";

// --- Company seat exemptions (Team billing grandfathering) ---
//
// A server-controlled, auditable override of the plan-derived employee seat
// allowance for ONE company. Purpose: companies that already had active
// employees before TEAM_BILLING_ENFORCED is first enabled must not have
// people silently suspended by the enforcement flip. An admin grants an
// exemption sized to the company's existing headcount (never above the
// absolute 20-employee maximum), optionally time-bounded; the effective
// allowance is max(plan seats, active exemption), still capped at 20.
//
// Lifecycle: rows are never deleted. Revoking sets revokedAt/revokedByAdminId;
// an expired exemption (expiresAt <= now) simply stops counting. At most one
// unrevoked exemption per company (partial unique index) — granting a new one
// requires revoking the old one first, keeping the audit trail linear.

export const companySeatExemptionsTable = pgTable(
  "company_seat_exemptions",
  {
    id: serial("id").primaryKey(),
    traderProfileId: integer("trader_profile_id")
      .notNull()
      .references(() => traderProfilesTable.id),
    // Employee seats granted regardless of plan. 1..20 enforced in code and
    // clamped again by the operational ceiling at read time.
    seatLimit: integer("seat_limit").notNull(),
    // Human-readable justification, e.g. "grandfathered: 7 active employees
    // at enforcement launch 2026-09-01". Required — exemptions must be
    // explainable later.
    reason: text("reason").notNull(),
    // NULL = open-ended (explicitly removable instead of time-bounded).
    expiresAt: timestamp("expires_at"),
    createdByAdminId: integer("created_by_admin_id")
      .notNull()
      .references(() => usersTable.id),
    revokedAt: timestamp("revoked_at"),
    revokedByAdminId: integer("revoked_by_admin_id").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    oneLiveExemptionPerProfile: uniqueIndex("company_seat_exemptions_one_live_idx")
      .on(t.traderProfileId)
      .where(sql`revoked_at IS NULL`),
    profileIdx: index("company_seat_exemptions_profile_idx").on(t.traderProfileId),
  }),
);

export type CompanySeatExemption = typeof companySeatExemptionsTable.$inferSelect;
