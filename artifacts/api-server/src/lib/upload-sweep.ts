import { db } from "@workspace/db";
import { traderDocumentsTable } from "@workspace/db/schema";
import { ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";

// A presigned PUT URL lives 15 minutes; anything older than this that was
// never finalised/registered is an orphan the client abandoned (or an attacker
// deliberately never finalised to squat storage). Generous margin so slow
// legitimate flows (upload → register) are never caught mid-flight.
const ORPHAN_MIN_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

function createdAtMs(meta: { timeCreated?: string | Date | null }): number {
  const t = meta.timeCreated;
  if (!t) return Date.now(); // unknown age → treat as fresh, never delete
  return new Date(t).getTime();
}

/**
 * Storage-exhaustion defence (security hardening): presigned PUT URLs cannot
 * bind a content-length, so a user can upload oversized blobs directly to the
 * bucket and simply never finalise them — the post-upload verification in
 * verifyCustomerUploadObject / document registration only runs if they do.
 * This sweep deletes those orphans:
 *
 *  - customer-uploads/<uid>/... NOT under .../v/ (finalisation MOVES objects
 *    to /v/, so anything outside /v/ older than the threshold was never
 *    verified and is unreferenced by definition).
 *  - trader-documents/<uid>/... not referenced by any trader_documents row
 *    (registration keeps documents at their original path).
 */
export async function sweepOrphanUploads(): Promise<{
  scanned: number;
  deleted: number;
}> {
  const storage = new ObjectStorageService();
  const cutoff = Date.now() - ORPHAN_MIN_AGE_MS;
  let scanned = 0;
  let deleted = 0;

  // --- Customer uploads: everything outside a /v/ segment is unfinalised.
  const customerFiles = await storage.listEntityFiles("customer-uploads/");
  for (const { file, entityId } of customerFiles) {
    scanned += 1;
    // Finalised objects live at customer-uploads/<uid>/v/<uuid> — keep them.
    if (/^customer-uploads\/[^/]+\/v\//.test(entityId)) continue;
    try {
      const [meta] = await file.getMetadata();
      if (createdAtMs(meta) > cutoff) continue;
      await file.delete({ ignoreNotFound: true });
      deleted += 1;
    } catch (err) {
      logger.warn({ err, entityId }, "Orphan sweep: customer upload delete failed");
    }
  }

  // --- Trader documents: keep anything referenced by a trader_documents row.
  const docRows = await db
    .select({ objectPath: traderDocumentsTable.objectPath })
    .from(traderDocumentsTable);
  const referenced = new Set(docRows.map((r) => r.objectPath));

  const documentFiles = await storage.listEntityFiles("trader-documents/");
  for (const { file, entityId } of documentFiles) {
    scanned += 1;
    if (referenced.has(`/objects/${entityId}`)) continue;
    try {
      const [meta] = await file.getMetadata();
      if (createdAtMs(meta) > cutoff) continue;
      await file.delete({ ignoreNotFound: true });
      deleted += 1;
    } catch (err) {
      logger.warn({ err, entityId }, "Orphan sweep: trader document delete failed");
    }
  }

  return { scanned, deleted };
}
