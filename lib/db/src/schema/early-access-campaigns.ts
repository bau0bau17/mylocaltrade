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
 * Early Access launch/marketing campaigns (Phase 2B).
 *
 * Campaigns are composed and controlled from the Admin Dashboard and sent in
 * DAILY BATCHES through the Brevo marketing-campaign API (never through the
 * transactional verification/password-reset route). The local database is
 * the single source of truth for consent, suppression and progress:
 *
 * - Eligibility is computed SERVER-side from early_access_registrations at
 *   queue time (immutable snapshot into campaign recipients) and unsubscribe
 *   / suppression are RE-CHECKED immediately before every batch.
 * - Every send is idempotent: recipients are reserved with conditional
 *   status transitions (queued → sending → sent) inside transactions, so
 *   double-clicks, retries and server restarts can never double-send.
 * - Content is a controlled branded template: plain-text fields + one HTTPS
 *   CTA URL. Arbitrary HTML is never accepted.
 */

export const EARLY_ACCESS_CAMPAIGN_TYPES = ["launch", "marketing"] as const;
export type EarlyAccessCampaignType =
  (typeof EARLY_ACCESS_CAMPAIGN_TYPES)[number];

export const EARLY_ACCESS_CAMPAIGN_STATUSES = [
  "draft",
  "queued",
  "sending",
  /** Daily cap reached with recipients remaining — admin continues next day. */
  "waiting_quota",
  "paused",
  "completed",
  /** Finished, but some recipients permanently failed. */
  "partially_failed",
  "cancelled",
] as const;
export type EarlyAccessCampaignStatus =
  (typeof EARLY_ACCESS_CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_AUDIENCES = [
  /** Double-opt-in Early Access registrations (default). */
  "early_access",
  /** Admin-imported Outreach Contacts — SEPARATE eligibility rules
   *  (evidence-based lawful routes), separate stats and exports. */
  "outreach",
] as const;
export type CampaignAudience = (typeof CAMPAIGN_AUDIENCES)[number];

export const earlyAccessCampaignsTable = pgTable(
  "early_access_campaigns",
  {
    id: serial("id").primaryKey(),
    /** 'launch' | 'marketing' — fixed at creation, drives eligibility rules. */
    type: varchar("type", { length: 20 }).notNull(),
    /** 'early_access' | 'outreach' — fixed at creation; picks the audience
     *  list AND the eligibility engine. The two lists never mix. */
    audience: varchar("audience", { length: 20 }).notNull().default("early_access"),
    /** Internal name shown only in admin. */
    name: varchar("name", { length: 120 }).notNull(),

    subject: varchar("subject", { length: 150 }).notNull().default(""),
    previewText: varchar("preview_text", { length: 200 }).notNull().default(""),
    heading: varchar("heading", { length: 150 }).notNull().default(""),
    /** Plain text; rendered into the branded template as escaped paragraphs. */
    bodyText: text("body_text").notNull().default(""),
    ctaLabel: varchar("cta_label", { length: 60 }).notNull().default(""),
    /** HTTPS only, validated server-side; never hardcoded by the template. */
    ctaUrl: varchar("cta_url", { length: 500 }).notNull().default(""),

    status: varchar("status", { length: 30 }).notNull().default("draft"),
    createdBy: integer("created_by").notNull(),
    /** Snapshot facts, frozen at queue time. */
    queuedAt: timestamp("queued_at"),
    queuedBy: integer("queued_by"),
    snapshotCount: integer("snapshot_count"),
    completedAt: timestamp("completed_at"),

    /**
     * Retention model (see docs/data-retention.md):
     * - A DRAFT that was never queued (no recipient snapshot, no batches)
     *   may be hard-deleted; a CAMPAIGN_DELETED audit event is kept.
     * - Anything that was ever queued/sent/cancelled is NEVER hard-deleted
     *   from admin — it is ARCHIVED instead (hidden from the default list),
     *   preserving the full audit trail.
     */
    archivedAt: timestamp("archived_at"),
    archivedBy: integer("archived_by"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("ea_campaigns_status_idx").on(table.status),
    index("ea_campaigns_type_idx").on(table.type),
  ],
);

export const EARLY_ACCESS_RECIPIENT_STATUSES = [
  "queued",
  /** Reserved by a batch in progress (crash-recovery marker). */
  "sending",
  "sent",
  /** Confirmed delivered via Brevo events, where available. */
  "delivered",
  "failed",
  "bounced",
  "complained",
  "unsubscribed",
  /** Skipped at batch time: opted out / suppressed after the snapshot. */
  "suppressed",
  "cancelled",
] as const;
export type EarlyAccessRecipientStatus =
  (typeof EARLY_ACCESS_RECIPIENT_STATUSES)[number];

/**
 * Immutable audience snapshot, one row per (campaign, registration).
 * The snapshot fixes WHO was eligible at queue time; each batch re-checks
 * the live registration row and downgrades to 'suppressed'/'unsubscribed'
 * instead of sending when consent changed since.
 */
export const earlyAccessCampaignRecipientsTable = pgTable(
  "early_access_campaign_recipients",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id").notNull(),
    /** Set for audience='early_access' recipients; NULL for outreach. */
    registrationId: integer("registration_id"),
    /** Set for audience='outreach' recipients; NULL for early access.
     *  Exactly one of registrationId/outreachContactId is set per row. */
    outreachContactId: integer("outreach_contact_id"),
    /** Denormalised at snapshot time (audit stability if the row changes). */
    emailNormalized: varchar("email_normalized", { length: 254 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),

    status: varchar("status", { length: 20 }).notNull().default("queued"),
    /** Which daily batch handled this recipient. */
    batchNumber: integer("batch_number"),
    sentAt: timestamp("sent_at"),
    /** Short machine reason for terminal states — never message content. */
    statusDetail: varchar("status_detail", { length: 120 }),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ea_campaign_recipients_unique_idx").on(
      table.campaignId,
      table.registrationId,
    ),
    index("ea_campaign_recipients_campaign_status_idx").on(
      table.campaignId,
      table.status,
    ),
    index("ea_campaign_recipients_registration_idx").on(table.registrationId),
    uniqueIndex("ea_campaign_recipients_outreach_unique_idx").on(
      table.campaignId,
      table.outreachContactId,
    ),
    index("ea_campaign_recipients_outreach_idx").on(table.outreachContactId),
    /** Daily-cap accounting scans sends by day. */
    index("ea_campaign_recipients_sent_at_idx").on(table.sentAt),
  ],
);

export const EARLY_ACCESS_BATCH_STATUSES = [
  /** Created + recipients reserved; Brevo objects may not exist yet. */
  "pending",
  "sent",
  "failed",
] as const;
export type EarlyAccessBatchStatus =
  (typeof EARLY_ACCESS_BATCH_STATUSES)[number];

/**
 * One row per daily batch actually dispatched. Stores the Brevo list +
 * campaign references so a crash between "Brevo campaign created" and
 * "recipients marked sent" is recoverable without a duplicate send.
 */
export const earlyAccessCampaignBatchesTable = pgTable(
  "early_access_campaign_batches",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id").notNull(),
    batchNumber: integer("batch_number").notNull(),
    recipientCount: integer("recipient_count").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    /** Brevo references (ids only — never content or recipient lists). */
    brevoListId: integer("brevo_list_id"),
    brevoCampaignId: integer("brevo_campaign_id"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    sentAt: timestamp("sent_at"),
    statusDetail: varchar("status_detail", { length: 200 }),
    /**
     * Temporary Brevo list cleanup lifecycle: Brevo has a finite list quota,
     * so per-batch lists are deleted once the send can no longer be
     * affected. Local snapshot/audit rows are NEVER deleted; only the
     * remote temporary list is. Cleanup is idempotent (a remote 404 counts
     * as cleaned) and retryable without ever re-sending anything.
     */
    brevoListDeletedAt: timestamp("brevo_list_deleted_at"),
    cleanupAttempts: integer("cleanup_attempts").notNull().default(0),
    cleanupLastError: varchar("cleanup_last_error", { length: 200 }),
  },
  (table) => [
    uniqueIndex("ea_campaign_batches_unique_idx").on(
      table.campaignId,
      table.batchNumber,
    ),
  ],
);

export const EARLY_ACCESS_CAMPAIGN_EVENT_KINDS = [
  "CAMPAIGN_CREATED",
  "CAMPAIGN_UPDATED",
  /** details: { channel, ok } — recipient is the acting admin, never listed. */
  "TEST_SENT",
  /** Queue confirmation. details: counts + confirmation phrase flag only. */
  "CAMPAIGN_QUEUED",
  "CAMPAIGN_PAUSED",
  "CAMPAIGN_RESUMED",
  /** details: { batchNumber, attempted, sent, skipped, failed }. */
  "BATCH_SENT",
  /** Temporary Brevo list/draft cleanup. details: ids + outcome only. */
  "BREVO_CLEANUP",
  "BREVO_CLEANUP_FAILED",
  /** Explicit Brevo credit rejection moved the campaign to waiting_quota. */
  "BATCH_REJECTED",
  "CAMPAIGN_CANCELLED",
  "CAMPAIGN_COMPLETED",
  /** Terminal campaign hidden from the default admin list (reversible). */
  "CAMPAIGN_ARCHIVED",
  "CAMPAIGN_UNARCHIVED",
  /** Never-queued draft hard-deleted. details: non-identifying facts only
   *  (name/type/audience/createdAt) — this event outlives the campaign row. */
  "CAMPAIGN_DELETED",
  /** Recipient rows stripped of personal data (email/name/source links);
   *  statuses and counts kept for aggregate stats. details: counts only. */
  "RECIPIENTS_ANONYMISED",
] as const;
export type EarlyAccessCampaignEventKind =
  (typeof EARLY_ACCESS_CAMPAIGN_EVENT_KINDS)[number];

/**
 * Campaign audit trail. details NEVER contain recipient lists, email
 * content, API keys or tokens — counts, ids and flags only.
 */
export const earlyAccessCampaignEventsTable = pgTable(
  "early_access_campaign_events",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id").notNull(),
    kind: varchar("kind", { length: 40 }).notNull(),
    performedBy: integer("performed_by"),
    details: json("details"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("ea_campaign_events_campaign_idx").on(table.campaignId),
    index("ea_campaign_events_kind_created_idx").on(
      table.kind,
      table.createdAt,
    ),
  ],
);

export type EarlyAccessCampaign =
  typeof earlyAccessCampaignsTable.$inferSelect;
export type EarlyAccessCampaignRecipient =
  typeof earlyAccessCampaignRecipientsTable.$inferSelect;
export type EarlyAccessCampaignBatch =
  typeof earlyAccessCampaignBatchesTable.$inferSelect;
export type EarlyAccessCampaignEvent =
  typeof earlyAccessCampaignEventsTable.$inferSelect;
