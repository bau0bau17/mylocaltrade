/**
 * One-off backfill: derive trader_profiles.business_role from business_type
 * for existing traders who never declared a role (business_role IS NULL).
 *
 *   SOLE_TRADER      -> SELF_EMPLOYED  (the existing enum value for sole traders)
 *   LIMITED_COMPANY  -> OWNER          (default; the trader can change it to
 *                                       DIRECTOR etc. on their business profile)
 *
 * Profiles with NULL business_type are left untouched — the onboarding flow
 * collects both fields and completion logic does not depend on business_role.
 *
 * Dry-run by default; pass --apply to write.
 *
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/backfill-business-role.ts [--apply]
 */
import { db } from "@workspace/db";
import { traderProfilesTable } from "@workspace/db/schema";
import { and, eq, isNull } from "drizzle-orm";

async function main() {
  const apply = process.argv.includes("--apply");

  const candidates = await db
    .select({
      id: traderProfilesTable.id,
      userId: traderProfilesTable.userId,
      businessName: traderProfilesTable.businessName,
      businessType: traderProfilesTable.businessType,
    })
    .from(traderProfilesTable)
    .where(isNull(traderProfilesTable.businessRole));

  const soleTraders = candidates.filter((c) => c.businessType === "SOLE_TRADER");
  const limitedCompanies = candidates.filter((c) => c.businessType === "LIMITED_COMPANY");
  const undeclared = candidates.filter((c) => !c.businessType);

  console.log(`Profiles with NULL business_role: ${candidates.length}`);
  console.log(`  SOLE_TRADER      -> SELF_EMPLOYED : ${soleTraders.length}`);
  console.log(`  LIMITED_COMPANY  -> OWNER         : ${limitedCompanies.length}`);
  console.log(`  (no business_type, skipped)       : ${undeclared.length}`);
  for (const c of [...soleTraders, ...limitedCompanies]) {
    console.log(`  - profile ${c.id} (user ${c.userId}) "${c.businessName}" [${c.businessType}]`);
  }

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to write these values.");
    return;
  }

  if (soleTraders.length > 0) {
    await db
      .update(traderProfilesTable)
      .set({ businessRole: "SELF_EMPLOYED", updatedAt: new Date() })
      .where(
        and(
          isNull(traderProfilesTable.businessRole),
          eq(traderProfilesTable.businessType, "SOLE_TRADER"),
        ),
      );
  }
  if (limitedCompanies.length > 0) {
    await db
      .update(traderProfilesTable)
      .set({ businessRole: "OWNER", updatedAt: new Date() })
      .where(
        and(
          isNull(traderProfilesTable.businessRole),
          eq(traderProfilesTable.businessType, "LIMITED_COMPANY"),
        ),
      );
  }
  console.log("\nBackfill applied.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
