import { db } from "@workspace/db";
import {
  accountCleanupJobsTable,
  traderDocumentsTable,
  traderProfilesTable,
  usersTable,
  type AccountCleanupJob,
  type AccountCleanupObject,
} from "@workspace/db/schema";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { ObjectNotFoundError, ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";

// --- Account-deletion storage cleanup (GDPR finalisation) ---
//
// Terminal deletion (admin anonymise / complete) wipes DB references to a
// user's files, but the object-storage files themselves used to be retained
// forever. This module closes that gap:
//
//   1. enqueueAccountCleanup — called INSIDE the finalisation transaction,
//      AFTER the guarded state flip (winner-only), while trader_documents
//      rows and trader-profile refs are still readable. Captures a per-path
//      inventory into a durable account_cleanup_jobs row.
//   2. processAccountCleanupJob — performs the storage deletions. Runs
//      immediately post-commit (best-effort) and from the hourly scheduler
//      sweep until every path is terminal. Also lists the user's
//      customer-uploads/<id>/ and trader-documents/<id>/ namespaces at
//      processing time, so objects whose DB references were already cleared
//      (e.g. avatar nulled by anonymise) are still removed.
//   3. sweepAccountCleanupJobs — hourly: retries non-DONE jobs and backfills
//      jobs for users already in a terminal deletion state from before this
//      module existed (retroactive cleanup).
//
// Safety rules:
//   - Every path is validated against the owning user's own namespace before
//     any storage call; anything else is marked `invalid` and never deleted.
//     Prefix listings are built from the validated user id, never from
//     stored strings, so a corrupted reference cannot fan out.
//   - An already-missing object counts as success (idempotent under retries
//     and under the concurrent immediate-attempt/sweep race, where the loser
//     just sees 404s).
//   - trader_documents rows are deleted only after their object reached a
//     terminal success state (deleted/missing) — verification documents are
//     purged at finalisation per the retention schedule.
//   - The job only reaches DONE when all paths are terminal; partial
//     progress stays PARTIAL with lastError recorded. DONE is never claimed
//     early.

type TxExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

const TERMINAL_DELETION_STATUSES = ["ANONYMISED", "COMPLETED"] as const;

function customerUploadsPrefix(userId: number): string {
  return `/objects/customer-uploads/${userId}/`;
}
function traderDocumentsPrefix(userId: number): string {
  return `/objects/trader-documents/${userId}/`;
}

/** True when the path lies inside the deleted user's own namespace for the
 * given category. Validation failure means the path is never touched. */
export function isValidCleanupPath(
  path: string,
  category: AccountCleanupObject["category"],
  userId: number,
): boolean {
  if (typeof path !== "string" || !path.startsWith("/objects/")) return false;
  if (path.includes("..")) return false;
  if (category === "verification-document") {
    return path.startsWith(traderDocumentsPrefix(userId));
  }
  return path.startsWith(customerUploadsPrefix(userId));
}

/**
 * Inventory the user's referenced storage objects. Call INSIDE the
 * finalisation transaction after the guarded flip but BEFORE trader-profile
 * refs are overwritten (users.avatarUrl is passed in by the caller, which
 * read the row before its UPDATE ran).
 */
export async function collectUserObjectPaths(
  tx: TxExecutor,
  userId: number,
  opts: { avatarUrl?: string | null },
): Promise<AccountCleanupObject[]> {
  const objects: AccountCleanupObject[] = [];
  const push = (path: string | null | undefined, category: AccountCleanupObject["category"]) => {
    if (!path || typeof path !== "string") return;
    if (objects.some((o) => o.path === path)) return;
    objects.push({ path, category, state: "pending" });
  };

  push(opts.avatarUrl, "avatar");

  const [profile] = await tx
    .select({
      logoUrl: traderProfilesTable.logoUrl,
      galleryUrls: traderProfilesTable.galleryUrls,
    })
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.userId, userId))
    .limit(1);
  if (profile) {
    push(profile.logoUrl, "logo");
    for (const url of profile.galleryUrls ?? []) push(url, "gallery");
  }

  const docs = await tx
    .select({ objectPath: traderDocumentsTable.objectPath })
    .from(traderDocumentsTable)
    .where(eq(traderDocumentsTable.userId, userId));
  for (const doc of docs) push(doc.objectPath, "verification-document");

  return objects;
}

/**
 * Upsert the durable cleanup job (one per user). Existing jobs merge in any
 * new paths and reopen (DONE → PENDING) so a later finalisation step (e.g.
 * complete after anonymise) can add work. Winner-only: call strictly after
 * the guarded lifecycle UPDATE inside the same transaction.
 */
