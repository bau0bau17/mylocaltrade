import { db } from "@workspace/db";
import { traderProfilesTable, type TraderProfile } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import dns from "node:dns/promises";
import { logAudit } from "./trader-status";

export type DomainCheckSource = "AUTO_UNDER_REVIEW" | "ADMIN_MANUAL";

export interface DomainCheckResult {
  verdict: "RESOLVES_MATCHES_WEBSITE" | "RESOLVES" | "NO_MAIL_RECORDS" | "NOT_RESOLVED" | "ERROR";
  reasoning: string;
  domain: string;
  hasMailRecords: boolean;
  matchesWebsite: boolean | null;
  error?: string;
}

/** Reduce a raw host/url/domain to a bare lowercase registrable host. */
export function extractDomain(raw: string): string {
  let host = raw.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, "");
  host = host.replace(/^www\./, "");
  host = host.split("/")[0];
  host = host.split("@").pop() ?? host;
  host = host.split(":")[0];
  return host;
}

async function hasMx(domain: string): Promise<boolean> {
  try {
    const mx = await dns.resolveMx(domain);
    if (mx.length > 0) return true;
  } catch {
    // fall through to A/AAAA — a domain with an A record can still be valid
  }
  try {
    const a = await dns.resolve4(domain);
    if (a.length > 0) return true;
  } catch {
    /* no A record */
  }
  return false;
}

export async function runDomainCheck(
  profile: Pick<TraderProfile, "userId" | "businessEmailDomain" | "website">,
  options: { source: DomainCheckSource; performedBy?: number | null } = { source: "AUTO_UNDER_REVIEW" },
): Promise<DomainCheckResult | null> {
  const raw = profile.businessEmailDomain?.trim();
  // No business email domain declared — this trust signal is optional and never
  // required, so there is simply nothing to check. Clear any stale prior verdict
  // so an old result cannot mislead a reviewer.
  if (!raw) {
    // Concurrency guard: only clear if the domain is still absent in the DB. If a
    // newer edit added one, a fresher run owns the state — don't wipe it.
    const [current] = await db
      .select({ businessEmailDomain: traderProfilesTable.businessEmailDomain })
      .from(traderProfilesTable)
      .where(eq(traderProfilesTable.userId, profile.userId))
      .limit(1);
    if ((current?.businessEmailDomain ?? "").trim() === (profile.businessEmailDomain ?? "").trim()) {
      await db
        .update(traderProfilesTable)
        .set({
          domainVerificationStatus: null,
          domainVerificationData: null,
          domainVerificationCheckedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(traderProfilesTable.userId, profile.userId));
    }
    return null;
  }

  const domain = extractDomain(raw);
  let result: DomainCheckResult;
  try {
    if (!domain || !domain.includes(".")) {
      result = {
        verdict: "NOT_RESOLVED",
        reasoning: "The declared business email domain is not a valid domain.",
        domain,
        hasMailRecords: false,
        matchesWebsite: null,
      };
    } else {
      const hasMailRecords = await hasMx(domain);
      const websiteDomain = profile.website ? extractDomain(profile.website) : null;
      const matchesWebsite = websiteDomain ? websiteDomain === domain : null;
      if (!hasMailRecords) {
        // Distinguish a non-resolving domain from one that resolves but cannot
        // be confirmed to receive mail. We treat any A/MX hit as "resolves".
        result = {
          verdict: "NOT_RESOLVED",
          reasoning: "The business email domain does not resolve to any mail or address records.",
          domain,
          hasMailRecords: false,
          matchesWebsite,
        };
      } else if (matchesWebsite) {
        result = {
          verdict: "RESOLVES_MATCHES_WEBSITE",
          reasoning: "The business email domain resolves and matches the business website domain.",
          domain,
          hasMailRecords: true,
          matchesWebsite: true,
        };
      } else {
        result = {
          verdict: "RESOLVES",
          reasoning:
            websiteDomain === null
              ? "The business email domain resolves and can receive mail. No website was provided to compare against."
              : "The business email domain resolves and can receive mail, but does not match the website domain.",
          domain,
          hasMailRecords: true,
          matchesWebsite,
        };
      }
    }
  } catch (err) {
    result = {
      verdict: "ERROR",
      reasoning: "The domain check could not be completed. Please run it again or review manually.",
      domain,
      hasMailRecords: false,
      matchesWebsite: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Concurrency guard: if the trader changed their email domain or website while
  // this check was running, skip the write so a slower stale run cannot clobber
  // a newer verdict.
  const [current] = await db
    .select({
      businessEmailDomain: traderProfilesTable.businessEmailDomain,
      website: traderProfilesTable.website,
    })
    .from(traderProfilesTable)
    .where(eq(traderProfilesTable.userId, profile.userId))
    .limit(1);
  if (
    (current?.businessEmailDomain ?? "").trim() !== (profile.businessEmailDomain ?? "").trim() ||
    (current?.website ?? "").trim() !== (profile.website ?? "").trim()
  ) {
    return result;
  }

  await db
    .update(traderProfilesTable)
    .set({
      domainVerificationStatus: result.verdict,
      domainVerificationData: result,
      domainVerificationCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(traderProfilesTable.userId, profile.userId));

  await logAudit({
    userId: profile.userId,
    action: "DOMAIN_VERIFICATION_RAN",
    performedBy: options.performedBy ?? null,
    details: { source: options.source, verdict: result.verdict },
    notes: `[${options.source}] Domain verdict: ${result.verdict}. ${result.reasoning}`,
  });

  return result;
}

/** Fire-and-forget wrapper for use during status transitions. */
export function triggerDomainCheck(
  profile: Pick<TraderProfile, "userId" | "businessEmailDomain" | "website">,
): void {
  void runDomainCheck(profile, { source: "AUTO_UNDER_REVIEW" }).catch((err) => {
    console.error("[domain-check] background failure for user", profile.userId, err);
  });
}
