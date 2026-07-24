// Single source of truth for subscription plan prices (GBP).
//
// These values MUST match the live prices configured in App Store Connect for
// the RevenueCat products (premium monthly / premium annual). On native iOS
// the app shows real store prices fetched via RevenueCat; these constants only
// drive the web / Expo Go fallback pricing cards and promo-code discount maths
// served by the API. If a price is changed in App Store Connect, update it
// here in the same release so both surfaces stay in sync — the yearly-savings
// badge is computed from these numbers on the fallback surface.
export const PLAN_PRICING_GBP = {
  basic: { monthly: 0 },
  premium: { monthly: 9.99, yearly: 99.99 },
} as const;

export const PLAN_CURRENCY = "GBP" as const;
