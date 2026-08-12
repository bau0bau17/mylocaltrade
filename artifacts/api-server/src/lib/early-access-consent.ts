/**
 * Exact consent wording shown on the landing-site Early Access form, plus
 * version tags stored with every consent event so we can always prove what
 * a person agreed to and when.
 *
 * IMPORTANT: the landing site is a prebuilt bundle
 * (artifacts/mobile/server/landing-site/assets/LandingPageBelowFold-*.js).
 * If the wording there changes, add a NEW version here — never edit an
 * existing version's text, and keep the bundle text and these constants
 * in lockstep.
 */

/** Required agreement — launch/early-access updates only. */
export const LAUNCH_CONSENT_VERSION = "launch-v2-2026-08-12";
export const LAUNCH_CONSENT_WORDING =
  "I'd like MyLocalTrade to email me when early access opens and the app goes live.";

/**
 * The wording used by the original form (before the launch/marketing split).
 * Qualifies a record for launch updates ONLY — never for marketing.
 */
export const LAUNCH_CONSENT_VERSION_LEGACY = "launch-v1-legacy";
export const LAUNCH_CONSENT_WORDING_LEGACY =
  "I agree to be contacted by MyLocalTrade about launch updates and early access.";

/** Separate OPTIONAL ongoing-marketing consent (unchecked by default). */
export const MARKETING_CONSENT_VERSION = "marketing-v1-2026-08-12";
export const MARKETING_CONSENT_WORDING =
  "Yes, send me occasional MyLocalTrade news, updates and offers by email.";

export const CONSENT_WORDING_BY_VERSION: Record<string, string> = {
  [LAUNCH_CONSENT_VERSION]: LAUNCH_CONSENT_WORDING,
  [LAUNCH_CONSENT_VERSION_LEGACY]: LAUNCH_CONSENT_WORDING_LEGACY,
  [MARKETING_CONSENT_VERSION]: MARKETING_CONSENT_WORDING,
};
