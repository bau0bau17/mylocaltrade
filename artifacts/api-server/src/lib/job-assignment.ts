import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  conversationsTable,
  traderProfilesTable,
  usersTable,
} from "@workspace/db/schema";
import { companyTeamsEnabled } from "./company-membership";
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
 * Claim the conversation for `userId`, or verify they already hold it.
 *
 * MUST be called INSIDE the same transaction as the customer-facing write
 * (message insert / quote insert) and BEFORE it, so that a losing racer's
 * write is rolled back and never becomes visible to the customer.
 *
 * Concurrency: the conditional UPDATE takes the row lock; a concurrent
 * claimer blocks until the winner commits, then re-evaluates the
 * `assigned IS NULL` predicate against the committed row (READ COMMITTED
 * follow-update semantics), matches zero rows, and this throws — rolling the
 * loser's transaction back. Exactly one member can ever win.
 */
export async function claimOrRequireAssigned(
  tx: Executor,
  conv: ConversationRow,
  userId: number,
): Promise<{ claimedNow: boolean }> {
  if (!companyTeamsEnabled()) return { claimedNow: false };
  if (conv.assignedTraderUserId === userId) return { claimedNow: false };
  if (conv.assignedTraderUserId != null) {
    throw new JobClaimedByOtherError(
      conv.assignedTraderUserId,
      await displayNameOf(tx, conv.assignedTraderUserId),
    );
  }
  const updated = await tx
    .update(conversationsTable)
    .set({ assignedTraderUserId: userId, assignedAt: new Date() })
    .where(
      and(
        eq(conversationsTable.id, conv.id),
        isNull(conversationsTable.assignedTraderUserId),
      ),
    )
    .returning({ id: conversationsTable.id });
  if (updated.length > 0) return { claimedNow: true };

  // Lost the race: someone else committed a claim between our read and our
  // UPDATE. Re-read the winner for the error message.
  const [current] = await tx
    .select({ assigned: conversationsTable.assignedTraderUserId })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conv.id))
    .limit(1);
  if (current?.assigned === userId) return { claimedNow: false };
  const winner = current?.assigned ?? null;
  throw new JobClaimedByOtherError(
    winner,
    winner != null ? await displayNameOf(tx, winner) : "a team member",
  );
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
