import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import request from "supertest";

// In-memory object storage double. The real ObjectStorageService talks to
// GCS; these tests only need path→file semantics: getObjectEntityFile throws
// ObjectNotFoundError for unknown paths, delete marks a file gone,
// listEntityFiles enumerates a prefix.
const storageState = vi.hoisted(() => ({
  files: new Map<string, { deleted: boolean }>(), // key: "/objects/<entityId>"
  failPaths: new Set<string>(), // simulate backend errors for these paths
  failListings: false, // simulate a namespace-listing outage
}));

vi.mock("../lib/objectStorage", () => {
  class ObjectNotFoundError extends Error {
    constructor() {
      super("Object not found");
      this.name = "ObjectNotFoundError";
    }
  }
  class ObjectStorageService {
    async listEntityFiles(prefix: string): Promise<Array<{ entityId: string }>> {
      if (storageState.failListings) throw new Error("listing backend unavailable");
      const out: Array<{ entityId: string }> = [];
      for (const [path, f] of storageState.files) {
        if (f.deleted) continue;
        const entityId = path.replace(/^\/objects\//, "");
        if (entityId.startsWith(prefix)) out.push({ entityId });
      }
      return out;
    }
    async getObjectEntityFile(path: string): Promise<{ delete: (o?: unknown) => Promise<void> }> {
      if (storageState.failPaths.has(path)) throw new Error("storage backend unavailable");
      const f = storageState.files.get(path);
      if (!f || f.deleted) throw new ObjectNotFoundError();
      return {
        delete: async () => {
          f.deleted = true;
        },
      };
    }
  }
  return { ObjectNotFoundError, ObjectStorageService };
});

vi.mock("../lib/push-notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/push-notifications")>();
  return { ...actual, sendPushToUser: vi.fn(async () => true) };
});

import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  traderDocumentsTable,
  traderAuditLogTable,
  accountCleanupJobsTable,
} from "@workspace/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";
import {
  isValidCleanupPath,
  processAccountCleanupJob,
  sweepAccountCleanupJobs,
  ACCOUNT_CLEANUP_SWEEP_LOCK_KEY,
} from "../lib/account-cleanup";