export async function enqueueAccountCleanup(
  tx: TxExecutor,
  opts: { userId: number; enqueuedBy: "anonymise" | "complete" | "orphan-sweep"; avatarUrl?: string | null },
): Promise<void> {
  const { userId, enqueuedBy } = opts;
  const objects = await collectUserObjectPaths(tx, userId, { avatarUrl: opts.avatarUrl });

  const [existing] = await tx
    .select()
    .from(accountCleanupJobsTable)
    .where(eq(accountCleanupJobsTable.userId, userId))
    .limit(1);

  const now = new Date();
  if (!existing) {
    await tx
      .insert(accountCleanupJobsTable)
      .values({ userId, status: "PENDING", objects, enqueuedBy, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: accountCleanupJobsTable.userId });
    return;
  }
  const known = new Set(existing.objects.map((o) => o.path));
  const merged = [...existing.objects, ...objects.filter((o) => !known.has(o.path))];
  await tx
    .update(accountCleanupJobsTable)
    .set({ objects: merged, status: "PENDING", completedAt: null, updatedAt: now })
    .where(eq(accountCleanupJobsTable.id, existing.id));
}

/** Terminal per-object states — nothing left to do for these. */
function isTerminal(state: AccountCleanupObject["state"]): boolean {
  return state === "deleted" || state === "missing" || state === "invalid";
}

/**
 * Execute the storage deletions for one job. Idempotent; safe under
 * concurrent invocation (double deletes degrade to 404 = missing).
 */
export async function processAccountCleanupJob(
  job: Pick<AccountCleanupJob, "id" | "userId" | "objects">,
): Promise<{ status: "DONE" | "PARTIAL"; deleted: number; failed: number }> {
  const storage = new ObjectStorageService();
  const { userId } = job;
  const now = new Date();

  // Start from the recorded inventory, then extend with a live listing of
  // the user's own namespaces — this catches objects whose DB references
  // were cleared before enqueue existed (retroactive jobs) and finalised
  // uploads that were never referenced. The prefixes are derived from the
  // job's user id only.
  const objects: AccountCleanupObject[] = job.objects.map((o) => ({ ...o }));
  const known = new Set(objects.map((o) => o.path));
  let listingFailed = false;
  let listingError: string | null = null;
  for (const prefix of [`customer-uploads/${userId}/`, `trader-documents/${userId}/`]) {
    try {
      const listed = await storage.listEntityFiles(prefix);
      for (const { entityId } of listed) {
        const path = `/objects/${entityId}`;
        if (known.has(path)) continue;
        known.add(path);
        objects.push({
          path,
          category: prefix.startsWith("trader-documents")
            ? "verification-document"
            : "customer-upload",
          state: "pending",
        });
      }
    } catch (err) {
      // A failed listing means the namespace inventory is INCOMPLETE for
      // this run — unreferenced/retroactive objects may exist that we never
      // saw. The job must not be marked DONE on such a run, or a transient
      // listing outage silently strands those objects forever.
      listingFailed = true;
      listingError = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
      logger.warn({ err, userId, prefix }, "Account cleanup: namespace listing failed");
    }
  }

  let deleted = 0;
  let failed = 0;
  let lastError: string | null = null;

  for (const obj of objects) {
    if (isTerminal(obj.state)) continue;
    if (!isValidCleanupPath(obj.path, obj.category, userId)) {
      obj.state = "invalid";
      obj.error = "outside owner namespace";
      logger.error(
        { userId, category: obj.category, integrity: "account_cleanup_invalid_path" },
        "Account cleanup: path failed namespace validation — skipped permanently",
      );
      continue;
    }
    try {
      const file = await storage.getObjectEntityFile(obj.path);
      await file.delete({ ignoreNotFound: true });
      obj.state = "deleted";
      delete obj.error;
      deleted += 1;
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        obj.state = "missing"; // already gone — success
        delete obj.error;
        continue;
      }
      obj.state = "error";
      obj.error = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
      lastError = obj.error;
      failed += 1;
    }
  }

  // Verification-document rows are purged once their objects are gone —
  // retention of the audit trail lives in trader_audit_log, not in the
  // document rows/files themselves.
  const purgedDocPaths = objects
    .filter((o) => o.category === "verification-document" && (o.state === "deleted" || o.state === "missing"))
    .map((o) => o.path);
  if (purgedDocPaths.length > 0) {
    await db
      .delete(traderDocumentsTable)
      .where(
        and(
          eq(traderDocumentsTable.userId, userId),
          inArray(traderDocumentsTable.objectPath, purgedDocPaths),
        ),
      );
  }

  // DONE requires BOTH: every known object terminal AND a complete namespace
  // inventory this run (no failed listings) — otherwise stay PARTIAL so the
  // hourly sweep retries with a working listing.
  const complete = objects.every((o) => isTerminal(o.state)) && !listingFailed;
  const status = complete ? "DONE" : "PARTIAL";
  await db
    .update(accountCleanupJobsTable)
    .set({
      status,
      objects,
      attempts: sql`${accountCleanupJobsTable.attempts} + 1`,
      lastAttemptAt: now,
      lastError: lastError ?? (listingFailed ? `namespace listing failed: ${listingError}` : null),
      completedAt: complete ? now : null,
      updatedAt: now,
    })
    .where(eq(accountCleanupJobsTable.id, job.id));

  return { status, deleted, failed };
}

