/**
 * One-time cleanup of push tokens left behind by accounts deleted before the
 * deletion flows started purging tokens.
 *
 * Dry-run (default) — reports what WOULD be removed, changes nothing:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/cleanup-orphaned-push-tokens.ts
 *
 * Apply — actually deletes the reported tokens:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/cleanup-orphaned-push-tokens.ts --apply
 *
 * Targets whichever database DATABASE_URL points at. Never run against
 * production without an explicit go-ahead on the dry-run report.
 */
import {
  findOrphanedPushTokens,
  cleanupOrphanedPushTokens,
} from "../lib/cleanup-orphaned-push-tokens";

const apply = process.argv.includes("--apply");

const orphans = await findOrphanedPushTokens();
if (orphans.length === 0) {
  console.log("No orphaned push tokens found. Nothing to do.");
  process.exit(0);
}

console.log(`Found ${orphans.length} orphaned push token(s):`);
for (const o of orphans) {
  console.log(
    `  token #${o.tokenId} — user ${o.userId} (deletionStatus=${o.deletionStatus ?? "n/a"}, platform=${o.platform ?? "?"})`,
  );
}

if (!apply) {
  console.log("\nDry run — nothing deleted. Re-run with --apply to remove them.");
  process.exit(0);
}

const removed = await cleanupOrphanedPushTokens();
console.log(`\nDeleted ${removed} orphaned push token(s).`);
process.exit(0);
