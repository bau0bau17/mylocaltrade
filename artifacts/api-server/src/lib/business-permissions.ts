/**
 * Single server-side choke point for "who may manage BUSINESS-level fields"
 * on a trader profile (Phase 1A of the multi-member roadmap).
 *
 * Business-level fields describe the company itself — logo, name, services,
 * areas, address and company/VAT details — as opposed to PERSONAL fields
 * (the user's own name, phone, avatar).
 *
 * Today every trader profile has exactly one user (trader_profiles.user_id is
 * unique), and that owning user — whatever their declared businessRole
 * (OWNER, DIRECTOR, SELF_EMPLOYED, …) — manages the business. So the check is
 * simply "the caller owns this profile". The point of routing every business
 * mutation through here is that when Employee memberships arrive (Phase 2),
 * denying them business-field writes is a change to THIS function only — the
 * API is already enforcing the boundary, not just the mobile UI.
 *
 * NOTE: this is an authorisation gate, not change control. Protected-field
 * change requests (profile-change-requests) still apply on top of it.
 */

/** Trader-profile fields that count as business-level (managed) fields. */
export const BUSINESS_MANAGED_FIELDS = [
  "businessName",
  "logoUrl",
  "mainCategory",
  "additionalServices",
  "serviceAreas",
  "businessAddress",
  "town",
  "postcode",
  "businessType",
  "companyNumber",
  "vatNumber",
  "openingHours",
  "workingHours",
  "website",
  "socialLinks",
  "businessEmailDomain",
] as const;
export type BusinessManagedField = (typeof BUSINESS_MANAGED_FIELDS)[number];

const managedFieldSet: ReadonlySet<string> = new Set(BUSINESS_MANAGED_FIELDS);

/** Which of the supplied field names are business-level fields. */
export function businessFieldsIn(fields: Iterable<string>): string[] {
  const hits: string[] = [];
  for (const f of fields) if (managedFieldSet.has(f)) hits.push(f);
  return hits;
}

/**
 * May `callerUserId` manage business-level fields of the profile owned by
 * `profileUserId`? Phase 1A: yes iff they ARE the owning user (Owner,
 * Director and Sole trader are all, by definition, the single owning user
 * today). Future Employee memberships must NOT pass this check.
 */
export function canManageBusinessFields(
  callerUserId: number,
  profileUserId: number,
): boolean {
  return callerUserId === profileUserId;
}
