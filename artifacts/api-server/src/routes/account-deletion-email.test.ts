import { describe, it, beforeEach, afterAll, expect, vi, type Mock } from "vitest";
import request from "supertest";

// Mock the outbound email module BEFORE importing anything that pulls it in.
// These tests guard the ORDERING invariant of the deletion confirmation
// email: the real address must be captured before the row is rewritten to
// the `.invalid` placeholder, and no email may ever be sent to a placeholder.
vi.mock("../lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/email")>();
  return {
    ...actual,
    sendAccountDeletionCompletedEmail: vi.fn(async () => {}),
  };
});

import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";
import * as emailModule from "../lib/email";

const sendMock = emailModule.sendAccountDeletionCompletedEmail as Mock;

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) =>
  `deletion-email-test+${label}-${SUFFIX}@example.test`;

const createdUserIds: number[] = [];

async function createAdmin(): Promise<string> {
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: emailFor("admin"),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: "Deletion Test Admin",
      role: "admin",
      isActive: true,
      emailVerified: true,
    })
    .returning({ id: usersTable.id, tokenVersion: usersTable.tokenVersion });
  createdUserIds.push(admin.id);
  return generateToken(admin.id, "admin", admin.tokenVersion);
}

async function createDeletionUser(
  label: string,
  overrides: Partial<{
    email: string;
    deletionStatus: "REQUESTED" | "DISABLED_PENDING_RETENTION" | "ANONYMISED";
  }> = {},
): Promise<{ id: number; email: string }> {
  const email = overrides.email ?? emailFor(label);
  const [u] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `Deletion Test ${label}`,
      role: "customer",
      isActive: false,
      emailVerified: true,
      deletionStatus: overrides.deletionStatus ?? "REQUESTED",
      deletionRequestedAt: new Date(),
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);
  return { id: u.id, email };
}

let adminToken: string;

beforeEach(async () => {
  sendMock.mockClear();
  if (!adminToken) adminToken = await createAdmin();
});

afterAll(async () => {
  if (createdUserIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

async function post(path: string) {
  return request(app)
    .post(path)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({});
}

describe("Deletion confirmation email — complete route", () => {
  it("sends exactly one email to the pre-release address", async () => {
    const user = await createDeletionUser("complete");

    const res = await post(`/api/admin/account-deletions/${user.id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.deletionStatus).toBe("COMPLETED");

    // Row was rewritten to the released placeholder...
    const [row] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, user.id));
    expect(row.email).toBe(
      `deleted-user-${user.id}@deleted.mylocaltrade.invalid`,
    );

    // ...but the email went to the REAL address captured beforehand.
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].toEmail).toBe(user.email);
    expect(sendMock.mock.calls[0][0].toEmail).not.toContain(".invalid");
  });

  it("never sends when the stored address is already a placeholder", async () => {
    const user = await createDeletionUser("complete-placeholder", {
      deletionStatus: "ANONYMISED",
    });
    // Simulate a row anonymised earlier: address is already a placeholder.
    const placeholder = `deleted-user-${user.id}@deleted.mylocaltrade.invalid`;
    await db
      .update(usersTable)
      .set({ email: placeholder })
      .where(eq(usersTable.id, user.id));

    const res = await post(`/api/admin/account-deletions/${user.id}/complete`);
    expect(res.status).toBe(200);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("Deletion confirmation email — anonymise route", () => {
  it("sends exactly one email to the pre-wipe address", async () => {
    const user = await createDeletionUser("anonymise");

    const res = await post(`/api/admin/account-deletions/${user.id}/anonymise`);
    expect(res.status).toBe(200);
    expect(res.body.deletionStatus).toBe("ANONYMISED");

    const [row] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, user.id));
    expect(row.email).toBe(
      `deleted-user-${user.id}@deleted.mylocaltrade.invalid`,
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].toEmail).toBe(user.email);
    expect(sendMock.mock.calls[0][0].toEmail).not.toContain(".invalid");
  });

  it("anonymise then complete sends only one email in total", async () => {
    const user = await createDeletionUser("anon-then-complete");

    const anonRes = await post(
      `/api/admin/account-deletions/${user.id}/anonymise`,
    );
    expect(anonRes.status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].toEmail).toBe(user.email);

    const completeRes = await post(
      `/api/admin/account-deletions/${user.id}/complete`,
    );
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.deletionStatus).toBe("COMPLETED");

    // No second send: the row only holds a placeholder by now.
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("never sends when the stored address is already a placeholder", async () => {
    const user = await createDeletionUser("anon-placeholder", {
      email: `deleted-user-preexisting-${SUFFIX}@something.invalid`,
    });

    const res = await post(`/api/admin/account-deletions/${user.id}/anonymise`);
    expect(res.status).toBe(200);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
