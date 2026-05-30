// HMRC "Check a UK VAT number" API.
//
// The lookup endpoint is *application-restricted*: it requires an OAuth 2.0
// server token obtained via the client_credentials grant using an application
// client_id / client_secret registered on the HMRC Developer Hub. See:
// https://developer.service.hmrc.gov.uk/api-documentation/docs/api/service/check-vat-number-api
const HMRC_VAT_API = "https://api.service.hmrc.gov.uk";

interface CachedToken {
  accessToken: string;
  // epoch ms after which the token must be refreshed
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

/**
 * Obtain (and cache) an HMRC application server token using the
 * client_credentials grant. Returns null when credentials are not configured
 * or the token request fails.
 */
async function getHmrcServerToken(): Promise<string | null> {
  const clientId = process.env.HMRC_CLIENT_ID;
  const clientSecret = process.env.HMRC_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }

  try {
    const res = await fetch(`${HMRC_VAT_API}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!res.ok) return null;

    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;

    // Refresh 60s before the stated expiry to avoid edge-of-expiry failures.
    const ttlMs = ((json.expires_in ?? 14400) - 60) * 1000;
    cachedToken = {
      accessToken: json.access_token,
      expiresAt: Date.now() + Math.max(ttlMs, 0),
    };
    return cachedToken.accessToken;
  } catch {
    return null;
  }
}

export interface HmrcVatLookup {
  vatNumber?: string;
  name?: string;
  address?: string;
}

export type HmrcVatResult =
  | { outcome: "FOUND"; data: HmrcVatLookup }
  | { outcome: "NOT_FOUND" }
  | { outcome: "INVALID" }
  | { outcome: "ERROR"; error: string };

interface HmrcVatResponse {
  target?: {
    vatNumber?: string;
    name?: string;
    address?: {
      line1?: string;
      line2?: string;
      line3?: string;
      line4?: string;
      postcode?: string;
      countryCode?: string;
    };
  };
}

/**
 * Normalise a user-supplied VAT number to the 9-digit VRN HMRC expects:
 * strips the optional "GB" country prefix, spaces and punctuation. Returns
 * null when the input does not look like a valid UK VAT number (9 or 12
 * digits after normalisation).
 */
export function normaliseVatNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const digits = cleaned.startsWith("GB") ? cleaned.slice(2) : cleaned;
  if (!/^[0-9]{9}([0-9]{3})?$/.test(digits)) return null;
  // HMRC lookup uses the 9-digit VRN; the optional 3-digit branch suffix is
  // not part of the lookup key.
  return digits.slice(0, 9);
}

function formatHmrcAddress(a: NonNullable<NonNullable<HmrcVatResponse["target"]>["address"]>): string {
  return [a.line1, a.line2, a.line3, a.line4, a.postcode, a.countryCode]
    .filter(Boolean)
    .join(", ");
}

/**
 * Look up a UK VAT number against the HMRC register. The caller should pass a
 * raw user-supplied value; normalisation happens here.
 */
export async function lookupVatNumber(rawVrn: string): Promise<HmrcVatResult> {
  const vrn = normaliseVatNumber(rawVrn);
  if (!vrn) return { outcome: "INVALID" };

  const token = await getHmrcServerToken();
  if (!token) {
    return {
      outcome: "ERROR",
      error: "HMRC VAT lookup is not configured (missing HMRC_CLIENT_ID / HMRC_CLIENT_SECRET).",
    };
  }

  try {
    const url = `${HMRC_VAT_API}/organisations/vat/check-vat-number/lookup/${encodeURIComponent(vrn)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.hmrc.2.0+json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 404) return { outcome: "NOT_FOUND" };
    if (res.status === 400) return { outcome: "INVALID" };
    if (!res.ok) {
      return { outcome: "ERROR", error: `HMRC VAT lookup failed: ${res.status}` };
    }

    const data = (await res.json()) as HmrcVatResponse;
    const target = data.target;
    if (!target) return { outcome: "NOT_FOUND" };

    return {
      outcome: "FOUND",
      data: {
        vatNumber: target.vatNumber,
        name: target.name,
        address: target.address ? formatHmrcAddress(target.address) : undefined,
      },
    };
  } catch (err) {
    return { outcome: "ERROR", error: err instanceof Error ? err.message : String(err) };
  }
}
