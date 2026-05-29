import { db } from "@workspace/db";
import { traderProfilesTable, type TraderProfile } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "./trader-status";
import {
  searchCompanyTopHit,
  getCompanyProfile,
  formatChAddress,
} from "./companies-house";

export type AiVerificationSource = "AUTO_UNDER_REVIEW" | "ADMIN_MANUAL";

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

/**
 * Reset any previously stored Companies House cross-check so a stale historical
 * verdict (e.g. an old NOT_FOUND) cannot bias a reviewer after a run that
 * intentionally no-ops (sole trader / no confirmable company match).
 */
async function clearAiVerification(
  snapshot: Pick<TraderProfile, "userId" | "companyNumber" | "businessRole">,
): Promise<void> {
  // Concurrency guard: only clear if the company number / role still match the
  // values this run started from. Otherwise a newer run (kicked off by an edit)
  // owns the state and this slower stale run must not wipe it.
  const [current] = await db
    .select({
      companyNumber: traderProfilesTable.companyNumber,
      businessRole: traderProfilesTable.businessRole,
    })
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.userId, snapshot.userId))
    .limit(1);
  if (
    (current?.companyNumber ?? "").trim() !== (snapshot.companyNumber ?? "").trim() ||
    (current?.businessRole ?? "") !== (snapshot.businessRole ?? "")
  ) {
    return;
  }
  await db
    .update(traderProfilesTable)
    .set({
      aiVerificationStatus: null,
      aiVerificationData: null,
      aiVerificationCheckedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(traderProfilesTable.userId, snapshot.userId));
}

export async function runAiVerification(
  profile: Pick<TraderProfile, "userId" | "businessName" | "businessAddress" | "town" | "postcode" | "companyNumber" | "businessRole">,
  options: { source: AiVerificationSource; performedBy?: number | null } = { source: "AUTO_UNDER_REVIEW" },
): Promise<AiVerificationResult | null> {
  const suppliedNumber = profile.companyNumber?.replace(/\s+/g, "") || undefined;

  // Sole traders / self-employed people are first-class and legitimately have no
  // company on Companies House. When no company number was supplied there is
  // nothing precise to look up, so we no-op rather than persist a misleading
  // NOT_FOUND advisory against them. We still attempt a name search below to
  // OPPORTUNISTICALLY find a match, but a miss is treated as neutral (no-op),
  // never a penalty — because we cannot distinguish a genuine sole trader from a
  // mistyped business name. A NOT_FOUND is only ever recorded when a trader has
  // explicitly supplied a company number that does not exist on the register.
  if (!suppliedNumber && profile.businessRole === "SELF_EMPLOYED") {
    await clearAiVerification(profile);
    return null;
  }

  const submitted = {
    businessName: profile.businessName,
    address: [profile.businessAddress, profile.town].filter(Boolean).join(", "),
    postcode: profile.postcode,
  };

  let result: AiVerificationResult;
  try {
    // Prefer a direct lookup against the official register using the company
    // number the trader supplied — this is far more precise than a name search.
    // Fall back to a name search only when no number was provided.
    let companyNumber: string | undefined = suppliedNumber;
    if (!companyNumber) {
      const hit = await searchCompanyTopHit(profile.businessName);
      companyNumber = hit?.company_number ?? undefined;
    }
    if (!companyNumber) {
      // No supplied number and no name-search match: neutral no-op, not a
      // penalty. Clear any stale prior verdict so old results cannot mislead.
      await clearAiVerification(profile);
      return null;
    } else {
      const ch = await getCompanyProfile(companyNumber);
      if (!ch) {
        if (!suppliedNumber) {
          // The name search pointed at a number that no longer resolves; treat
          // as a neutral miss rather than a penalty against an unconfirmed name.
          await clearAiVerification(profile);
          return null;
        }
        result = {
          verdict: "NOT_FOUND",
          reasoning: "Companies House has no company registered with the supplied company number.",
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

  // Concurrency guard: if the trader changed their company number or business
  // role while this check was running, skip the write so a slower stale run
  // cannot clobber a newer verdict.
  const [current] = await db
    .select({
      companyNumber: traderProfilesTable.companyNumber,
      businessRole: traderProfilesTable.businessRole,
    })
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.userId, profile.userId))
    .limit(1);
  if (
    (current?.companyNumber ?? "").trim() !== (profile.companyNumber ?? "").trim() ||
    (current?.businessRole ?? "") !== (profile.businessRole ?? "")
  ) {
    return result;
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
  profile: Pick<TraderProfile, "userId" | "businessName" | "businessAddress" | "town" | "postcode" | "companyNumber" | "businessRole">,
): void {
  void runAiVerification(profile, { source: "AUTO_UNDER_REVIEW" }).catch((err) => {
    // The inner runAiVerification persists ERROR verdicts; reaching this catch
    // means the persistence/audit step itself failed. Log so we don't fail silently.
    console.error("[trader-ai-verification] background failure for user", profile.userId, err);
  });
}