/**
 * Account-deletion storage cleanup (WS2 hardening).
 *
 * Contract under test:
 *  - Admin anonymise enqueues a durable cleanup job capturing every storage
 *    reference (avatar, logo, gallery, verification documents) BEFORE the
 *    profile refs are wiped.
 *  - Paths are only ever deleted inside the owning user's own namespace;
 *    anything else is marked invalid and never touched.
 *  - Already-missing objects count as success (idempotent retries).
 *  - A job reaches DONE only when every path is terminal; backend failures
 *    leave it PARTIAL with lastError, and a later retry completes it.
 *  - The hourly sweep backfills jobs for terminally-deleted users that have
 *    none (retroactive cleanup via namespace listing).
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `acl-test+${label}-${SUFFIX}@example.test`;

const createdUserIds: number[] = [];

function seedFile(path: string): void {
  storageState.files.set(path, { deleted: false });
}
function fileGone(path: string): boolean {
  const f = storageState.files.get(path);
  return !f || f.deleted;
}

async function createUser(
  role: "trader" | "admin",
  label: string,
  extras?: Partial<typeof usersTable.$inferInsert>,
): Promise<number> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(`${role}-${label}`),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `ACL ${role} ${label}`,
      role,
      isActive: true,
      emailVerified: true,
      ...extras,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);
  return u.id;
}

async function createProfile(
  userId: number,
  label: string,
  extras?: Partial<typeof traderProfilesTable.$inferInsert>,
): Promise<number> {
  const [p] = await db
    .insert(traderProfilesTable)
    .values({
      userId,
      businessName: `ACL Trades ${label} ${SUFFIX}`,
      contactName: `Trader ${label}`,
      email: emailFor(`profile-${label}`),
      phone: "+447000000080",
      mainCategory: "plumbing",
      town: "London",
      postcode: "SW1A 1AA",
      isActive: false,
      businessProfileCompleted: true,
      verificationStatus: "VERIFIED",
      ...extras,
    })
    .returning({ id: traderProfilesTable.id });
  return p.id;
}

async function insertDocument(userId: number, objectPath: string): Promise<number> {
  const [d] = await db
    .insert(traderDocumentsTable)
    .values({
      userId,
      type: "ID_DOCUMENT",
      objectPath,
      originalFilename: "passport.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1234,
      status: "APPROVED",
    })
    .returning({ id: traderDocumentsTable.id });
  return d.id;
}

async function jobFor(userId: number) {
  const [job] = await db
    .select()
    .from(accountCleanupJobsTable)
    .where(eq(accountCleanupJobsTable.userId, userId))
    .limit(1);
  return job;
}

let adminToken: string;

beforeAll(async () => {
  const adminId = await createUser("admin", "ops");
  adminToken = generateToken(adminId, "admin");
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db
      .delete(accountCleanupJobsTable)
      .where(inArray(accountCleanupJobsTable.userId, createdUserIds));
    await db
      .delete(traderDocumentsTable)
      .where(inArray(traderDocumentsTable.userId, createdUserIds));
    await db
      .delete(traderAuditLogTable)
      .where(inArray(traderAuditLogTable.userId, createdUserIds));
    await db
      .delete(traderProfilesTable)
      .where(inArray(traderProfilesTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

describe("isValidCleanupPath — namespace containment", () => {
  it("accepts only paths inside the owner's own namespace for the category", () => {
    expect(isValidCleanupPath("/objects/customer-uploads/7/a.png", "avatar", 7)).toBe(true);
    expect(isValidCleanupPath("/objects/customer-uploads/7/a.png", "gallery", 7)).toBe(true);
    expect(
      isValidCleanupPath("/objects/trader-documents/7/doc.pdf", "verification-document", 7),
    ).toBe(true);
    // Another user's namespace — never.
    expect(isValidCleanupPath("/objects/customer-uploads/8/a.png", "avatar", 7)).toBe(false);
    // Prefix confusion: user 71 is not user 7.
    expect(isValidCleanupPath("/objects/customer-uploads/71/a.png", "avatar", 7)).toBe(false);
    // Category/namespace mismatch.
    expect(
      isValidCleanupPath("/objects/customer-uploads/7/doc.pdf", "verification-document", 7),
    ).toBe(false);
    // Traversal and non-object paths.
    expect(isValidCleanupPath("/objects/customer-uploads/7/../8/a.png", "avatar", 7)).toBe(false);
    expect(isValidCleanupPath("/etc/passwd", "avatar", 7)).toBe(false);
  });
});

describe("admin anonymise → cleanup job", () => {
  it("captures avatar, logo, gallery and documents into a job and deletes them", async () => {
    const userId = await createUser("trader", "full", {
      deletionStatus: "REQUESTED",
      deletionRequestedAt: new Date(),
      avatarUrl: undefined, // set below to the namespaced path
    });
    const avatar = `/objects/customer-uploads/${userId}/avatar.png`;
    const logo = `/objects/customer-uploads/${userId}/logo.png`;
    const gallery = `/objects/customer-uploads/${userId}/gallery-1.jpg`;
    const doc = `/objects/trader-documents/${userId}/passport.pdf`;
    await db.update(usersTable).set({ avatarUrl: avatar }).where(eq(usersTable.id, userId));
    await createProfile(userId, "full", { logoUrl: logo, galleryUrls: [gallery] });
    const docId = await insertDocument(userId, doc);
    for (const p of [avatar, logo, gallery, doc]) seedFile(p);

    const res = await request(app)
      .post(`/api/admin/account-deletions/${userId}/anonymise`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(200);

    // The job was enqueued in the same transaction with the full inventory
    // (the route also fires an immediate best-effort run; the sweep makes
    // completion deterministic for the test).
    const job = await jobFor(userId);
    expect(job).toBeTruthy();
    expect(job.enqueuedBy).toBe("anonymise");
    const paths = job.objects.map((o) => o.path).sort();
    expect(paths).toEqual([avatar, logo, gallery, doc].sort());

    await sweepAccountCleanupJobs();

    const after = await jobFor(userId);
    expect(after.status).toBe("DONE");
    expect(after.completedAt).not.toBeNull();
    for (const p of [avatar, logo, gallery, doc]) expect(fileGone(p)).toBe(true);

    // Verification-document DB rows are purged once their files are gone.
    const docs = await db
      .select({ id: traderDocumentsTable.id })
      .from(traderDocumentsTable)
      .where(eq(traderDocumentsTable.id, docId));
    expect(docs).toHaveLength(0);
  });
});

describe("processAccountCleanupJob — safety and retry semantics", () => {
  it("treats already-missing objects as success and refuses foreign paths permanently", async () => {
    const userId = await createUser("trader", "mixed", { deletionStatus: "ANONYMISED" });
    const missing = `/objects/customer-uploads/${userId}/already-gone.png`;
    const foreign = `/objects/customer-uploads/999999999/stolen.png`;
    // NOT seeding `missing`; seeding the foreign file to prove it survives.
    seedFile(foreign);

    const [job] = await db
      .insert(accountCleanupJobsTable)
      .values({
        userId,
        status: "PENDING",
        enqueuedBy: "anonymise",
        objects: [
          { path: missing, category: "avatar", state: "pending" },
          { path: foreign, category: "gallery", state: "pending" },
        ],
      })
      .returning();

    const result = await processAccountCleanupJob(job);
    expect(result.status).toBe("DONE"); // both paths terminal: missing + invalid

    const after = await jobFor(userId);
    const byPath = Object.fromEntries(after.objects.map((o) => [o.path, o.state]));
    expect(byPath[missing]).toBe("missing");
    expect(byPath[foreign]).toBe("invalid");
    // The foreign object was never deleted.
    expect(fileGone(foreign)).toBe(false);
  });

  it("stays PARTIAL on backend failure and completes on a later retry", async () => {
    const userId = await createUser("trader", "retry", { deletionStatus: "ANONYMISED" });
    const flaky = `/objects/customer-uploads/${userId}/flaky.png`;
    seedFile(flaky);
    storageState.failPaths.add(flaky);

    const [job] = await db
      .insert(accountCleanupJobsTable)
      .values({
        userId,
        status: "PENDING",
        enqueuedBy: "complete",
        objects: [{ path: flaky, category: "customer-upload", state: "pending" }],
      })
      .returning();

    const first = await processAccountCleanupJob(job);
    expect(first.status).toBe("PARTIAL");
    let row = await jobFor(userId);
    expect(row.status).toBe("PARTIAL");
    expect(row.lastError).toContain("storage backend unavailable");
    expect(row.completedAt).toBeNull();
    expect(fileGone(flaky)).toBe(false);

    // Backend recovers → the sweep retry finishes the job.
    storageState.failPaths.delete(flaky);
    await sweepAccountCleanupJobs();
    row = await jobFor(userId);
    expect(row.status).toBe("DONE");
    expect(fileGone(flaky)).toBe(true);
  });

  it("never reports DONE while the namespace listing is failing (incomplete inventory)", async () => {
    const userId = await createUser("trader", "listfail", { deletionStatus: "ANONYMISED" });
    // An unreferenced object only discoverable via the namespace listing.
    const stray = `/objects/customer-uploads/${userId}/unreferenced.jpg`;
    seedFile(stray);

    const [job] = await db
      .insert(accountCleanupJobsTable)
      .values({
        userId,
        status: "PENDING",
        enqueuedBy: "complete",
        objects: [], // empty recorded inventory — everything depends on listing
      })
      .returning();

    storageState.failListings = true;
    try {
      const first = await processAccountCleanupJob(job);
      // Even with zero known objects, a failed listing means the inventory
      // is incomplete — the job must stay PARTIAL, not lie DONE.
      expect(first.status).toBe("PARTIAL");
      const row = await jobFor(userId);
      expect(row.status).toBe("PARTIAL");
      expect(row.lastError).toContain("listing");
      expect(row.completedAt).toBeNull();
      expect(fileGone(stray)).toBe(false);
    } finally {
      storageState.failListings = false;
    }

    // Listing recovers → retry discovers and removes the stray object.
    await sweepAccountCleanupJobs();
    const after = await jobFor(userId);
    expect(after.status).toBe("DONE");
    expect(fileGone(stray)).toBe(true);
  });

  it("sweep is single-flight: skips while another instance holds the advisory lock", async () => {
    // Simulate a concurrent autoscale instance by holding the xact-level
    // advisory lock on one pooled connection while the sweep runs on another.
    await db.transaction(async (holder) => {
      await holder.execute(sql`SELECT pg_advisory_xact_lock(${ACCOUNT_CLEANUP_SWEEP_LOCK_KEY})`);
      const result = await sweepAccountCleanupJobs();
      expect(result.skipped).toBe(true);
      expect(result.processed).toBe(0);
      expect(result.backfilled).toBe(0);
    });
    // Lock released with the holder transaction → the sweep runs normally.
    const after = await sweepAccountCleanupJobs();
    expect(after.skipped).toBe(false);
  });
});

describe("sweepAccountCleanupJobs — retroactive backfill", () => {
  it("backfills a job for a terminally-deleted user with no job and cleans the namespace", async () => {
    const userId = await createUser("trader", "orphan", { deletionStatus: "COMPLETED" });
    // No DB references left (the old finalisation wiped them) — only the
    // namespace listing can find this file.
    const stray = `/objects/customer-uploads/${userId}/stray-upload.jpg`;
    seedFile(stray);

    const summary = await sweepAccountCleanupJobs();
    expect(summary.backfilled).toBeGreaterThanOrEqual(1);

    const job = await jobFor(userId);
    expect(job).toBeTruthy();
    expect(job.enqueuedBy).toBe("orphan-sweep");
    expect(job.status).toBe("DONE");
    expect(fileGone(stray)).toBe(true);
  });
});
