import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// --- Account-deletion storage cleanup outbox ---
//
// Database rows and object-storage files cannot be mutated in one
// transaction, so terminal deletion (admin anonymise / complete) ENQUEUES a
// durable cleanup job in the same DB transaction that flips the account
// state, and the object deletions happen afterwards — immediately
// (best-effort post-commit) and via the hourly scheduler sweep until every
// object reaches a terminal state.
//
// Invariants:
//   - One job per user (unique index); repeated finalisation merges new
//     paths into the existing job instead of duplicating it.
//   - `objects` is the auditable per-path ledger. Paths are validated
//     against the owning user's namespace before any storage call — a path
//     outside it is marked `invalid` and never deleted (cross-user safety).
//   - An already-missing object counts as success (`missing`).
//   - The job only becomes DONE when every path is terminal
//     (deleted/missing/invalid); otherwise it stays PARTIAL with the error
//     recorded, and the sweep retries. Partial progress is never reported
//     as completion.

export const ACCOUNT_CLEANUP_STATUSES = ["PENDING", "PARTIAL", "DONE"] as const;
export type AccountCleanupStatus = (typeof ACCOUNT_CLEANUP_STATUSES)[number];

// Per-object states: pending (not yet attempted), deleted, missing (already
// gone = success), invalid (failed path validation — never attempted, kept
// for audit), error (storage failure; retried by the sweep).
export type AccountCleanupObject = {
  path: string;
  category:
    | "avatar"
    | "logo"
    | "gallery"
    | "verification-document"
    | "customer-upload";
  state: "pending" | "deleted" | "missing" | "invalid" | "error";
  error?: string;
};

export const accountCleanupJobsTable = pgTable(
  "account_cleanup_jobs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    objects: jsonb("objects").$type<AccountCleanupObject[]>().notNull().default([]),
    // Which flow enqueued it: 'anonymise' | 'complete' | 'orphan-sweep'.
    enqueuedBy: varchar("enqueued_by", { length: 40 }).notNull(),
    lastError: text("last_error"),
    lastAttemptAt: timestamp("last_attempt_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userUnique: uniqueIndex("account_cleanup_jobs_user_unique_idx").on(t.userId),
    statusIdx: index("account_cleanup_jobs_status_idx").on(t.status),
  }),
);

export type AccountCleanupJob = typeof accountCleanupJobsTable.$inferSelect;
