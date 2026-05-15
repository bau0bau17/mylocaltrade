import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(file: File, cacheTtlSec: number = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(
    prefix?: string,
    contentType?: string
  ): Promise<{ uploadURL: string; objectPath: string }> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const safePrefix = (prefix ?? "uploads").replace(/^\/+|\/+$/g, "");
    const fullPath = `${privateObjectDir}/${safePrefix}/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    const uploadURL = await signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
      contentType,
    });

    // Compute the canonical object path (/objects/<entityId>) the client should later register.
    let entityDir = privateObjectDir;
    if (!entityDir.endsWith("/")) entityDir = `${entityDir}/`;
    const entityId = `${safePrefix}/${objectId}`;
    return { uploadURL, objectPath: `/objects/${entityId}` };
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  async getObjectEntityReadURL(objectPath: string, ttlSec = 300): Promise<string> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) throw new ObjectNotFoundError();
    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir = `${entityDir}/`;
    const fullPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    return signObjectURL({ bucketName, objectName, method: "GET", ttlSec });
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  // Verify that a customer-upload objectPath belongs to the given userId
  // namespace AND that the actual stored object satisfies our size + MIME
  // policy. The client-declared sizeBytes/mimeType when requesting an upload
  // URL cannot be trusted at PUT time, so this re-checks the real GCS
  // metadata before we persist a reference to the object. Returns the
  // normalised /objects/... path. Throws an Error whose message is safe to
  // surface to clients on policy/permission failures.
  // Cheap, no-IO check that a path lies inside the caller's customer-uploads
  // namespace. Use this for already-persisted references where a full
  // metadata re-verification would be wasteful, but you still want to reject
  // arbitrary strings being injected via an update payload.
  isCustomerUploadPathFor(rawPath: string, userId: number): boolean {
    if (typeof rawPath !== "string" || !rawPath) return false;
    const normalised = this.normalizeObjectEntityPath(rawPath);
    return normalised.startsWith(`/objects/customer-uploads/${userId}/`);
  }

  async verifyCustomerUploadObject(
    rawPath: string,
    userId: number,
    opts: { maxBytes: number; allowedMimes: ReadonlySet<string>; label?: string } = {
      maxBytes: 8 * 1024 * 1024,
      allowedMimes: new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif",
      ]),
    },
  ): Promise<string> {
    const label = opts.label ?? "photo";
    const normalised = this.normalizeObjectEntityPath(rawPath);
    const expectedPrefix = `/objects/customer-uploads/${userId}/`;
    if (!normalised.startsWith(expectedPrefix)) {
      throw new Error(`One of the ${label}s does not belong to your account.`);
    }
    // If this object has already been finalised by a previous verification it
    // lives under .../v/ where no client signed PUT URL exists, so it cannot
    // be overwritten. Skip re-verification + re-move in that case.
    const finalisedPrefix = `${expectedPrefix}v/`;
    if (normalised.startsWith(finalisedPrefix)) {
      return normalised;
    }
    let file: File;
    try {
      file = await this.getObjectEntityFile(normalised);
    } catch {
      throw new Error(`A ${label} could not be found in storage. Please re-upload.`);
    }
    const [metadata] = await file.getMetadata();
    const sizeBytes = Number(metadata.size ?? 0);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new Error(`A ${label} appears to be empty. Please re-upload.`);
    }
    if (sizeBytes > opts.maxBytes) {
      const mb = (opts.maxBytes / 1024 / 1024).toFixed(0);
      throw new Error(`A ${label} exceeds the ${mb} MB size limit.`);
    }
    const contentType = (metadata.contentType ?? "").toString().toLowerCase();
    if (!opts.allowedMimes.has(contentType)) {
      throw new Error(`A ${label} has an unsupported file type.`);
    }
    // Defeat the verify-then-PUT-again TOCTOU race: move the object to a
    // path the client never received a signed URL for. If they re-PUT to
    // the original signed URL afterwards, it lands at the now-empty source
    // and never affects the persisted reference.
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir = `${entityDir}/`;
    const finalisedEntityId = `customer-uploads/${userId}/v/${randomUUID()}`;
    const destFullPath = `${entityDir}${finalisedEntityId}`;
    const { objectName: destObjectName } = parseObjectPath(destFullPath);
    try {
      await file.move(destObjectName);
    } catch (err) {
      throw new Error(`A ${label} could not be finalised in storage.`);
    }
    return `/objects/${finalisedEntityId}`;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
  contentType,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
  contentType?: string;
}): Promise<string> {
  const request: Record<string, string> = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  // Binding the signed URL to a specific Content-Type means GCS will reject any
  // PUT request whose Content-Type header does not match, preventing a trader
  // from claiming an allowed type in the API but uploading active HTML/JS bytes.
  if (contentType) {
    request.content_type = contentType;
  }
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = (await response.json()) as { signed_url: string };
  return signedURL;
}
