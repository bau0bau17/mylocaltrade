import { pgTable, serial, integer, text, boolean, timestamp, varchar, json, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const TRADER_VERIFICATION_STATUSES = [
  "PENDING_EMAIL_VERIFICATION",
  "PENDING_PHONE_VERIFICATION",
  "PROFILE_INCOMPLETE",
  "PENDING_DOCUMENTS",
  "UNDER_REVIEW",
  "VERIFIED",
  "REJECTED",
  "SUSPENDED",
  "EXPIRED_DOCUMENTS",
] as const;
export type TraderVerificationStatus = (typeof TRADER_VERIFICATION_STATUSES)[number];

export const traderProfilesTable = pgTable("trader_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id).unique(),
  businessName: varchar("business_name", { length: 255 }).notNull(),
  contactName: varchar("contact_name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }).notNull(),
  mainCategory: varchar("main_category", { length: 100 }).notNull(),
  additionalServices: json("additional_services").$type<string[]>().default([]),
  businessAddress: text("business_address"),
  town: varchar("town", { length: 100 }).notNull(),
  postcode: varchar("postcode", { length: 20 }).notNull(),
  serviceAreas: json("service_areas").$type<string[]>().default([]),
  businessDescription: text("business_description"),
  website: varchar("website", { length: 255 }),
  openingHours: text("opening_hours"),
  logoUrl: text("logo_url"),
  galleryUrls: json("gallery_urls").$type<string[]>().default([]),
  socialLinks: json("social_links").$type<{ facebook?: string; twitter?: string; instagram?: string; linkedin?: string }>(),
  plan: varchar("plan", { length: 20 }),
  isFeatured: boolean("is_featured").notNull().default(false),
  isActive: boolean("is_active").notNull().default(false),
  rating: real("rating"),
  reviewCount: integer("review_count").notNull().default(0),

  // --- Verification state machine (Phase 1+) ---
  verificationStatus: varchar("verification_status", { length: 40 })
    .notNull()
    .default("PENDING_EMAIL_VERIFICATION"),
  phoneVerified: boolean("phone_verified").notNull().default(false),
  businessProfileCompleted: boolean("business_profile_completed").notNull().default(false),
  documentsSubmitted: boolean("documents_submitted").notNull().default(false),
  submittedForReviewAt: timestamp("submitted_for_review_at"),
  verifiedAt: timestamp("verified_at"),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  adminNotes: text("admin_notes"),
  termsAcceptedAt: timestamp("terms_accepted_at"),
  privacyAcceptedAt: timestamp("privacy_accepted_at"),

  // --- Phone verification (Phase 2) ---
  phoneOtpHash: varchar("phone_otp_hash", { length: 255 }),
  phoneOtpExpiresAt: timestamp("phone_otp_expires_at"),
  phoneOtpAttempts: integer("phone_otp_attempts").notNull().default(0),
  phoneOtpLastSentAt: timestamp("phone_otp_last_sent_at"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTraderProfileSchema = createInsertSchema(traderProfilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTraderProfile = z.infer<typeof insertTraderProfileSchema>;
export type TraderProfile = typeof traderProfilesTable.$inferSelect;
