import { describe, it, beforeAll, afterAll, afterEach, expect, vi } from "vitest";
import { Readable } from "stream";
import request from "supertest";
import { db } from "@workspace/db";
import { usersTable, traderProfilesTable } from "@workspace/db/schema";
import { inArray } from "drizzle-orm";
import app from "../app";
import { ObjectStorageService } from "../lib/objectStorage";

/**
 * PUBLIC image streaming tests for GET /customer/uploads/gallery-file.
 *
 * The route already has access-control coverage elsewhere; these tests cover
 * the STREAMING path end-to-end with a mocked storage object (same pattern as
 * avatar.test.ts "with a (mocked) real stored object"):
 *  - a published trader's gallery image streams 200 + exact bytes, correct
 *    content type and a public cache-control header;
 *  - the trader's business logo (logoUrl) streams the same way;
 *  - a hidden (unlisted) trader's image 404s BEFORE any storage access —
 *    the storage mock is never called.
 */

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const createdUserIds: number[] = [];
const createdProfileIds: number[] = [];

const galleryPath = `/objects/customer-uploads/gallery-${SUFFIX}/v/photo-1`;
const logoPath = `/objects/customer-uploads/gallery-${SUFFIX}/v/logo-1`;
const hiddenGalleryPath = `/objects/customer-uploads/gallery-${SUFFIX}/v/hidden-1`;

const FAKE_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]); // JPEG magic-number prefix + filler

async function createTrader(label: string, opts: { hidden?: boolean; gallery: string[]; logo?: string }) {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: `gallery-test+${label}-${SUFFIX}@example.test`,
      passwordHash: "$2a$10$test.hash.not.used.for.login",
      fullName: `Gallery trader ${label}`,
      role: "trader",
      isActive: true,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });
  createdUserIds.push(u.id);

  const [p] = await db
    .insert(traderProfilesTable)
    .values({
      userId: u.id,
      businessName: `Gallery Trades ${label} ${SUFFIX}`,
      contactName: "Gallery Trader",
      email: `gallery-test+profile-${label}-${SUFFIX}@example.test`,
      phone: "+447000000000",
      mainCategory: "plumbing",
      town: "London",
      postcode: "SW1A 1AA",
      // Publicly listed unless hidden: active + verified.
      isActive: !opts.hidden,
      businessProfileCompleted: true,
      verificationStatus: "VERIFIED",
      galleryUrls: opts.gallery,
      logoUrl: opts.logo ?? null,
    })
    .returning({ id: traderProfilesTable.id });
  createdProfileIds.push(p.id);
}

beforeAll(async () => {
  await createTrader("public", { gallery: [galleryPath], logo: logoPath });
  // A trader that exists but is NOT publicly listed (isActive=false): their
  // images must never be served, and storage must never be touched.
  await createTrader("hidden", { hidden: true, gallery: [hiddenGalleryPath] });
});

afterAll(async () => {
  if (createdProfileIds.length) {
    await db.delete(traderProfilesTable).where(inArray(traderProfilesTable.id, createdProfileIds));
  }
  if (createdUserIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
});

function mockStoredObject(expectedPath?: string) {
  return vi
    .spyOn(ObjectStorageService.prototype, "getObjectEntityFile")
    .mockImplementation(async (objectPath: string) => {
      if (expectedPath) expect(objectPath).toBe(expectedPath);
      return {
        getMetadata: async () => [
          { contentType: "image/jpeg", size: FAKE_BYTES.length },
        ],
        createReadStream: () => Readable.from([FAKE_BYTES]),
      } as never;
    });
}

function getFile(path: string) {
  return request(app)
    .get(`/api/customer/uploads/gallery-file?path=${encodeURIComponent(path)}`)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
}

describe("GET /customer/uploads/gallery-file (streaming, mocked storage)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("streams 200 + exact bytes for a published trader's gallery image", async () => {
    const spy = mockStoredObject(galleryPath);
    const res = await getFile(galleryPath);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
    expect(res.headers["cache-control"]).toContain("public");
    expect(res.headers["content-length"]).toBe(String(FAKE_BYTES.length));
    expect(Buffer.compare(res.body as Buffer, FAKE_BYTES)).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("streams 200 + exact bytes for a published trader's business logo (logoUrl)", async () => {
    const spy = mockStoredObject(logoPath);
    const res = await getFile(logoPath);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
    expect(res.headers["cache-control"]).toContain("public");
    expect(Buffer.compare(res.body as Buffer, FAKE_BYTES)).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("404s a hidden/unlisted trader's image before any storage access", async () => {
    const spy = mockStoredObject();
    const res = await getFile(hiddenGalleryPath);
    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });
});
