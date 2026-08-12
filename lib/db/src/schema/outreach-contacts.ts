import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  timestamp,
  json,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Outreach Contacts — admin-imported BUSINESS contact list (UK GDPR/PECR
 * controlled direct-marketing outreach).
 *
 * HARD SEPARATION from Early Access: these rows are NEVER Early Access
 * registrations, never appear in Early Access stats/exports, and a publicly
 * available email address is NEVER treated as marketing consent. Eligibility
 * is computed SERVER-side from stored evidence and re-checked before every
 * preview, queue and send.
 *
 * Eligibility categories (server-enforced, no silent admin override):
 * - CONFIRMED_CONSENT            — valid consent evidence + date + wording
 *                                  + source stored.
 * - EXISTING_CUSTOMER_SOFT_OPT_IN — address obtained directly during a sale
 *                                  or genuine negotiation of MyLocalTrade
 *                                  services, campaign concerns similar
 *                                  services, opt-out offered at collection
 *                                  AND in every email; evidence stored for
 *                                  every requirement.
 * - CORPORATE_B2B                — verified corporate subscriber (Ltd/LLP)
 *                                  with company evidence, relevance/purpose
 *                                  and a documented legitimate-interest
 *                                  assessment. Named corporate addresses are
 *                                  still personal data.
 * - SOLE_TRADER_OR_INDIVIDUAL    — BLOCKED without valid consent or a fully
 *                                  evidenced soft opt-in (PECR treats them
 *                                  as individual subscribers).
 * - UNKNOWN_OR_UNVERIFIED        — BLOCKED. No override exists that converts
 *                                  an unknown contact into an eligible one.
 *
 * A consent-request email is NOT a lawful workaround (it is itself direct
 * marketing) — nothing in this system sends one.
 */

export const OUTREACH_BUSINESS_TYPES = [
  "limited_company",
  "llp",
  "sole_trader",
  "partnership",
  "individual",
  "unknown",
] as const;
export type OutreachBusinessType = (typeof OUTREACH_BUSINESS_TYPES)[number];

export const OUTREACH_LAWFUL_ROUTES = [
  "confirmed_consent",
  "soft_opt_in",
  "corporate_b2b",
  /** No lawful marketing route claimed — contact stays blocked. */
  "none",
] as const;
export type OutreachLawfulRoute = (typeof OUTREACH_LAWFUL_ROUTES)[number];

export const OUTREACH_ELIGIBILITY_CATEGORIES = [
  "CONFIRMED_CONSENT",
  "EXISTING_CUSTOMER_SOFT_OPT_IN",
  "CORPORATE_B2B",
  "SOLE_TRADER_OR_INDIVIDUAL",
  "UNKNOWN_OR_UNVERIFIED",
] as const;
export type OutreachEligibilityCategory =
  (typeof OUTREACH_ELIGIBILITY_CATEGORIES)[number];

