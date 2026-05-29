import { db } from "@workspace/db";
import { traderProfilesTable, type TraderProfile } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "./trader-status";

export type VatCheckSource = "AUTO_UNDER_REVIEW" | "ADMIN_MANUAL";

export interface VatCheckResult {
  verdict: "REGISTERED" | "NOT_REGISTERED" | "VALID_FORMAT" | "INVALID_FORMAT" | "ERROR";
  reasoning: string;
  vatNumber: string;
  checksumValid: boolean;
  registerChecked: boolean;
  register: { name?: string; address?: string } | null;
  error?: string;
}

/**
 * Normalise a UK VAT number: strip spaces, dots and a leading GB/XI prefix,
 * upper-cased. Returns the digits used for the checksum (first 9) plus the
 * cleaned full string.
 */
export function normaliseVat(raw: string): { cleaned: string; digits: string } {
  const cleaned = raw
    .toUpperCase()
    .replace(/[\s.\-]/g, "")
    .replace(/^(GB|XI)/, "");
  const digits = cleaned.replace(/\D/g, "");
  return { cleaned, digits };
}

/**
 * Validate a UK VAT number using HMRC's modulus-97 ("9755") checksum.
 * This catches typos and clearly invalid numbers without any external call.
 * Standard VRNs are 9 digits; 12-digit branch numbers reuse the first 9.
 */
