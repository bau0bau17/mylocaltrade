import { db } from "@workspace/db";
import {
  profileChangeRequestsTable,
  profileChangeRequestEventsTable,
  usersTable,
  traderProfilesTable,
  PROTECTED_TRADER_FIELDS,
  PROTECTED_CUSTOMER_FIELDS,
  ACTIVE_PROFILE_CHANGE_STATUSES,
  type ProfileChangeRequest,
} from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { logAudit } from "./trader-status";

export { PROTECTED_TRADER_FIELDS, PROTECTED_CUSTOMER_FIELDS };

/**
 * Fields whose approval requires an explicit admin reason/confirmation
 * (Part 5: company name, personal name, phone number are sensitive).
 */
export const SENSITIVE_FIELDS = new Set([
  "businessName",
  "contactName",
  "fullName",
  "phone",
]);

/** Human-readable labels, shared by notifications and admin serialisation. */
export const FIELD_LABELS: Record<string, string> = {
  businessName: "Business name",
  contactName: "Contact name",
  phone: "Phone number",
  website: "Website",
  businessDescription: "Business description",
  fullName: "Full name",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/**
 * Whether protected-field change control is active for a TRADER. It begins at
 * first submission for review and never turns off afterwards (pending review,
 * verified/live, needs-more-info and re-validation all keep it on).
 */
export function traderChangeControlActive(profile: {
  submittedForReviewAt: Date | null;
}): boolean {
  return profile.submittedForReviewAt != null;
}

/**
 * Whether change control is active for a CUSTOMER. The account is
 * "established" once its email is verified — before that the user cannot
 * sign in or use the app, so all earlier edits are part of initial setup.
 */
export function customerChangeControlActive(user: {
  emailVerified: boolean;
}): boolean {
  return user.emailVerified;
}

const ACTIVE_STATUSES = [...ACTIVE_PROFILE_CHANGE_STATUSES];

/** All active (PENDING / NEEDS_INFO) requests for a user. */
export async function getActiveChangeRequests(
  userId: number,
): Promise<ProfileChangeRequest[]> {
  return db
    .select()
    .from(profileChangeRequestsTable)
    .where(
      and(
        eq(profileChangeRequestsTable.userId, userId),
        inArray(profileChangeRequestsTable.status, ACTIVE_STATUSES),
      ),
    );
}

export class ActiveRequestExistsError extends Error {
  constructor(public field: string) {
    super(
      `A change to your ${fieldLabel(field).toLowerCase()} is already pending review. Please wait for a decision before submitting another change.`,
    );
    this.name = "ActiveRequestExistsError";
  }
}

/**
 * Create a pending profile change request plus its SUBMITTED audit event and
 * trader-audit entry. Throws ActiveRequestExistsError when an active request
 * for the same field already exists (also enforced by a partial unique index,
 * so a concurrent duplicate submission cannot slip through).
 */
export async function createChangeRequest(opts: {
  userId: number;
  role: "trader" | "customer";
  traderProfileId?: number | null;
  field: string;
  currentValue: string | null;
  proposedValue: string | null;
  phoneOtpVerified?: boolean;
  phoneOtpVerifiedAt?: Date | null;
}): Promise<ProfileChangeRequest> {
  try {
    const request = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(profileChangeRequestsTable)
        .values({
          userId: opts.userId,
          role: opts.role,
          traderProfileId: opts.traderProfileId ?? null,
          field: opts.field,
          currentValue: opts.currentValue,
          proposedValue: opts.proposedValue,
          status: "PENDING",
          phoneOtpVerified: opts.phoneOtpVerified ?? false,
          phoneOtpVerifiedAt: opts.phoneOtpVerifiedAt ?? null,
        })
        .returning();
      await tx.insert(profileChangeRequestEventsTable).values({
        requestId: created.id,
        actorUserId: opts.userId,
        actorRole: opts.role,
        eventType: "SUBMITTED",
        note: null,
      });
      return created;
    });
    logAudit({
      userId: opts.userId,
      action: "PROFILE_CHANGE_REQUESTED",
      details: { requestId: request.id, field: opts.field, role: opts.role },
      notes: `Change to ${fieldLabel(opts.field).toLowerCase()} submitted for review.`,
    });
    return request;
  } catch (err) {
    // Unique-violation on the partial index = concurrent duplicate.
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      throw new ActiveRequestExistsError(opts.field);
    }
    throw err;
  }
}

/** Normalise for change comparison: trim, treat empty string as null. */
export function normValue(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/**
 * Serialise a request for the request's OWNER (mobile app). The proposed
 * value is included — it is their own submission — but this shape must never
 * be used for public/unrelated-user responses.
 */
export function serializeOwnRequest(r: ProfileChangeRequest) {
  return {
    id: r.id,
    field: r.field,
    fieldLabel: fieldLabel(r.field),
    proposedValue: r.proposedValue,
    status: r.status,
    phoneOtpVerified: r.phoneOtpVerified,
    adminInfoRequest: r.status === "NEEDS_INFO" ? r.adminInfoRequest : null,
    decisionReason:
      r.status === "REJECTED" || r.status === "APPROVED" ? r.decisionReason : null,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Load user + optional trader profile for change-control decisions. */
export async function loadChangeContext(userId: number) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) return null;
  if (user.role === "trader") {
    const [profile] = await db
      .select()
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, userId))
      .limit(1);
    return { user, profile: profile ?? null };
  }
  return { user, profile: null };
}
