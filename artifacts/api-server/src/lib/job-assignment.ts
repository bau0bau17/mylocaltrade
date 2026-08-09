import { and, eq, isNull, notInArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  companyMembersTable,
  conversationsTable,
  traderProfilesTable,
  usersTable,
} from "@workspace/db/schema";
import { companyTeamsEnabled } from "./company-membership";
import { deriveStage } from "./conversation-stage";
import { logAudit } from "./trader-status";
import { jobReferenceOf } from "./job-reference";

/**
 * Company Teams — job claiming (Phase 2).
 *
 * A new company lead starts UNASSIGNED. The first ACTIVE member who performs
 * a customer-facing action (sends the first trader message or submits the
 * company quote) claims the job atomically; from then on only the assigned
 * member may act on it (the owner and other members can read everything but
 * are read-only until Phase 3 reassignment ships).
 *
 * Flag OFF: every function here is a no-op / instant pass — conversations are
 * born assigned to the owner, so the legacy single-login behaviour is
 * untouched.
 */

type ConversationRow = typeof conversationsTable.$inferSelect;

// Matches both the root `db` handle and a drizzle transaction handle for the
// few queries we need inside/outside transactions.
type Executor = Pick<typeof db, "select" | "update">;

export class JobClaimedByOtherError extends Error {
  constructor(
    public readonly assignedUserId: number | null,
    public readonly assignedName: string,
  ) {
    super(`This job was claimed by ${assignedName}.`);
    this.name = "JobClaimedByOtherError";
  }
}

/** Stable response body for “someone else holds this job”. */
export function jobClaimedByOtherBody(assignedName: string) {
  return {
    error: `This job was claimed by ${assignedName}.`,
    code: "JOB_CLAIMED_BY_OTHER",
    assignedName,
  } as const;
}

async function displayNameOf(
  executor: Executor,
  userId: number,
): Promise<string> {
  const [u] = await executor
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return u?.fullName?.trim() || "a team member";
}

/**
 * Lock the conversation row (SELECT … FOR UPDATE) and return its CURRENT
 * assignee. The caller's `conv` snapshot was loaded before the transaction
 * began — a reassignment, claim, or removal handover may have committed in
 * between. The lock serializes this transaction against all of those flows,
 * so "whichever transaction commits first determines the valid state" holds
 * for every trader-side write.
 */
async function lockAssignment(tx: Executor, conversationId: number): Promise<number | null> {
  const [current] = await tx
    .select({ assigned: conversationsTable.assignedTraderUserId })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))
    .for("update")
    .limit(1);
  return current?.assigned ?? null;
}

/**
 * Claim the conversation for `userId`, or verify they already hold it.
 *
 * MUST be called INSIDE the same transaction as the customer-facing write
 * (message insert / quote insert) and BEFORE it, so that a losing racer's
 * write is rolled back and never becomes visible to the customer.
 *
 * Concurrency: the FOR UPDATE lock serializes claimers, reassignments, and
 * removal handovers. A concurrent transaction blocks until the winner
 * commits, then re-reads the committed assignee — exactly one member can
 * ever win a claim, and a write racing a reassignment either commits first
 * (valid) or sees the new assignee and rolls back entirely.
 */
export async function claimOrRequireAssigned(
  tx: Executor,
  conv: ConversationRow,
  userId: number,
): Promise<{ claimedNow: boolean }> {
  if (!companyTeamsEnabled()) return { claimedNow: false };
  const assigned = await lockAssignment(tx, conv.id);
  if (assigned === userId) return { claimedNow: false };
  if (assigned != null) {
    throw new JobClaimedByOtherError(assigned, await displayNameOf(tx, assigned));
  }
  await tx
    .update(conversationsTable)
    .set({ assignedTraderUserId: userId, assignedAt: new Date() })
    .where(eq(conversationsTable.id, conv.id));
  return { claimedNow: true };
}

