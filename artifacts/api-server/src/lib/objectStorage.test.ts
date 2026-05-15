import { describe, it, beforeEach, expect, vi } from "vitest";

type FakeFile = {
  name: string;
  exists: ReturnType<typeof vi.fn>;
  getMetadata: ReturnType<typeof vi.fn>;
  move: ReturnType<typeof vi.fn>;
};

const fakeFiles = new Map<string, FakeFile>();
const moveCalls: Array<{ from: string; to: string }> = [];

function makeFile(
  name: string,
  opts: { size?: number; contentType?: string; exists?: boolean } = {},
): FakeFile {
  const file: FakeFile = {
    name,
    exists: vi.fn().mockResolvedValue([opts.exists ?? true]),
    getMetadata: vi.fn().mockResolvedValue([
      {
        size: opts.size ?? 1024,
        contentType: opts.contentType ?? "image/jpeg",
      },
    ]),
    move: vi.fn().mockImplementation(async (dest: string) => {
      moveCalls.push({ from: name, to: dest });
      const moved = makeFile(dest, opts);
      fakeFiles.set(dest, moved);
      fakeFiles.delete(name);
    }),
  };
  return file;
}

vi.mock("@google-cloud/storage", () => {
  class File {}
  const Storage = vi.fn().mockImplementation(() => ({
    bucket: (_bucketName: string) => ({
      file: (objectName: string) => {
        let f = fakeFiles.get(objectName);
        if (!f) {
          f = makeFile(objectName, { exists: false });
          fakeFiles.set(objectName, f);
        }
        return f;
      },
    }),
  }));
  return { Storage, File };
});

vi.mock("./objectAcl", () => ({
  ObjectAclPolicy: {},
  ObjectPermission: { READ: "read", WRITE: "write" },
  canAccessObject: vi.fn().mockResolvedValue(true),
  getObjectAclPolicy: vi.fn().mockResolvedValue(null),
  setObjectAclPolicy: vi.fn().mockResolvedValue(undefined),
}));

process.env.PRIVATE_OBJECT_DIR = "/test-bucket/private";

const { ObjectStorageService } = await import("./objectStorage");

const USER_ID = 42;
const OTHER_USER_ID = 99;

function seedUpload(
  userId: number,
  fileId: string,
  opts: { size?: number; contentType?: string } = {},
): string {
  const objectName = `private/customer-uploads/${userId}/${fileId}`;
  fakeFiles.set(objectName, makeFile(objectName, { ...opts, exists: true }));
  return `/objects/customer-uploads/${userId}/${fileId}`;
}

