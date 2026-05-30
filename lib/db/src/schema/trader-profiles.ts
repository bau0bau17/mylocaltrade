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
  "NEEDS_MORE_INFO",
  "VERIFIED",
  "REJECTED",
  "SUSPENDED",
  "EXPIRED_DOCUMENTS",
  // Reserved for a future periodic re-validation flow.
  "REVALIDATION_REQUIRED",
] as const;
export type TraderVerificationStatus = (typeof TRADER_VERIFICATION_STATUSES)[number];

// The relationship the person completing verification has to the business.
// Practical roles so owners, company officers, staff and sole traders can all
// be verified — and a non-owner can declare they are an authorised representative.
export const BUSINESS_ROLES = [
  "OWNER",
  "DIRECTOR",
  "MANAGER",
  "EMPLOYEE",
  "SELF_EMPLOYED",
  "OTHER",
] as const;
export type BusinessRole = (typeof BUSINESS_ROLES)[number];

export const traderProfilesTable = pgTable("trader_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id).unique(),
  businessName: varchar("business_name", { length: 255 }).notNull(),
  companyNumber: varchar("company_number", { length: 20 }),
  // Optional VAT registration number. Like companyNumber it is never required
  // (sole traders / self-employed may have neither); when supplied it is used
  // purely as a supporting validation aid, not as a gate.
  vatNumber: varchar("vat_number", { length: 20 }),
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

  // --- Verification: who is completing it & for what business (Task #38) ---
  // The person's relationship to the business (OWNER, DIRECTOR, MANAGER,
  // EMPLOYEE, SELF_EMPLOYED, OTHER). Null until the trader declares it.
  businessRole: varchar("business_role", { length: 30 }),
  // True when a non-owner declares they are acting with the owner's authority.
  // When set, an authorisation document is required during review.
  authorisedRepresentative: boolean("authorised_representative").notNull().default(false),
  // Optional business email domain captured as supporting evidence that a
  // non-owner representative genuinely works for the business.
  businessEmailDomain: varchar("business_email_domain", { length: 255 }),
  // --- Business email domain ownership confirmation (Task #39) ---
  // Round-trip email proof that the trader controls a mailbox at their declared
  // business email domain. Advisory trust signal only; never blocks approval.
  // True once a verification link sent to an address at the declared domain was
  // clicked, OR when the trader's already-verified login email is at that domain.
  businessEmailVerified: boolean("business_email_verified").notNull().default(false),
  // The specific address that was confirmed (shown to admins for context).
  businessEmailVerifiedAddress: varchar("business_email_verified_address", { length: 255 }),
  businessEmailVerifiedAt: timestamp("business_email_verified_at"),
  // The address a pending verification email was last sent to (and its token +
  // send time, used for the confirm link, 24h expiry and a resend cooldown).
  businessEmailVerificationTarget: varchar("business_email_verification_target", { length: 255 }),
  businessEmailVerificationToken: text("business_email_verification_token"),
  businessEmailVerificationSentAt: timestamp("business_email_verification_sent_at"),
  // The admin who granted verified status (accountability / audit aid).
  verifiedByAdminId: integer("verified_by_admin_id").references(() => usersTable.id),
  // Durable note the admin recorded at the moment of verification. Unlike
  // adminNotes (general-purpose, may be cleared by later lifecycle actions),
  // this preserves the original verification rationale for the audit trail.
  verificationNotes: text("verification_notes"),
  // When the admin asks for more information, the human-readable reason shown
  // to the trader so they know exactly what to supply.
  needsMoreInfoReason: text("needs_more_info_reason"),
  // --- Periodic re-validation (trust maintenance) ---
  // When a verified trader is next due to re-confirm their key documents so the
  // "Documents reviewed" trust signal stays current. Set at approval/re-confirm.
  revalidationDueAt: timestamp("revalidation_due_at"),
  // When we last prompted the trader to re-confirm (and started the grace clock).
  // Null once they re-confirm or before the first prompt fires.
  revalidationRemindedAt: timestamp("revalidation_reminded_at"),
  // Flipped on when a due trader fails to re-confirm within the grace period.
  // While true the profile is hidden from public search/listings.
  revalidationOverdue: boolean("revalidation_overdue").notNull().default(false),

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
  termsVersion: varchar("terms_version", { length: 20 }),
  privacyAcceptedAt: timestamp("privacy_accepted_at"),
  privacyVersion: varchar("privacy_version", { length: 20 }),

  // --- Phone verification (Phase 2) ---
  phoneOtpHash: varchar("phone_otp_hash", { length: 255 }),
  phoneOtpExpiresAt: timestamp("phone_otp_expires_at"),
  phoneOtpAttempts: integer("phone_otp_attempts").notNull().default(0),
  phoneOtpLastSentAt: timestamp("phone_otp_last_sent_at"),

  // --- Lead reminder preferences (Phase 22) ---
  // null = use default (60 min); 0 = off; otherwise delay in minutes (e.g. 30, 60, 180).
  leadReminderMinutes: integer("lead_reminder_minutes"),
  // Per-channel opt-out for the lead-reminder email (push toggle is separate).
  // When false, the lead-reminder email is suppressed even though the push reminder
  // (if enabled via leadReminderMinutes) still fires. Also flipped off by the
  // one-click unsubscribe link in the reminder email itself.
  leadReminderEmailEnabled: boolean("lead_reminder_email_enabled").notNull().default(true),

  // --- AI verification (Companies House cross-check) ---
  // Verdict produced by the AI cross-check between trader-supplied business
  // info and Companies House public records. Null = not yet checked.
  aiVerificationStatus: varchar("ai_verification_status", { length: 30 }),
  aiVerificationData: json("ai_verification_data").$type<{
    verdict: "MATCH" | "PARTIAL_MATCH" | "NO_MATCH" | "NOT_FOUND" | "ERROR";
    reasoning: string;
    submitted: { businessName: string; address: string; postcode: string };
    companiesHouse: {
      companyNumber?: string;
      companyName?: string;
      address?: string;
      postcode?: string;
      status?: string;
      sicCodes?: string[];
    } | null;
    error?: string;
  }>(),
  aiVerificationCheckedAt: timestamp("ai_verification_checked_at"),

  // --- VAT register cross-check (support layer) ---
  // Advisory only: a UK VAT checksum is always validated, and when HMRC API
  // credentials are configured the number is also looked up against the live
  // HMRC VAT register. Null = not yet checked. Never blocks approval.
  vatVerificationStatus: varchar("vat_verification_status", { length: 30 }),
  vatVerificationData: json("vat_verification_data").$type<{
    verdict: "REGISTERED" | "NOT_REGISTERED" | "VALID_FORMAT" | "INVALID_FORMAT" | "ERROR";
    reasoning: string;
    vatNumber: string;
    checksumValid: boolean;
    registerChecked: boolean;
    register: { name?: string; address?: string } | null;
    error?: string;
  }>(),
  vatVerificationCheckedAt: timestamp("vat_verification_checked_at"),

  // --- Business email domain trust signal (support layer) ---
  // Advisory only: checks that the declared business email domain resolves and
  // can receive mail (MX/A records) and whether it matches the website domain.
  // Null = not yet checked. Never required, never blocks approval.
  domainVerificationStatus: varchar("domain_verification_status", { length: 30 }),
  domainVerificationData: json("domain_verification_data").$type<{
    verdict: "RESOLVES_MATCHES_WEBSITE" | "RESOLVES" | "NO_MAIL_RECORDS" | "NOT_RESOLVED" | "ERROR";
    reasoning: string;
    domain: string;
    hasMailRecords: boolean;
    matchesWebsite: boolean | null;
    error?: string;
  }>(),
  domainVerificationCheckedAt: timestamp("domain_verification_checked_at"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertTraderProfileSchema = createInsertSchema(traderProfilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTraderProfile = z.infer<typeof insertTraderProfileSchema>;
export type TraderProfile = typeof traderProfilesTable.$inferSelect;