/**
 * In-transaction guard for NON-claiming trader-side writes (bookings,
 * mark-done, cancel, close, quote revise/withdraw): locks the conversation
 * row and throws JobClaimedByOtherError when it is currently assigned to a
 * different member. Unclaimed jobs pass (the only pre-claim mutations are
 * deliberate non-claiming ones, e.g. cancelling an unclaimed lead).
 *
 * Use this INSIDE the transaction that performs the write; the pre-check
 * `canActOnJob` outside the transaction is a fast-path courtesy only and
 * cannot be relied on under concurrency.
 */
export async function requireAssignedInTx(
  tx: Executor,
  conversationId: number,
  userId: number,
): Promise<void> {
  if (!companyTeamsEnabled()) return;
  const assigned = await lockAssignment(tx, conversationId);
  if (assigned != null && assigned !== userId) {
    throw new JobClaimedByOtherError(assigned, await displayNameOf(tx, assigned));
  }
}

/**
 * Gate for NON-claiming trader-side mutations (bookings, mark-done, cancel,
 * close, …): on a claimed job only the assigned member may act. Unclaimed
 * jobs pass — the only mutations reachable before a claim are deliberate
 * non-claiming ones (e.g. cancelling an unclaimed lead), and viewing/reading
 * never routes through here at all.
 */
export async function canActOnJob(
  conv: ConversationRow,
  userId: number,
): Promise<{ ok: true } | { ok: false; assignedName: string }> {
  if (!companyTeamsEnabled()) return { ok: true };
  if (conv.assignedTraderUserId == null || conv.assignedTraderUserId === userId) {
    return { ok: true };
  }
  return { ok: false, assignedName: await displayNameOf(db, conv.assignedTraderUserId) };
}

// ---------------------------------------------------------------------------
// Phase 3 — owner reassignment & removal handover
// ---------------------------------------------------------------------------

/** Stages in which a job can no longer change hands. */
const INACTIVE_STAGES = new Set(["CANCELLED", "JOB_DONE", "CLOSED"]);

/** Active/open per the canonical stage rules (deriveStage) — the single
 *  definition used by reassignment and removal handover. */
export function jobIsActive(conv: ConversationRow): boolean {
  return !INACTIVE_STAGES.has(deriveStage(conv));
}

/** Reassignment rejections that map to specific 409/400 codes. */
export class ReassignmentError extends Error {
  constructor(
    public readonly code: "ALREADY_ASSIGNED" | "JOB_NOT_ACTIVE" | "INVALID_ASSIGNEE",
  ) {
    super(code);
    this.name = "ReassignmentError";
  }
}

/**
 * Atomically reassign a conversation to `toUserId`, returning the previous
 * assignee. The caller's OWNER role is checked by the route BEFORE this runs;
 * everything that can change concurrently — stage, current assignee, and the
 * TARGET's membership — is re-checked here under locks. Retries and
 * double-taps land on ALREADY_ASSIGNED and produce no side effects — only
 * the transaction that actually flips the assignee reaches the post-commit
 * message/notification/audit block.
 */