export function validateUkVatChecksum(raw: string): boolean {
  const { digits } = normaliseVat(raw);
  if (digits.length !== 9 && digits.length !== 12) return false;
  const core = digits.slice(0, 9).split("").map(Number);
  // Reject obviously bogus all-zero numbers, which satisfy the raw modulus.
  if (core.every((d) => d === 0)) return false;
  const weights = [8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += core[i] * weights[i];
  const check = core[7] * 10 + core[8];
  const mod97 = (sum + check) % 97;
  const mod9755 = (sum + check + 55) % 97;
  return mod97 === 0 || mod9755 === 0;
}

/**
 * Look up a VAT number against the live HMRC VAT register. Only runs when HMRC
 * API credentials (HMRC_CLIENT_ID + HMRC_CLIENT_SECRET) are configured; without
 * them the support layer falls back to checksum-only validation. Returns null
 * when credentials are absent so the caller can record REGISTER_UNAVAILABLE.
 */
async function lookupHmrcVat(
  vrn: string,
): Promise<{ available: false } | { available: true; found: boolean; name?: string; address?: string }> {
  const clientId = process.env.HMRC_CLIENT_ID;
  const clientSecret = process.env.HMRC_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { available: false };

  const base = "https://api.service.hmrc.gov.uk";
  const tokenRes = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error(`HMRC token request failed: ${tokenRes.status}`);
  const token = ((await tokenRes.json()) as { access_token?: string }).access_token;
  if (!token) throw new Error("HMRC token response missing access_token");

  const res = await fetch(`${base}/organisations/vat/check-vat-number/lookup/${encodeURIComponent(vrn)}`, {
    headers: { Accept: "application/vnd.hmrc.2.0+json", Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return { available: true, found: false };
  if (!res.ok) throw new Error(`HMRC VAT lookup failed: ${res.status}`);
  const data = (await res.json()) as {
    target?: { name?: string; address?: Record<string, string | undefined> };
  };
  const t = data.target;
  const address = t?.address
    ? [t.address.line1, t.address.line2, t.address.line3, t.address.line4, t.address.postcode, t.address.countryCode]
        .filter(Boolean)
        .join(", ")
    : undefined;
  return { available: true, found: true, name: t?.name, address };
}

export async function runVatCheck(
  profile: Pick<TraderProfile, "userId" | "vatNumber">,
  options: { source: VatCheckSource; performedBy?: number | null } = { source: "AUTO_UNDER_REVIEW" },
): Promise<VatCheckResult | null> {
  const rawVat = profile.vatNumber?.trim();
  // No VAT number supplied — nothing to check. Sole traders / self-employed are
  // expected to land here; that is fine and never affects approval. Clear any
  // stale prior verdict so an old result cannot mislead a reviewer.
  if (!rawVat) {
    // Concurrency guard: only clear if the VAT number is still absent in the DB.
    // If a newer edit added one, a fresher run owns the state — don't wipe it.
    const [current] = await db
      .select({ vatNumber: traderProfilesTable.vatNumber })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, profile.userId))
      .limit(1);
    if ((current?.vatNumber ?? "").trim() === (profile.vatNumber ?? "").trim()) {
      await db
        .update(traderProfilesTable)
        .set({
          vatVerificationStatus: null,
          vatVerificationData: null,
          vatVerificationCheckedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(traderProfilesTable.userId, profile.userId));
    }
    return null;
  }

  const { cleaned } = normaliseVat(rawVat);
  let result: VatCheckResult;
  try {
    const checksumValid = validateUkVatChecksum(rawVat);
    if (!checksumValid) {
      result = {
        verdict: "INVALID_FORMAT",
        reasoning: "The VAT number failed the UK VAT checksum, so it is not a valid number (likely a typo).",
        vatNumber: cleaned,
        checksumValid: false,
        registerChecked: false,
        register: null,
      };
    } else {
      const lookup = await lookupHmrcVat(cleaned);
      if (!lookup.available) {
        result = {
          verdict: "VALID_FORMAT",
          reasoning:
            "The VAT number is a valid UK format. Live HMRC register lookup is not configured, so the register was not checked.",
          vatNumber: cleaned,
          checksumValid: true,
          registerChecked: false,
          register: null,
        };
      } else if (!lookup.found) {
        result = {
          verdict: "NOT_REGISTERED",
          reasoning: "The VAT number is a valid format but was not found on the HMRC VAT register.",
          vatNumber: cleaned,
          checksumValid: true,
          registerChecked: true,
          register: null,
        };
      } else {
        result = {
          verdict: "REGISTERED",
          reasoning: "The VAT number is registered on the HMRC VAT register.",
          vatNumber: cleaned,
          checksumValid: true,
          registerChecked: true,
          register: { name: lookup.name, address: lookup.address },
        };
      }
    }
  } catch (err) {
    result = {
      verdict: "ERROR",
      reasoning: "The VAT check could not be completed. Please run it again or review manually.",
      vatNumber: cleaned,
      checksumValid: validateUkVatChecksum(rawVat),
      registerChecked: false,
      register: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Concurrency guard: if the trader changed their VAT number while this check
  // was running (e.g. a rapid second edit kicked off a newer run), skip the
  // write so a slower stale run cannot clobber the newer verdict.
  const [current] = await db
    .select({ vatNumber: traderProfilesTable.vatNumber })
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.userId, profile.userId))
    .limit(1);
  if ((current?.vatNumber ?? "").trim() !== (profile.vatNumber ?? "").trim()) {
    return result;
  }

  await db
    .update(traderProfilesTable)
    .set({
      vatVerificationStatus: result.verdict,
      vatVerificationData: result,
      vatVerificationCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(traderProfilesTable.userId, profile.userId));

  await logAudit({
    userId: profile.userId,
    action: "VAT_VERIFICATION_RAN",
    performedBy: options.performedBy ?? null,
    details: { source: options.source, verdict: result.verdict },
    notes: `[${options.source}] VAT verdict: ${result.verdict}. ${result.reasoning}`,
  });

  return result;
}

/** Fire-and-forget wrapper for use during status transitions. */
export function triggerVatCheck(profile: Pick<TraderProfile, "userId" | "vatNumber">): void {
  void runVatCheck(profile, { source: "AUTO_UNDER_REVIEW" }).catch((err) => {
    console.error("[vat-check] background failure for user", profile.userId, err);
  });
}
