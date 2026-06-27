import { COOLING_OFF_DAYS } from "@workspace/db/schema";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CoolingOffState {
  /** True while the trader is still inside their 14-day cooling-off window. */
  isWithinWindow: boolean;
  /** The first-purchase anchor used for the calculation, if known. */
  originalPurchaseAt: string | null;
  /** When the cooling-off window ends (anchor + 14 days), if known. */
  endsAt: string | null;
  /** Whole days left in the window (0 once expired or unknown). */
  daysRemaining: number;
}

// Pure, side-effect-free derivation of the cooling-off state from the original
// purchase date. The anchor is the trader's FIRST purchase (never reset on
// renewal); callers fall back to the subscription createdAt when the dedicated
// column has not been backfilled. This only REPORTS eligibility — it never
// decides refunds and never mutates anything.
export function getCoolingOffState(
  originalPurchaseAt: Date | null | undefined,
  now: Date = new Date(),
): CoolingOffState {
  if (!originalPurchaseAt) {
    return {
      isWithinWindow: false,
      originalPurchaseAt: null,
      endsAt: null,
      daysRemaining: 0,
    };
  }
  const endsAt = new Date(originalPurchaseAt.getTime() + COOLING_OFF_DAYS * DAY_MS);
  const isWithinWindow = now.getTime() < endsAt.getTime();
  const daysRemaining = isWithinWindow
    ? Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS)
    : 0;
  return {
    isWithinWindow,
    originalPurchaseAt: originalPurchaseAt.toISOString(),
    endsAt: endsAt.toISOString(),
    daysRemaining,
  };
}