export async function reassignJobTx(opts: {
  conversationId: number;
  toUserId: number;
}): Promise<{ prevAssignedUserId: number | null }> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, opts.conversationId))
      .for("update")
      .limit(1);
    if (!row || !jobIsActive(row)) throw new ReassignmentError("JOB_NOT_ACTIVE");
    if (row.assignedTraderUserId === opts.toUserId) {
      throw new ReassignmentError("ALREADY_ASSIGNED");
    }
    // Re-validate the TARGET under lock: the route's membership check ran
    // before this transaction, so the target could have been removed in
    // between. FOR SHARE on the membership row serializes against the
    // removal flow's conditional ACTIVE→REVOKED UPDATE — whichever commits
    // first, a live job can never end up assigned to a revoked member: if we
    // win, removal's handover (which runs after its membership flip, in the
    // same transaction) sweeps this job to the owner; if removal wins, no
    // ACTIVE row is visible here and we reject. The profile owner passes
    // without a membership row — they cannot be removed, and may predate the
    // membership backfill. No deadlock is possible: this conversation is not
    // currently assigned to the target (checked above), so the removal
    // flow's handover UPDATE never touches the row we hold.
    const [profile] = await tx
      .select({ ownerUserId: traderProfilesTable.userId })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.id, row.traderProfileId))
      .limit(1);
    if (!profile) throw new ReassignmentError("INVALID_ASSIGNEE");
    if (opts.toUserId !== profile.ownerUserId) {
      const [member] = await tx
        .select({ id: companyMembersTable.id })
        .from(companyMembersTable)
        .where(
          and(
            eq(companyMembersTable.traderProfileId, row.traderProfileId),
            eq(companyMembersTable.userId, opts.toUserId),
            eq(companyMembersTable.status, "ACTIVE"),
          ),
        )
        .for("share")
        .limit(1);
      if (!member) throw new ReassignmentError("INVALID_ASSIGNEE");
    }
    const now = new Date();
    await tx
      .update(conversationsTable)
      .set({ assignedTraderUserId: opts.toUserId, assignedAt: now, updatedAt: now })
      .where(eq(conversationsTable.id, opts.conversationId));
    return { prevAssignedUserId: row.assignedTraderUserId };
  });
}

/**
 * Move every LIVE job assigned to `fromUserId` over to the owner. MUST run
 * inside the same transaction that revokes the membership, so a crash can
 * never leave an active job assigned to an inactive member. Completed and
 * cancelled jobs keep their historical assignee on purpose (the predicate
 * mirrors jobIsActive/deriveStage: not cancelled, not customer-completed,
 * not CLOSED/BLOCKED).
 */
export async function handoverActiveJobsToOwner(
  tx: Executor,
  opts: { traderProfileId: number; fromUserId: number; ownerUserId: number },
): Promise<ConversationRow[]> {
  const now = new Date();
  return await tx
    .update(conversationsTable)
    .set({ assignedTraderUserId: opts.ownerUserId, assignedAt: now, updatedAt: now })
    .where(
      and(
        eq(conversationsTable.traderProfileId, opts.traderProfileId),
        eq(conversationsTable.assignedTraderUserId, opts.fromUserId),
        isNull(conversationsTable.cancelledAt),
        isNull(conversationsTable.customerCompletedAt),
        notInArray(conversationsTable.status, ["CLOSED", "BLOCKED"]),
      ),
    )
    .returning();
}

async function companyAnchor(traderProfileId: number) {
  const [profile] = await db
    .select({
      userId: traderProfilesTable.userId,
      businessName: traderProfilesTable.businessName,
    })
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.id, traderProfileId))
    .limit(1);
  return profile ?? null;
}

/**
 * Fire-and-forget audit: a member claimed a job. Call AFTER the claiming
 * transaction committed (never inside it — a failed audit write must not
 * roll back a customer-facing action, and logAudit already swallows errors).
 */
export async function logJobClaimed(opts: {
  conv: ConversationRow;
  actorUserId: number;
  via: "message" | "quote";
}): Promise<void> {
  const profile = await companyAnchor(opts.conv.traderProfileId);
  if (!profile) return;
  const actorName = await displayNameOf(db, opts.actorUserId);
  const ref = jobReferenceOf(opts.conv) ?? `#${opts.conv.id}`;
  await logAudit({
    userId: profile.userId,
    action: "JOB_CLAIMED",
    performedBy: opts.actorUserId,
    details: {
      conversationId: opts.conv.id,
      enquiryId: opts.conv.enquiryId,
      traderProfileId: opts.conv.traderProfileId,
      via: opts.via,
    },
    notes: `${actorName} claimed job ${ref}${opts.conv.serviceRequired ? ` (${opts.conv.serviceRequired})` : ""} for ${profile.businessName} by sending the first ${opts.via === "quote" ? "quote" : "reply"}.`,
  });
}