describe("ObjectStorageService.verifyCustomerUploadObject", () => {
  let storage: InstanceType<typeof ObjectStorageService>;

  beforeEach(() => {
    fakeFiles.clear();
    moveCalls.length = 0;
    storage = new ObjectStorageService();
  });

  it("rejects files larger than 8 MB based on real GCS metadata", async () => {
    const path = seedUpload(USER_ID, "big.jpg", {
      size: 9 * 1024 * 1024,
      contentType: "image/jpeg",
    });
    await expect(storage.verifyCustomerUploadObject(path, USER_ID)).rejects.toThrow(
      /8 MB size limit/i,
    );
    expect(moveCalls).toHaveLength(0);
  });

  it("rejects unsupported MIME types based on real GCS metadata", async () => {
    const path = seedUpload(USER_ID, "evil.html", {
      size: 1000,
      contentType: "text/html",
    });
    await expect(storage.verifyCustomerUploadObject(path, USER_ID)).rejects.toThrow(
      /unsupported file type/i,
    );
    expect(moveCalls).toHaveLength(0);
  });

  it("rejects an empty / zero-byte upload", async () => {
    const path = seedUpload(USER_ID, "empty.jpg", {
      size: 0,
      contentType: "image/jpeg",
    });
    await expect(storage.verifyCustomerUploadObject(path, USER_ID)).rejects.toThrow(
      /empty/i,
    );
  });

  it("rejects a path that belongs to a different user's namespace", async () => {
    const path = seedUpload(OTHER_USER_ID, "other.jpg", {
      size: 1000,
      contentType: "image/jpeg",
    });
    await expect(storage.verifyCustomerUploadObject(path, USER_ID)).rejects.toThrow(
      /does not belong to your account/i,
    );
  });

  it("rejects an arbitrary string outside the customer-uploads namespace", async () => {
    await expect(
      storage.verifyCustomerUploadObject("/objects/trader-documents/42/secret.pdf", USER_ID),
    ).rejects.toThrow(/does not belong to your account/i);
    await expect(
      storage.verifyCustomerUploadObject("not-a-path", USER_ID),
    ).rejects.toThrow();
  });

  it("rejects when the underlying object does not exist in GCS", async () => {
    await expect(
      storage.verifyCustomerUploadObject(
        `/objects/customer-uploads/${USER_ID}/missing.jpg`,
        USER_ID,
      ),
    ).rejects.toThrow(/could not be found/i);
  });

  it.each([
    ["image/jpeg", "a.jpg"],
    ["image/png", "b.png"],
    ["image/webp", "c.webp"],
    ["image/heic", "d.heic"],
    ["image/heif", "e.heif"],
  ])("accepts %s and moves the object into the protected /v/ path", async (mime, name) => {
    const path = seedUpload(USER_ID, name, { size: 5_000_000, contentType: mime });
    const result = await storage.verifyCustomerUploadObject(path, USER_ID);
    expect(result).toMatch(
      new RegExp(`^/objects/customer-uploads/${USER_ID}/v/[0-9a-f-]{36}$`),
    );
    expect(moveCalls).toHaveLength(1);
    // The original signed-PUT path is gone after the move; a re-PUT to it
    // would land at an empty source and never affect the persisted /v/ ref.
    expect(fakeFiles.has(`private/customer-uploads/${USER_ID}/${name}`)).toBe(false);
    // The destination object DOES exist now under /v/<uuid>.
    expect(
      [...fakeFiles.keys()].some((k) =>
        k.startsWith(`private/customer-uploads/${USER_ID}/v/`),
      ),
    ).toBe(true);
  });

  it("does not re-fetch metadata or re-move an already-finalised /v/ path", async () => {
    const finalisedName = "private/customer-uploads/42/v/already-finalised";
    const file = makeFile(finalisedName, { size: 1000, contentType: "image/jpeg" });
    fakeFiles.set(finalisedName, file);
    const path = `/objects/customer-uploads/${USER_ID}/v/already-finalised`;

    const result = await storage.verifyCustomerUploadObject(path, USER_ID);

    expect(result).toBe(path);
    expect(file.getMetadata).not.toHaveBeenCalled();
    expect(file.move).not.toHaveBeenCalled();
    expect(moveCalls).toHaveLength(0);
  });

  it("normalises a full storage.googleapis.com URL before validating ownership", async () => {
    seedUpload(USER_ID, "remote.jpg", { size: 1000, contentType: "image/png" });
    const fullUrl = `https://storage.googleapis.com/test-bucket/private/customer-uploads/${USER_ID}/remote.jpg`;
    const result = await storage.verifyCustomerUploadObject(fullUrl, USER_ID);
    expect(result).toMatch(
      new RegExp(`^/objects/customer-uploads/${USER_ID}/v/[0-9a-f-]{36}$`),
    );
  });
});

describe("ObjectStorageService.isCustomerUploadPathFor", () => {
  const storage = new ObjectStorageService();

  it("accepts a path inside the user's namespace", () => {
    expect(
      storage.isCustomerUploadPathFor(`/objects/customer-uploads/${USER_ID}/abc`, USER_ID),
    ).toBe(true);
    expect(
      storage.isCustomerUploadPathFor(
        `/objects/customer-uploads/${USER_ID}/v/abc`,
        USER_ID,
      ),
    ).toBe(true);
  });

  it("rejects another user's path, other namespaces, and arbitrary strings", () => {
    expect(
      storage.isCustomerUploadPathFor(
        `/objects/customer-uploads/${OTHER_USER_ID}/abc`,
        USER_ID,
      ),
    ).toBe(false);
    expect(
      storage.isCustomerUploadPathFor(`/objects/trader-documents/${USER_ID}/x.pdf`, USER_ID),
    ).toBe(false);
    expect(storage.isCustomerUploadPathFor("javascript:alert(1)", USER_ID)).toBe(false);
    expect(storage.isCustomerUploadPathFor("", USER_ID)).toBe(false);
    expect(
      storage.isCustomerUploadPathFor(undefined as unknown as string, USER_ID),
    ).toBe(false);
  });
});
