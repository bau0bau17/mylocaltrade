import type { Response } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

// -----------------------------------------------------------------------------
// Customer phone-verification gate.
//
// Policy: adding a phone at customer registration is OPTIONAL, but before a
// customer first CONTACTS a trader — sending an enquiry, accepting a quote,
// or accepting a legacy offer — they must have added and SMS-verified a UK
// mobile number. The mobile app recognises the machine-readable `code` and
// routes the customer to the verify-phone screen.
// -----------------------------------------------------------------------------

export const PHONE_VERIFICATION_REQUIRED = "PHONE_VERIFICATION_REQUIRED";

/** True when the customer's users-table phoneVerified flag is set. */
export async function customerPhoneVerified(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ phoneVerified: usersTable.phoneVerified })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return Boolean(row?.phoneVerified);
}

export function sendPhoneVerificationRequired(res: Response): void {
  res.status(403).json({
    error:
      "Please verify your mobile number before contacting traders. This keeps enquiries genuine for both sides.",
    code: PHONE_VERIFICATION_REQUIRED,
  });
}
