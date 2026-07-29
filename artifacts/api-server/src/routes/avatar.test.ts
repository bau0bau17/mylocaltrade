import { describe, it, beforeAll, afterAll, afterEach, expect, vi } from "vitest";
import { Readable } from "stream";
import request from "supertest";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  conversationsTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";
import { ObjectStorageService } from "../lib/objectStorage";

/**
 * Phase 1A personal profile photo (users.avatar_url) tests.
 *
 * Covers:
 *  - PATCH /auth/me/avatar is trader-only and validates ownership of the
 *    object path (a path under another user's customer-uploads prefix is
 *    rejected before any storage call).
 *  - Removing the avatar (objectPath: null) clears it.
 *  - /auth/me exposes avatarUrl.
 *  - GET /customer/uploads/avatar-file authorisation: owner OK,
 *    conversation counterpart OK, stranger 404, unauthenticated 401.
 *  - Streaming end-to-end: with ObjectStorageService.getObjectEntityFile
 *    mocked to return a File-like object, authorised callers get a 200 with
 *    the exact image bytes and content type, while a stranger still gets a
 *    404 BEFORE any storage access (the mock is never called).
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `avatar-test+${label}-${SUFFIX}@example.test`;

const createdUserIds: number[] = [];
const createdProfileIds: number[] = [];
const createdConversationIds: number[] = [];

async function createUser(role: "customer" | "trader", label: string): Promise<number> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(`${role}-${label}`),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `Avatar ${role} ${label}`,
      role,
      isActive: true,
      emailVerified: true,
      phone: "+447000000001",
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);
  return u.id;
}

let traderUserId: number;
let traderToken: string;
let customerId: number;
let customerToken: string;
let strangerId: number;
let strangerToken: string;

beforeAll(async () => {
  traderUserId = await createUser("trader", "main");
  customerId = await createUser("customer", "main");
  strangerId = await createUser("customer", "stranger");
  traderToken = generateToken(traderUserId, "trader");
  customerToken = generateToken(customerId, "customer");
  strangerToken = generateToken(strangerId, "customer");

  const [p] = await db
    .insert(traderProfilesTable)
    .values({
      userId: traderUserId,
      businessName: `Avatar Trades ${SUFFIX}`,
      contactName: "Avatar Trader",
      email: emailFor("profile"),
      phone: "+447000000000",
      mainCategory: "plumbing",
      town: "London",
      postcode: "SW1A 1AA",
      isActive: true,
      businessProfileCompleted: true,
      verificationStatus: "VERIFIED",
    })
    .returning({ id: traderProfilesTable.id });
  createdProfileIds.push(p.id);

  const [conv] = await db
    .insert(conversationsTable)
    .values({
      customerId,
      traderUserId,
      traderProfileId: p.id,
      status: "AWAITING_TRADER_REPLY",
    })
    .returning({ id: conversationsTable.id });
  createdConversationIds.push(conv.id);
});

afterAll(async () => {
  if (createdConversationIds.length) {
    await db.delete(conversationsTable).where(inArray(conversationsTable.id, createdConversationIds));
  }
  if (createdProfileIds.length) {
    await db.delete(traderProfilesTable).where(inArray(traderProfilesTable.id, createdProfileIds));
  }
  if (createdUserIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

describe("PATCH /auth/me/avatar", () => {
  it("rejects customers (trader-only in Phase 1A)", async () => {
    const res = await request(app)
      .patch("/api/auth/me/avatar")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ objectPath: `/objects/customer-uploads/${customerId}/v/x` });
    expect(res.status).toBe(403);
  });

  it("rejects an object path under ANOTHER user's uploads prefix", async () => {
    const res = await request(app)
      .patch("/api/auth/me/avatar")
      .set("Authorization", `Bearer ${traderToken}`)
      .send({ objectPath: `/objects/customer-uploads/${customerId}/v/steal` });
    expect(res.status).toBe(400);
    const [row] = await db
      .select({ avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(eq(usersTable.id, traderUserId));
    expect(row.avatarUrl).toBeNull();
  });

  it("clears the avatar with objectPath null and reflects it in /auth/me", async () => {
    // Seed a value directly (storage verification requires a real object,
    // out of scope for API tests), then remove it through the API.
    const seeded = `/objects/customer-uploads/${traderUserId}/v/seeded-${SUFFIX}`;
    await db.update(usersTable).set({ avatarUrl: seeded }).where(eq(usersTable.id, traderUserId));

    const me1 = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${traderToken}`);
    expect(me1.status).toBe(200);
    expect(me1.body.avatarUrl).toBe(seeded);

    const res = await request(app)
      .patch("/api/auth/me/avatar")
      .set("Authorization", `Bearer ${traderToken}`)
      .send({ objectPath: null });
    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBeNull();

    const me2 = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${traderToken}`);
    expect(me2.body.avatarUrl).toBeNull();
  });
});

describe("GET /customer/uploads/avatar-file", () => {
  const path = () => `/objects/customer-uploads/${traderUserId}/v/avatar-${SUFFIX}`;

  beforeAll(async () => {
    await db.update(usersTable).set({ avatarUrl: path() }).where(eq(usersTable.id, traderUserId));
  });

  it("requires authentication", async () => {
    const res = await request(app).get(
      `/api/customer/uploads/avatar-file?path=${encodeURIComponent(path())}`,
    );
    expect(res.status).toBe(401);
  });

  it("denies a user with no shared conversation (404, before storage)", async () => {
    const res = await request(app)
      .get(`/api/customer/uploads/avatar-file?path=${encodeURIComponent(path())}`)
      .set("Authorization", `Bearer ${strangerToken}`);
    expect(res.status).toBe(404);
  });

  it("lets the owner and the conversation counterpart past the membership gate", async () => {
    // No real object exists in storage for this path, so an authorised caller
    // reaches the storage lookup and gets its 404/500 — the point is they are
    // NOT rejected by the membership gate itself. A denied caller never
    // reaches storage (previous test). Here we simply assert both authorised
    // callers get a storage-stage response, not a 401/403.
    for (const token of [traderToken, customerToken]) {
      const res = await request(app)
        .get(`/api/customer/uploads/avatar-file?path=${encodeURIComponent(path())}`)
        .set("Authorization", `Bearer ${token}`);
      expect([200, 404, 500]).toContain(res.status);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    }
  });

  describe("with a (mocked) real stored object", () => {
    const FAKE_BYTES = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    ]); // JPEG magic-number prefix + filler

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("streams 200 + image bytes to the owner and the conversation counterpart", async () => {
      // Mock ONLY the storage lookup: the route's normalisation, live-avatar
      // lookup and membership gate all run for real against the DB. The mock
      // returns a File-like object so the actual streaming code path
      // (metadata headers + createReadStream pipe) is exercised end-to-end.
      const spy = vi
        .spyOn(ObjectStorageService.prototype, "getObjectEntityFile")
        .mockImplementation(async (objectPath: string) => {
          expect(objectPath).toBe(path());
          return {
            getMetadata: async () => [
              { contentType: "image/jpeg", size: FAKE_BYTES.length },
            ],
            createReadStream: () => Readable.from([FAKE_BYTES]),
          } as never;
        });

      for (const token of [traderToken, customerToken]) {
        const res = await request(app)
          .get(`/api/customer/uploads/avatar-file?path=${encodeURIComponent(path())}`)
          .set("Authorization", `Bearer ${token}`)
          .buffer(true)
          .parse((r, cb) => {
            const chunks: Buffer[] = [];
            r.on("data", (c) => chunks.push(c));
            r.on("end", () => cb(null, Buffer.concat(chunks)));
          });
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("image/jpeg");
        expect(res.headers["cache-control"]).toContain("private");
        expect(Buffer.compare(res.body as Buffer, FAKE_BYTES)).toBe(0);
      }

      // Storage was reached exactly once per authorised caller.
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it("still 404s a stranger before any storage access, even when the object exists", async () => {
      const spy = vi
        .spyOn(ObjectStorageService.prototype, "getObjectEntityFile")
        .mockResolvedValue({
          getMetadata: async () => [{ contentType: "image/jpeg" }],
          createReadStream: () => Readable.from([FAKE_BYTES]),
        } as never);

      const res = await request(app)
        .get(`/api/customer/uploads/avatar-file?path=${encodeURIComponent(path())}`)
        .set("Authorization", `Bearer ${strangerToken}`);
      expect(res.status).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it("stops serving a removed avatar (path no longer live)", async () => {
    await db.update(usersTable).set({ avatarUrl: null }).where(eq(usersTable.id, traderUserId));
    const res = await request(app)
      .get(`/api/customer/uploads/avatar-file?path=${encodeURIComponent(path())}`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(404);
  });
});