/**
 * Fire-and-forget audit: the owner reassigned a job. Call AFTER the
 * reassignment transaction committed; only the committed winner calls this,
 * so retries can never write duplicate rows.
 */
export async function logJobReassigned(opts: {
  conv: ConversationRow;
  actorUserId: number;
  fromUserId: number | null;
  toUserId: number;
}): Promise<void> {
  const profile = await companyAnchor(opts.conv.traderProfileId);
  if (!profile) return;
  const [actorName, toName] = await Promise.all([
    displayNameOf(db, opts.actorUserId),
    displayNameOf(db, opts.toUserId),
  ]);
  const fromName =
    opts.fromUserId != null ? await displayNameOf(db, opts.fromUserId) : null;
  const ref = jobReferenceOf(opts.conv) ?? `#${opts.conv.id}`;
  await logAudit({
    userId: profile.userId,
    action: "JOB_REASSIGNED",
    performedBy: opts.actorUserId,
    details: {
      conversationId: opts.conv.id,
      enquiryId: opts.conv.enquiryId,
      traderProfileId: opts.conv.traderProfileId,
      fromUserId: opts.fromUserId,
      toUserId: opts.toUserId,
    },
    notes: `${actorName} reassigned job ${ref}${opts.conv.serviceRequired ? ` (${opts.conv.serviceRequired})` : ""} from ${fromName ?? "unassigned"} to ${toName} for ${profile.businessName}.`,
  });
}

/**
 * Fire-and-forget audit: one row per REMOVAL OPERATION (not per job) — the
 * removal endpoint's conditional ACTIVE→REVOKED flip guarantees the handover
 * runs at most once, so retries cannot duplicate this row.
 */
export async function logJobsHandedToOwner(opts: {
  traderProfileId: number;
  conversations: ConversationRow[];
  removedUserId: number;
  ownerUserId: number;
  actorUserId: number;
}): Promise<void> {
  if (opts.conversations.length === 0) return;
  const profile = await companyAnchor(opts.traderProfileId);
  if (!profile) return;
  const [ownerName, removedName] = await Promise.all([
    displayNameOf(db, opts.ownerUserId),
    displayNameOf(db, opts.removedUserId),
  ]);
  const count = opts.conversations.length;
  await logAudit({
    userId: profile.userId,
    action: "JOBS_HANDED_TO_OWNER_ON_MEMBER_REMOVAL",
    performedBy: opts.actorUserId,
    details: {
      traderProfileId: opts.traderProfileId,
      conversationIds: opts.conversations.map((c) => c.id),
      fromUserId: opts.removedUserId,
      toUserId: opts.ownerUserId,
    },
    notes: `${count === 1 ? "1 active job" : `${count} active jobs`} handed to ${ownerName} after ${removedName} was removed from ${profile.businessName}.`,
  });
}

/**
 * Fire-and-forget audit: a company quote was submitted (flag ON only, where
 * the acting member's identity matters). `summary` is a pre-formatted,
 * human-readable quote line (amount + price type).
 */
export async function logCompanyQuoteSubmitted(opts: {
  conv: ConversationRow;
  actorUserId: number;
  quoteId: number;
  summary: string;
}): Promise<void> {
  if (!companyTeamsEnabled()) return;
  const profile = await companyAnchor(opts.conv.traderProfileId);
  if (!profile) return;
  const actorName = await displayNameOf(db, opts.actorUserId);
  const ref = jobReferenceOf(opts.conv) ?? `#${opts.conv.id}`;
  await logAudit({
    userId: profile.userId,
    action: "QUOTE_SUBMITTED_BY_MEMBER",
    performedBy: opts.actorUserId,
    details: {
      conversationId: opts.conv.id,
      enquiryId: opts.conv.enquiryId,
      traderProfileId: opts.conv.traderProfileId,
      quoteId: opts.quoteId,
    },
    notes: `${actorName} submitted a quote (${opts.summary}) on job ${ref} for ${profile.businessName}.`,
  });
}
