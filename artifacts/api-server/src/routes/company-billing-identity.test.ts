import { describe, it, beforeAll, afterAll, afterEach, expect, vi } from "vitest";
import { Readable } from "stream";
import request from "supertest";
import { db } from "@workspace/db";
import {
  usersTable,
  traderProfilesTable,
  companyMembersTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { generateToken } from "../lib/auth";
import { ObjectStorageService } from "../lib/objectStorage";

/**
 * Company Teams — Phase A billing/identity corrections.
 *
 * Contract under test:
 *
 *  1. subscriptionsOwnerGate: EVERY subscription route (status, demo-activate,
 *     revenuecat-sync, cancel, resume, cancellation-request) answers
 *     403 OWNER_ONLY for any caller who owns no trader profile but has ANY
 *     company_members row — ACTIVE or REVOKED, feature flag on or off.
 *     Owners, legacy solo traders and customers keep legacy behaviour;
 *     GET /subscriptions/plans stays public.
 *
 *  2. Avatar identity isolation: two users of the SAME company set/clear
 *     their personal photos fully independently (users.avatar_url is strictly
 *     per-user; cross-prefix writes are rejected).
 *
 *  3. avatar-file serving: colleagues (owner ↔ ACTIVE employee of the same
 *     company) may load each other's headshots WITHOUT a shared conversation;
 *     REVOKED members and unrelated traders still get 404 before any storage
 *     access. Works with the feature flag OFF (flag-independent serving).
 *
 *  4. GET /company/team exposes each member's own avatarUrl + status.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const emailFor = (label: string) => `phase-a+${label}-${SUFFIX}@example.test`;

const createdUserIds: number[] = [];
const createdProfileIds: number[] = [];

const EXTERNAL_FLAG = process.env["COMPANY_TEAMS_ENABLED"];
function setFlag(on: boolean): void {
  if (on) process.env["COMPANY_TEAMS_ENABLED"] = "true";
  else delete process.env["COMPANY_TEAMS_ENABLED"];
}
function restoreFlag(): void {
  if (EXTERNAL_FLAG === undefined) delete process.env["COMPANY_TEAMS_ENABLED"];
  else process.env["COMPANY_TEAMS_ENABLED"] = EXTERNAL_FLAG;
}

async function createUser(role: "customer" | "trader", label: string): Promise<number> {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: emailFor(`${role}-${label}`),
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `PhaseA ${role} ${label}`,
      role,
      isActive: true,
      emailVerified: true,
      phone: "+447000000031",
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);
  return u.id;
}

async function createProfile(userId: number, label: string): Promise<number> {
  const [p] = await db
    .insert(traderProfilesTable)
    .values({
      userId,
      businessName: `PhaseA Trades ${label} ${SUFFIX}`,
      contactName: `Trader ${label}`,
      email: emailFor(`profile-${label}`),
      phone: "+447000000030",
      mainCategory: "plumbing",
      town: "London",
      postcode: "SW1A 1AA",
      isActive: true,
      businessProfileCompleted: true,
      verificationStatus: "VERIFIED",
    })
    .returning({ id: traderProfilesTable.id });
  createdProfileIds.push(p.id);
  return p.id;
}

let ownerId: number;
let ownerToken: string;
let profileId: number;
let employeeId: number;
let employeeToken: string;
let revokedId: number;
let revokedToken: string;
let soloId: number;
let soloToken: string;
let customerId: number;
let customerToken: string;

beforeAll(async () => {
  ownerId = await createUser("trader", "owner");
  employeeId = await createUser("trader", "employee");
  revokedId = await createUser("trader", "revoked");
  soloId = await createUser("trader", "solo");
  customerId = await createUser("customer", "plain");

  ownerToken = generateToken(ownerId, "trader");
  employeeToken = generateToken(employeeId, "trader");
  revokedToken = generateToken(revokedId, "trader");
  soloToken = generateToken(soloId, "trader");
  customerToken = generateToken(customerId, "customer");

  profileId = await createProfile(ownerId, "company");
  await createProfile(soloId, "solo");

  await db.insert(companyMembersTable).values([
    { traderProfileId: profileId, userId: ownerId, role: "OWNER", status: "ACTIVE" },
    { traderProfileId: profileId, userId: employeeId, role: "EMPLOYEE", status: "ACTIVE" },
    { traderProfileId: profileId, userId: revokedId, role: "EMPLOYEE", status: "REVOKED" },
  ]);
});

afterAll(async () => {
  restoreFlag();
  if (createdUserIds.length) {
    await db
      .delete(companyMembersTable)
      .where(inArray(companyMembersTable.userId, createdUserIds));
  }
  if (createdProfileIds.length) {
    await db
      .delete(traderProfilesTable)
      .where(inArray(traderProfilesTable.id, createdProfileIds));
  }
  if (createdUserIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreFlag();
});

// ---------------------------------------------------------------------------
// 1. Subscription routes are owner-only for company members
// ---------------------------------------------------------------------------
describe("subscriptionsOwnerGate", () => {
  const OWNER_ONLY_CASES: Array<[string, "get" | "post", string]> = [
    ["GET status", "get", "/api/subscriptions/status"],
    ["POST demo-activate", "post", "/api/subscriptions/demo-activate"],
    ["POST revenuecat-sync", "post", "/api/subscriptions/revenuecat-sync"],
    ["POST cancel", "post", "/api/subscriptions/cancel"],
    ["POST resume", "post", "/api/subscriptions/resume"],
    ["POST cancellation-request", "post", "/api/subscriptions/cancellation-request"],
  ];

  it.each(OWNER_ONLY_CASES)(
    "blocks an ACTIVE employee on %s with 403 OWNER_ONLY (flag off)",
    async (_label, method, path) => {
      setFlag(false);
      const req =
        method === "get"
          ? request(app).get(path)
          : request(app).post(path).send({ planId: "premium" });
      const res = await req.set("Authorization", `Bearer ${employeeToken}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("OWNER_ONLY");
    },
  );

  it("blocks the employee identically with the flag ON (flag-independent)", async () => {
    setFlag(true);
    const res = await request(app)
      .get("/api/subscriptions/status")
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("OWNER_ONLY");
  });

  it("keeps a REVOKED former employee locked out (removal is permanent)", async () => {
    const res = await request(app)
      .get("/api/subscriptions/status")
      .set("Authorization", `Bearer ${revokedToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("OWNER_ONLY");
  });

  it("passes the company owner through to their subscription status", async () => {
    const res = await request(app)
      .get("/api/subscriptions/status")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBeUndefined();
  });

  it("keeps legacy behaviour for a solo trader with no membership rows", async () => {
    const res = await request(app)
      .get("/api/subscriptions/status")
      .set("Authorization", `Bearer ${soloToken}`);
    expect(res.status).toBe(200);
  });

  it("keeps legacy behaviour for a customer (no company ties)", async () => {
    const res = await request(app)
      .get("/api/subscriptions/status")
      .set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
  });

  it("leaves GET /subscriptions/plans public", async () => {
    const res = await request(app).get("/api/subscriptions/plans");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.plans)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Avatar identity isolation between colleagues
// ---------------------------------------------------------------------------
describe("avatar identity isolation (same company)", () => {
  const ownerPath = () => `/objects/customer-uploads/${ownerId}/v/own-${SUFFIX}`;
  const employeePath = () => `/objects/customer-uploads/${employeeId}/v/emp-${SUFFIX}`;

  it("lets owner and employee set their OWN photos independently", async () => {
    // Mock only the storage-side object verification (no real object exists
    // in tests); prefix-ownership itself is covered by the unmocked test
    // below and by avatar.test.ts.
    vi.spyOn(
      ObjectStorageService.prototype,
      "verifyCustomerUploadObject",
    ).mockImplementation(async (objectPath: string) => objectPath);

    const r1 = await request(app)
      .patch("/api/auth/me/avatar")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ objectPath: ownerPath() });
    expect(r1.status).toBe(200);

    const r2 = await request(app)
      .patch("/api/auth/me/avatar")
      .set("Authorization", `Bearer ${employeeToken}`)
      .send({ objectPath: employeePath() });
    expect(r2.status).toBe(200);

    const rows = await db
      .select({ id: usersTable.id, avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(inArray(usersTable.id, [ownerId, employeeId]));
    const byId = new Map(rows.map((r) => [r.id, r.avatarUrl]));
    expect(byId.get(ownerId)).toBe(ownerPath());
    expect(byId.get(employeeId)).toBe(employeePath());
  });

  it("rejects an employee writing a path under the owner's prefix (400)", async () => {
    const res = await request(app)
      .patch("/api/auth/me/avatar")
      .set("Authorization", `Bearer ${employeeToken}`)
      .send({ objectPath: `/objects/customer-uploads/${ownerId}/v/steal-${SUFFIX}` });
    expect(res.status).toBe(400);
    const [row] = await db
      .select({ avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(eq(usersTable.id, employeeId));
    expect(row.avatarUrl).toBe(employeePath());
  });

  it("clearing the owner's photo never touches the employee's", async () => {
    const res = await request(app)
      .patch("/api/auth/me/avatar")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ objectPath: null });
    expect(res.status).toBe(200);

    const rows = await db
      .select({ id: usersTable.id, avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(inArray(usersTable.id, [ownerId, employeeId]));
    const byId = new Map(rows.map((r) => [r.id, r.avatarUrl]));
    expect(byId.get(ownerId)).toBeNull();
    expect(byId.get(employeeId)).toBe(employeePath());
  });
});

// ---------------------------------------------------------------------------
// 3. Colleagues can load each other's headshots; outsiders cannot
// ---------------------------------------------------------------------------
describe("avatar-file serving for company colleagues", () => {
  const FAKE_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const employeeAvatar = () =>
    `/objects/customer-uploads/${employeeId}/v/emp-serve-${SUFFIX}`;
  const ownerAvatar = () =>
    `/objects/customer-uploads/${ownerId}/v/own-serve-${SUFFIX}`;

  beforeAll(async () => {
    await db
      .update(usersTable)
      .set({ avatarUrl: employeeAvatar() })
      .where(eq(usersTable.id, employeeId));
    await db
      .update(usersTable)
      .set({ avatarUrl: ownerAvatar() })
      .where(eq(usersTable.id, ownerId));
  });

  function mockStorage() {
    return vi
      .spyOn(ObjectStorageService.prototype, "getObjectEntityFile")
      .mockResolvedValue({
        getMetadata: async () => [
          { contentType: "image/jpeg", size: FAKE_BYTES.length },
        ],
        createReadStream: () => Readable.from([FAKE_BYTES]),
      } as never);
  }

  it("streams a colleague's photo to the owner without any shared conversation (flag off)", async () => {
    setFlag(false);
    const spy = mockStorage();
    const res = await request(app)
      .get(`/api/customer/uploads/avatar-file?path=${encodeURIComponent(employeeAvatar())}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("streams the owner's photo to an ACTIVE employee", async () => {
    const spy = mockStorage();
    const res = await request(app)
      .get(`/api/customer/uploads/avatar-file?path=${encodeURIComponent(ownerAvatar())}`)
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("404s a REVOKED former member before any storage access", async () => {
    const spy = mockStorage();
    const res = await request(app)
      .get(`/api/customer/uploads/avatar-file?path=${encodeURIComponent(ownerAvatar())}`)
      .set("Authorization", `Bearer ${revokedToken}`);
    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });

  it("404s an unrelated trader from another company", async () => {
    const spy = mockStorage();
    const res = await request(app)
      .get(`/api/customer/uploads/avatar-file?path=${encodeURIComponent(employeeAvatar())}`)
      .set("Authorization", `Bearer ${soloToken}`);
    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Team list exposes each member's own avatar
// ---------------------------------------------------------------------------
describe("GET /company/team member identity", () => {
  it("returns avatarUrl and status per member (flag on)", async () => {
    setFlag(true);
    const res = await request(app)
      .get("/api/company/team")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);

    const members: Array<{
      userId: number;
      avatarUrl: string | null;
      status: string;
      role: string;
    }> = res.body.members;
    expect(members.length).toBe(2);

    const emp = members.find((m) => m.userId === employeeId);
    expect(emp).toBeDefined();
    expect(emp!.avatarUrl).toBe(
      `/objects/customer-uploads/${employeeId}/v/emp-serve-${SUFFIX}`,
    );
    expect(emp!.status).toBe("ACTIVE");

    const own = members.find((m) => m.userId === ownerId);
    // The owner cleared their photo in the isolation suite, then the serving
    // suite re-seeded it — assert it is exactly the member's OWN current
    // value, never the employee's.
    expect(own!.avatarUrl).toBe(
      `/objects/customer-uploads/${ownerId}/v/own-serve-${SUFFIX}`,
    );
    expect(own!.role).toBe("OWNER");
  });
});