export const outreachContactsTable = pgTable(
  "outreach_contacts",
  {
    id: serial("id").primaryKey(),
    /** Email exactly as imported (display). */
    email: varchar("email", { length: 254 }).notNull(),
    /** trim().toLowerCase() — dedupe key within outreach AND across lists. */
    emailNormalized: varchar("email_normalized", { length: 254 }).notNull(),
    contactName: varchar("contact_name", { length: 100 }),
    companyName: varchar("company_name", { length: 200 }),
    businessType: varchar("business_type", { length: 20 }).notNull(),
    companyNumber: varchar("company_number", { length: 20 }),
    website: varchar("website", { length: 300 }),

    /** Where the address came from — name (e.g. "Company website"). */
    sourceName: varchar("source_name", { length: 200 }).notNull(),
    /** Exact source URL or description — required provenance evidence. */
    sourceDetail: varchar("source_detail", { length: 500 }).notNull(),
    /** When the address was obtained (drives the Art.14 one-month clock). */
    obtainedAt: timestamp("obtained_at").notNull(),
    country: varchar("country", { length: 60 }).notNull(),

    lawfulRoute: varchar("lawful_route", { length: 30 }).notNull().default("none"),
    /** Route A — confirmed consent. */
    consentAt: timestamp("consent_at"),
    /** Exact consent evidence incl. wording + where it was given. */
    consentEvidence: text("consent_evidence"),
    /** Route B — soft opt-in, one evidence field PER legal requirement. */
    soiSaleEvidence: text("soi_sale_evidence"),
    soiRelevanceEvidence: text("soi_relevance_evidence"),
    soiOptOutEvidence: text("soi_opt_out_evidence"),
    /** Route C — corporate B2B, one evidence field PER legal requirement. */
    b2bCompanyEvidence: text("b2b_company_evidence"),
    b2bRelevanceEvidence: text("b2b_relevance_evidence"),
    /** Documented legitimate-interest assessment (LIA). */
    b2bLiaEvidence: text("b2b_lia_evidence"),

    notes: text("notes"),
    importedBy: integer("imported_by").notNull(),
    importedAt: timestamp("imported_at").notNull().defaultNow(),

    /** 'eligible' | 'blocked' — ALWAYS server-computed, never client input. */
    eligibilityStatus: varchar("eligibility_status", { length: 20 }).notNull(),
    eligibilityCategory: varchar("eligibility_category", { length: 40 }).notNull(),
    eligibilityReason: varchar("eligibility_reason", { length: 400 }).notNull(),

    /** Voluntary opt-out / objection — permanent for marketing. */
    unsubscribedAt: timestamp("unsubscribed_at"),
    /** 'user' | 'admin' | 'objection' | 'complaint'. */
    unsubscribeSource: varchar("unsubscribe_source", { length: 20 }),
    /** Deliverability suppression (hard bounce / spam complaint / block). */
    emailSuppressedAt: timestamp("email_suppressed_at"),
    emailSuppressionReason: varchar("email_suppression_reason", { length: 40 }),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("outreach_contacts_email_unique_idx").on(table.emailNormalized),
    index("outreach_contacts_eligibility_idx").on(
      table.eligibilityStatus,
      table.eligibilityCategory,
    ),
    index("outreach_contacts_business_type_idx").on(table.businessType),
  ],
);

/**
 * Permanent minimal suppression list. When an outreach contact unsubscribes,
 * objects, complains or hard-bounces — or an opted-out contact is deleted —
 * the emailNormalized + reason are retained HERE so the address can never be
 * accidentally re-imported or contacted again. Contains no other personal
 * data (data-minimised by design). Rows are never deleted by contact
 * deletion; import validation and every send re-check consult this table.
 */
export const outreachSuppressionsTable = pgTable(
  "outreach_suppressions",
  {
    id: serial("id").primaryKey(),
    emailNormalized: varchar("email_normalized", { length: 254 }).notNull(),
    /** 'unsubscribed' | 'objection' | 'complaint' | 'hard_bounce' | 'blocked' | 'admin'. */
    reason: varchar("reason", { length: 40 }).notNull(),
    /** 'user_link' | 'brevo_webhook' | 'admin' | 'contact_deletion'. */
    source: varchar("source", { length: 40 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("outreach_suppressions_email_unique_idx").on(
      table.emailNormalized,
    ),
  ],
);

export const OUTREACH_EVENT_KINDS = [
  "CONTACT_ADDED",
  "CONTACT_IMPORTED",
  "CONTACT_UPDATED",
  "ELIGIBILITY_RECOMPUTED",
  "CONTACT_UNSUBSCRIBED",
  "CONTACT_OBJECTED",
  "CONTACT_SUPPRESSED",
  "CONTACT_DELETED",
  /** Import-level summary event (contactId NULL): counts only. */
  "IMPORT_COMMITTED",
] as const;
export type OutreachEventKind = (typeof OUTREACH_EVENT_KINDS)[number];

/**
 * Outreach audit trail — separate from Early Access events. details hold
 * counts, reasons and flags only; never email bodies, tokens or bulk lists.
 */
export const outreachEventsTable = pgTable(
  "outreach_events",
  {
    id: serial("id").primaryKey(),
    /** NULL for import-level events. */
    contactId: integer("contact_id"),
    kind: varchar("kind", { length: 40 }).notNull(),
    performedBy: integer("performed_by"),
    details: json("details"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("outreach_events_contact_idx").on(table.contactId),
    index("outreach_events_kind_created_idx").on(table.kind, table.createdAt),
  ],
);

export type OutreachContact = typeof outreachContactsTable.$inferSelect;
export type OutreachSuppression = typeof outreachSuppressionsTable.$inferSelect;
export type OutreachEvent = typeof outreachEventsTable.$inferSelect;
