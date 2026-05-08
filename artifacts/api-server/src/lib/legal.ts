export const CURRENT_TERMS_VERSION = "1.0.0";
export const CURRENT_PRIVACY_VERSION = "1.0.0";

export interface LegalAcceptanceState {
  termsCurrent: string;
  termsAccepted: string | null;
  termsAcceptedAt: string | null;
  termsNeedsReaccept: boolean;
  privacyCurrent: string;
  privacyAccepted: string | null;
  privacyAcceptedAt: string | null;
  privacyNeedsReaccept: boolean;
  needsReaccept: boolean;
}

export function evaluateLegalAcceptance(profile: {
  termsVersion: string | null;
  termsAcceptedAt: Date | null;
  privacyVersion: string | null;
  privacyAcceptedAt: Date | null;
}): LegalAcceptanceState {
  const termsAccepted = profile.termsVersion;
  const privacyAccepted = profile.privacyVersion;
  const termsNeedsReaccept =
    !termsAccepted || termsAccepted !== CURRENT_TERMS_VERSION;
  const privacyNeedsReaccept =
    !privacyAccepted || privacyAccepted !== CURRENT_PRIVACY_VERSION;
  return {
    termsCurrent: CURRENT_TERMS_VERSION,
    termsAccepted,
    termsAcceptedAt: profile.termsAcceptedAt?.toISOString() ?? null,
    termsNeedsReaccept,
    privacyCurrent: CURRENT_PRIVACY_VERSION,
    privacyAccepted,
    privacyAcceptedAt: profile.privacyAcceptedAt?.toISOString() ?? null,
    privacyNeedsReaccept,
    needsReaccept: termsNeedsReaccept || privacyNeedsReaccept,
  };
}