/** Best-effort immediate attempt right after finalisation commits. Failures
 * are absorbed — the hourly sweep is the durable guarantee. */
export async function runAccountCleanupNow(userId: number): Promise<void> {
  const [job] = await db
    .select()
    .from(accountCleanupJobsTable)
    .where(and(eq(accountCleanupJobsTable.userId, userId), ne(accountCleanupJobsTable.status, "DONE")))
    .limit(1);
  if (!job) return;
  const result = await processAccountCleanupJob(job);
  logger.info({ userId, ...result }, "Account cleanup (immediate)");
}

/**
 * Hourly sweep: (a) backfill jobs for users whose deletion was finalised
 * before storage cleanup existed (or whose enqueue was lost), then
 * (b) process every non-DONE job.
 */
/**
 * Advisory-lock key for the cleanup sweep. The deployment target is
 * autoscale, so several API instances can run the hourly scheduler at once;
 * the transaction-level lock makes the sweep single-flight cluster-wide
 * (the storage deletions are idempotent anyway — this avoids duplicate work
 * and interleaved attempt counting, not corruption). Auto-released on
 * commit/rollback, so a crashed holder can never wedge future sweeps.
 */
export const ACCOUNT_CLEANUP_SWEEP_LOCK_KEY = 727465301;

export async function sweepAccountCleanupJobs(): Promise<{
  skipped: boolean;
  backfilled: number;
  processed: number;
  done: number;
  failed: number;
}> {
  return await db.transaction(async (lockTx) => {
    const lockRes = await lockTx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${ACCOUNT_CLEANUP_SWEEP_LOCK_KEY}) AS locked`,
    );
    if (lockRes.rows[0]?.["locked"] !== true) {
      logger.info("Account cleanup sweep: another instance holds the lock — skipping");
      return { skipped: true, backfilled: 0, processed: 0, done: 0, failed: 0 };
    }
    const result = await runAccountCleanupSweep();
    return { skipped: false, ...result };
  });
}

async function runAccountCleanupSweep(): Promise<{
  backfilled: number;
  processed: number;
  done: number;
  failed: number;
}> {
  // (a) Orphan backfill — terminal deletion state, no cleanup job row.
  const orphans = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .leftJoin(accountCleanupJobsTable, eq(accountCleanupJobsTable.userId, usersTable.id))
    .where(
      and(
        inArray(usersTable.deletionStatus, [...TERMINAL_DELETION_STATUSES]),
        isNull(accountCleanupJobsTable.id),
      ),
    );
  let backfilled = 0;
  for (const { id } of orphans) {
    // The refs anonymise clears are long gone for retroactive rows; the
    // namespace listing in the processor is what actually finds the files.
    await db.transaction(async (tx) => {
      await enqueueAccountCleanup(tx, { userId: id, enqueuedBy: "orphan-sweep" });
    });
    backfilled += 1;
  }

  // (b) Retry every non-DONE job.
  const pending = await db
    .select()
    .from(accountCleanupJobsTable)
    .where(ne(accountCleanupJobsTable.status, "DONE"));
  let processed = 0;
  let done = 0;
  let failed = 0;
  for (const job of pending) {
    try {
      const result = await processAccountCleanupJob(job);
      processed += 1;
      if (result.status === "DONE") done += 1;
      failed += result.failed;
    } catch (err) {
      logger.error({ err, userId: job.userId }, "Account cleanup job failed");
      failed += 1;
    }
  }
  return { backfilled, processed, done, failed };
}
