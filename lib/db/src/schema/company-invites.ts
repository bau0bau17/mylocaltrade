import { pgTable, serial, integer, varchar, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { traderProfilesTable } from "./trader-profiles";

// --- Company Teams: email invitations (schema foundation; flows ship in a
// later phase — no invite routes exist while COMPANY_TEAMS_ENABLED is off).
//
// v1 restricts invites to email addresses with NO existing account; accepting
// creates a fresh user with an EMPLOYEE membership. The raw invite token is
// NEVER stored — only its hash (same rule as password-reset / OTP tokens).

export const COMPANY_INVITE_STATUSES = ["PENDING", "ACCEPTED", "CANCELLED", "EXPIRED"] as const;
export type CompanyInviteStatus = (typeof COMPANY_INVITE_STATUSES)[number];

export const companyInvitesTable = pgTable(
  "company_invites",
  {
    id: serial("id").primaryKey(),
    traderProfileId: integer("trader_profile_id")
      .notNull()
      .references(() => traderProfilesTable.id),
    // Stored CANONICAL LOWERCASE (normalised at insert) so the partial unique
    // index below needs no expression — matches the app-wide rule that email
    // comparison is always case-insensitive.
    email: varchar("email", { length: 255 }).notNull(),
    role: varchar("role", { length: 20 }).notNull().default("EMPLOYEE"),
    status: varchar("status", { length: 20 }).notNull().default("PENDING"),
    // SHA-256 hash of the invite token; the raw token exists only in the
    // invitation email. Resending rotates tokenHash + expiresAt on this row.
    tokenHash: text("token_hash").notNull(),
    invitedByUserId: integer("invited_by_user_id")
      .notNull()
      .references(() => usersTable.id),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedByUserId: integer("accepted_by_user_id").references(() => usersTable.id),
    acceptedAt: timestamp("accepted_at"),
    cancelledAt: timestamp("cancelled_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // At most one PENDING invite per (company, email) — resend updates it.
    onePendingPerEmail: uniqueIndex("company_invites_one_pending_per_email_idx")
      .on(t.traderProfileId, t.email)
      .where(sql`status = 'PENDING'`),
    tokenHashUnique: uniqueIndex("company_invites_token_hash_unique_idx").on(t.tokenHash),
    profileIdx: index("company_invites_profile_idx").on(t.traderProfileId),
  }),
);

export const insertCompanyInviteSchema = createInsertSchema(companyInvitesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCompanyInvite = z.infer<typeof insertCompanyInviteSchema>;
export type CompanyInvite = typeof companyInvitesTable.$inferSelect;
