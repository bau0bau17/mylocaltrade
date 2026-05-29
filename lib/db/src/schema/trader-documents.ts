import { pgTable, serial, integer, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const TRADER_DOCUMENT_TYPES = [
  "ID_DOCUMENT",
  "PROOF_OF_ADDRESS",
  "INSURANCE",
  "QUALIFICATION",
  // Task #38: business-identity & authority evidence.
  "COMPANY_REGISTRATION",
  "VAT_REGISTRATION",
  "BUSINESS_ADDRESS",
  "AUTHORISATION",
  "OTHER",
] as const;
export type TraderDocumentType = (typeof TRADER_DOCUMENT_TYPES)[number];

export const TRADER_DOCUMENT_STATUSES = [
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
] as const;
export type TraderDocumentStatus = (typeof TRADER_DOCUMENT_STATUSES)[number];

export const traderDocumentsTable = pgTable("trader_documents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 40 }).notNull(),
  objectPath: text("object_path").notNull(),
  originalFilename: varchar("original_filename", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("PENDING_REVIEW"),
  rejectionReason: text("rejection_reason"),
  expiresAt: timestamp("expires_at"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: integer("reviewed_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type TraderDocument = typeof traderDocumentsTable.$inferSelect;
