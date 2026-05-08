import { db } from "@workspace/db";
import { traderProfilesTable, type TraderProfile } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "./trader-status";

export type AiVerificationSource = "AUTO_UNDER_REVIEW" | "ADMIN_MANUAL";

const COMPANIES_HOUSE_API = "https://api.company-information.service.gov.uk";

interface CompaniesHouseSearchHit {
  company_number?: string;
  title?: string;
  address_snippet?: string;
}

interface CompaniesHouseSearchResponse {
  items?: CompaniesHouseSearchHit[];
}

interface CompaniesHouseProfile {
  company_number?: string;
  company_name?: string;
  company_status?: string;
  sic_codes?: string[];
  registered_office_address?: {
    address_line_1?: string;
    address_line_2?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
}

export interface AiVerificationResult {
  verdict: "MATCH" | "PARTIAL_MATCH" | "NO_MATCH" | "NOT_FOUND" | "ERROR";
  reasoning: string;
  submitted: { businessName: string; address: string; postcode: string };
  companiesHouse: {
    companyNumber?: string;
    companyName?: string;
    address?: string;
    postcode?: string;
    status?: string;
    sicCodes?: string[];
  } | null;
  error?: string;
}

function chAuthHeader(): string {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) throw new Error("COMPANIES_HOUSE_API_KEY not configured");
  return "Basic " + Buffer.from(`${key}:`).toString("base64");
}

async function searchCompany(name: string): Promise<CompaniesHouseSearchHit | null> {
  const url = `${COMPANIES_HOUSE_API}/search/companies?q=${encodeURIComponent(name)}&items_per_page=5`;
  const res = await fetch(url, { headers: { Authorization: chAuthHeader() } });
  if (!res.ok) throw new Error(`Companies House search failed: ${res.status}`);
  const data = (await res.json()) as CompaniesHouseSearchResponse;
  return data.items?.[0] ?? null;
}

async function getCompanyProfile(companyNumber: string): Promise<CompaniesHouseProfile | null> {
  const url = `${COMPANIES_HOUSE_API}/company/${encodeURIComponent(companyNumber)}`;
  const res = await fetch(url, { headers: { Authorization: chAuthHeader() } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Companies House profile failed: ${res.status}`);
  return (await res.json()) as CompaniesHouseProfile;
}

function formatChAddress(p: CompaniesHouseProfile): string {
  const a = p.registered_office_address;
  if (!a) return "";
  return [a.address_line_1, a.address_line_2, a.locality, a.region, a.postal_code, a.country]
    .filter(Boolean)
    .join(", ");
}

async function aiCompare(
  submitted: { businessName: string; address: string; postcode: string },
  ch: NonNullable<AiVerificationResult["companiesHouse"]>,
): Promise<{ verdict: AiVerificationResult["verdict"]; reasoning: string }> {
  const prompt = `You verify UK trader applications by comparing the business info they submitted against the official Companies House registry.

Submitted by trader:
- Business name: ${submitted.businessName}
- Address: ${submitted.address}
- Postcode: ${submitted.postcode}

Companies House record:
- Company number: ${ch.companyNumber ?? "n/a"}
- Registered name: ${ch.companyName ?? "n/a"}
- Registered address: ${ch.address ?? "n/a"}
- Postcode: ${ch.postcode ?? "n/a"}
- Status: ${ch.status ?? "n/a"}

Decide one of:
- MATCH: name and address (or postcode) reasonably match the same business. Minor formatting differences (Ltd vs Limited, abbreviations, missing line 2) are OK.
- PARTIAL_MATCH: name matches but address/postcode differs significantly, or vice versa. Reviewer should look manually.
- NO_MATCH: this is clearly a different business.

Respond with strict JSON only: {"verdict":"MATCH|PARTIAL_MATCH|NO_MATCH","reasoning":"one or two sentences in plain English explaining the decision"}`;

  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 400,
    messages: [
      { role: "system", content: "You output strict JSON. No prose, no markdown, no code fences." },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });
  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { verdict?: string; reasoning?: string };
  const verdict = (parsed.verdict ?? "NO_MATCH").toUpperCase();
  const safeVerdict = (["MATCH", "PARTIAL_MATCH", "NO_MATCH"].includes(verdict)
    ? verdict
    : "NO_MATCH") as AiVerificationResult["verdict"];
  return { verdict: safeVerdict, reasoning: parsed.reasoning ?? "No reasoning provided." };
}

export async function runAiVerification(
  profile: Pick<TraderProfile, "userId" | "businessName" | "businessAddress" | "town" | "postcode">,
  options: { source: AiVerificationSource; performedBy?: number | null } = { source: "AUTO_UNDER_REVIEW" },
): Promise<AiVerificationResult> {
  const submitted = {
    businessName: profile.businessName,
    address: [profile.businessAddress, profile.town].filter(Boolean).join(", "),
    postcode: profile.postcode,
  };

  let result: AiVerificationResult;
  try {
    const hit = await searchCompany(profile.businessName);
    if (!hit?.company_number) {
      result = {
        verdict: "NOT_FOUND",
        reasoning: "No matching company found on Companies House for this business name.",
        submitted,
        companiesHouse: null,
      };
    } else {
      const ch = await getCompanyProfile(hit.company_number);
      if (!ch) {
        result = {
          verdict: "NOT_FOUND",
          reasoning: "Companies House did not return a profile for the matched company number.",
          submitted,
          companiesHouse: null,
        };
      } else {
        const chSummary = {
          companyNumber: ch.company_number,
          companyName: ch.company_name,
          address: formatChAddress(ch),
          postcode: ch.registered_office_address?.postal_code,
          status: ch.company_status,
          sicCodes: ch.sic_codes,
        };
        const ai = await aiCompare(submitted, chSummary);
        result = {
          verdict: ai.verdict,
          reasoning: ai.reasoning,
          submitted,
          companiesHouse: chSummary,
        };
      }
    }
  } catch (err) {
    result = {
      verdict: "ERROR",
      reasoning: "AI verification could not be completed. Please run it again or review manually.",
      submitted,
      companiesHouse: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  await db
    .update(traderProfilesTable)
    .set({
      aiVerificationStatus: result.verdict,
      aiVerificationData: result,
      aiVerificationCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(traderProfilesTable.userId, profile.userId));

  await logAudit({
    userId: profile.userId,
    action: "AI_VERIFICATION_RAN",
    performedBy: options.performedBy ?? null,
    details: { source: options.source, verdict: result.verdict },
    notes: `[${options.source}] Verdict: ${result.verdict}. ${result.reasoning}`,
  });

  return result;
}

/** Fire-and-forget wrapper for use during status transitions. */
export function triggerAiVerification(
  profile: Pick<TraderProfile, "userId" | "businessName" | "businessAddress" | "town" | "postcode">,
): void {
  void runAiVerification(profile, { source: "AUTO_UNDER_REVIEW" }).catch((err) => {
    // The inner runAiVerification persists ERROR verdicts; reaching this catch
    // means the persistence/audit step itself failed. Log so we don't fail silently.
    console.error("[trader-ai-verification] background failure for user", profile.userId, err);
  });
}
