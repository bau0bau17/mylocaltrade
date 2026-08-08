import { pgTable, serial, integer, varchar, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { traderProfilesTable } from "./trader-profiles";

// --- Company Teams (multi-member trader businesses) ---
//
// A membership row grants a user access to a trader profile (the "company").
// trader_profiles.user_id remains the OWNER pointer — the single user who
// created the business, holds the subscription and passes verification. The
// backfill creates one ACTIVE OWNER membership per existing profile, so for
// every pre-teams business the two representations agree.
//
// Access roles are deliberately separate from trader_profiles.businessRole,
// which is self-declared VERIFICATION metadata (who is completing the
// checks), not access control.

// MANAGER is reserved for a later phase — v1 grants only OWNER/EMPLOYEE.
export const COMPANY_MEMBER_ROLES = ["OWNER", "EMPLOYEE"] as const;
export type CompanyMemberRole = (typeof COMPANY_MEMBER_ROLES)[number];

export const COMPANY_MEMBER_STATUSES = ["ACTIVE", "REVOKED"] as const;
export type CompanyMemberStatus = (typeof COMPANY_MEMBER_STATUSES)[number];

export const companyMembersTable = pgTable(
  "company_members",
  {
    id: serial("id").primaryKey(),
    traderProfileId: integer("trader_profile_id")
      .notNull()
      .references(() => traderProfilesTable.id),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    role: varchar("role", { length: 20 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
    invitedByUserId: integer("invited_by_user_id").references(() => usersTable.id),
    revokedAt: timestamp("revoked_at"),
    revokedByUserId: integer("revoked_by_user_id").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // One membership row per (company, user) — re-joining after revocation
    // reactivates the existing row rather than inserting a duplicate.
    profileUserUnique: uniqueIndex("company_members_profile_user_unique_idx").on(
      t.traderProfileId,
      t.userId,
    ),
    // v1 rule: a user belongs to AT MOST ONE company at a time.
    oneActiveCompanyPerUser: uniqueIndex("company_members_one_active_per_user_idx")
      .on(t.userId)
      .where(sql`status = 'ACTIVE'`),
    // Exactly one active OWNER per company.
    oneActiveOwnerPerProfile: uniqueIndex("company_members_one_active_owner_idx")
      .on(t.traderProfileId)
      .where(sql`status = 'ACTIVE' AND role = 'OWNER'`),
    profileIdx: index("company_members_profile_idx").on(t.traderProfileId),
  }),
);

export const insertCompanyMemberSchema = createInsertSchema(companyMembersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCompanyMember = z.infer<typeof insertCompanyMemberSchema>;
export type CompanyMember = typeof companyMembersTable.$inferSelect;
