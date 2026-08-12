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
 * Early Access registrations captured from the public landing-site form.
 *
 * Deliberately NOT linked to app user accounts (users/trader_profiles):
 * this is a marketing/launch-updates list with its own consent lifecycle,
 * and connecting it to accounts would leak account existence.
 *
 * Consent model (two independent axes):
 * - launchConsentAt/Version  — required agreement to be emailed when early
 *   access opens / the app goes live. Refreshed on repeat registration.
 * - marketingConsentAt/Version — separate OPTIONAL ongoing-marketing
 *   consent. Only ever set when the marketing checkbox was explicitly
 *   ticked in that submission; never inferred, never bundled.
 * - unsubscribedAt + unsubscribeSource — suppression. 'admin' suppression
 *   is sticky (a later form re-submission records fresh consent evidence
 *   but does NOT lift it); 'user' unsubscribes can only be lifted by a new
 *   explicit marketing tick (fresh evidence, new timestamp + version).
 *
 * Legacy/imported records with unknown consent have launchConsentAt = NULL
 * and must stay that way unless real evidence is attached ("unknown" bucket).
 *
 * Double opt-in (Phase 2A):
 * - New submissions no longer set launchConsentAt/marketingConsentAt
 *   directly. The requested choices are stored as pending* fields together
 *   with a single-use confirmation token (HASH only — the raw token is never
 *   stored or logged) that expires after 48 hours.
 * - Only an explicit POST from the confirmation page copies the pending
 *   choices into the live consent columns and sets confirmedAt.
 * - Confirmation lifts a 'user' unsubscribe (verified resubscription) but
 *   NEVER an 'admin' suppression.
 * - Phase 1 rows (consent recorded before double opt-in existed) keep their
 *   classification: launchConsentAt set, confirmedAt NULL. Never backfill
 *   confirmedAt without a real confirmation event.
 */
export const earlyAccessRegistrationsTable = pgTable(
  "early_access_registrations",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    /** Email exactly as submitted (display). */
    email: varchar("email", { length: 254 }).notNull(),
    /** trim().toLowerCase() of email — dedupe key. */
    emailNormalized: varchar("email_normalized", { length: 254 }).notNull(),
    /** 'customer' | 'trader' | 'other' */
    audienceType: varchar("audience_type", { length: 20 }).notNull(),
    town: varchar("town", { length: 100 }),
    message: text("message"),
    /** Page the submission came from (Referer pathname), e.g. "/" or "/services/plumbers". */
    sourcePage: varchar("source_page", { length: 255 }),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),

    launchConsentAt: timestamp("launch_consent_at"),
    launchConsentVersion: varchar("launch_consent_version", { length: 40 }),

    marketingConsentAt: timestamp("marketing_consent_at"),
    marketingConsentVersion: varchar("marketing_consent_version", {
      length: 40,
    }),

    unsubscribedAt: timestamp("unsubscribed_at"),
    /** 'user' (self-service, Phase 2) | 'admin' (manual suppression). */
    unsubscribeSource: varchar("unsubscribe_source", { length: 20 }),

    /** When the latest confirmation request (form submission) was made. */
    pendingRequestedAt: timestamp("pending_requested_at"),
    /** Wording version of the launch consent awaiting confirmation. */
    pendingLaunchConsentVersion: varchar("pending_launch_consent_version", {
      length: 40,
    }),
    /**
     * Wording version of the OPTIONAL marketing consent awaiting
     * confirmation. NULL when the marketing box was not ticked in the latest
     * submission (the latest submission's checkbox choices are canonical).
     */
    pendingMarketingConsentVersion: varchar(
      "pending_marketing_consent_version",
      { length: 40 },
    ),
    /** SHA-256 hex of the single-use confirmation token. NEVER the raw token. */
    confirmationTokenHash: varchar("confirmation_token_hash", { length: 64 }),
    confirmationTokenExpiresAt: timestamp("confirmation_token_expires_at"),
    /** Set exactly once per token — the single-use marker. */
    confirmationTokenUsedAt: timestamp("confirmation_token_used_at"),
    /** Last successful email-ownership confirmation. */
    confirmedAt: timestamp("confirmed_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("early_access_email_normalized_unique_idx").on(
      table.emailNormalized,
    ),
    index("early_access_audience_type_idx").on(table.audienceType),
    index("early_access_joined_at_idx").on(table.joinedAt),
    index("early_access_confirmation_token_hash_idx").on(
      table.confirmationTokenHash,
    ),
  ],
);

export const EARLY_ACCESS_EVENT_KINDS = [
  "REGISTERED",
  "DETAILS_UPDATED",
  "LAUNCH_CONSENT",
  "MARKETING_CONSENT",
  "MARKETING_UNSUBSCRIBED",
  "ADMIN_SUPPRESSED",
  "CSV_EXPORTED",
  /**
   * A confirmation email dispatch attempt. details: { channel:
   * 'brevo'|'smtp'|'none'|'skipped', ok: boolean, resend?: true }.
   * NEVER contains the token or the confirmation URL.
   */
  "CONFIRMATION_SENT",
  /** Explicit ownership confirmation via the confirm POST. */
  "EMAIL_CONFIRMED",
] as const;

export type EarlyAccessEventKind = (typeof EARLY_ACCESS_EVENT_KINDS)[number];

/**
 * Consent-evidence + audit trail for the early access list.
 * - registrationId is NULL for list-level events (CSV_EXPORTED).
 * - performedBy is the admin users.id for admin actions, NULL for
 *   visitor-driven events.
 * - details must NEVER contain complete recipient lists or raw exported
 *   data — counts, filters and flags only.
 */
export const earlyAccessEventsTable = pgTable(
  "early_access_events",
  {
    id: serial("id").primaryKey(),
    registrationId: integer("registration_id"),
    kind: varchar("kind", { length: 40 }).notNull(),
    wordingVersion: varchar("wording_version", { length: 40 }),
    performedBy: integer("performed_by"),
    details: json("details"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("early_access_events_registration_id_idx").on(table.registrationId),
    index("early_access_events_kind_created_at_idx").on(
      table.kind,
      table.createdAt,
    ),
  ],
);

export type EarlyAccessRegistration =
  typeof earlyAccessRegistrationsTable.$inferSelect;
export type EarlyAccessEvent = typeof earlyAccessEventsTable.$inferSelect;
