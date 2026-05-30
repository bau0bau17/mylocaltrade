import { db } from "@workspace/db";
import { traderProfilesTable, type TraderProfile } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "./trader-status";
import { getCompanyProfile, formatChAddress } from "./companies-house";
import { lookupVatNumber, normaliseVatNumber } from "./hmrc-vat";

export type RegisterCheckSource = "AUTO_UNDER_REVIEW" | "ADMIN_MANUAL" | "SIGNUP";

export type CompanyCheckStatus =
  | "MATCH"
  | "NAME_MISMATCH"
  | "INACTIVE"
  | "NOT_FOUND"
  | "INVALID"
  | "NOT_PROVIDED"
  | "ERROR";

export type VatCheckStatus =
  | "MATCH"
  | "NAME_MISMATCH"
  | "NOT_FOUND"
  | "INVALID"
  | "NOT_PROVIDED"
  | "ERROR";

export type RegisterCheckOverall = "PASS" | "REVIEW" | "FAIL" | "NOT_PROVIDED" | "ERROR";

export interface RegisterCheckResult {
  overall: RegisterCheckOverall;
  company: {
    submittedNumber: string | null;
    status: CompanyCheckStatus;
    detail: string;
    companiesHouse: {
      companyNumber?: string;
      companyName?: string;
      status?: string;
      address?: string;
      postcode?: string;
    } | null;
  };
  vat: {
    submittedNumber: string | null;
    status: VatCheckStatus;
    detail: string;
    hmrc: {
      vatNumber?: string;
      name?: string;
      address?: string;
    } | null;
  };
  error?: string;
}

/** Loose name comparison: identical, or one is a prefix of the other after
 *  stripping punctuation/case. Mirrors the alignment logic used at signup. */
function namesAlign(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) =>
    (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

async function checkCompany(
  rawNumber: string | null,
  businessName: string,
): Promise<RegisterCheckResult["company"]> {
  const submittedNumber = rawNumber?.trim().toUpperCase() || null;
  if (!submittedNumber) {
    return {
      submittedNumber: null,
      status: "NOT_PROVIDED",
      detail: "No company number supplied — sole traders are not required to provide one.",
      companiesHouse: null,
    };
  }
  if (!/^[A-Z0-9]{6,10}$/.test(submittedNumber)) {
    return {
      submittedNumber,
      status: "INVALID",
      detail: "The submitted company number is not a valid Companies House number format.",
      companiesHouse: null,
    };
  }
  try {
    const ch = await getCompanyProfile(submittedNumber);
    if (!ch?.company_number) {
      return {
        submittedNumber,
        status: "NOT_FOUND",
        detail: "Companies House has no record for this company number.",
        companiesHouse: null,
      };
    }
    const chSummary = {
      companyNumber: ch.company_number,
      companyName: ch.company_name,
      status: ch.company_status,
      address: formatChAddress(ch),
      postcode: ch.registered_office_address?.postal_code,
    };
    const isActive = (ch.company_status ?? "").toLowerCase() === "active";
    if (!isActive) {
      return {
        submittedNumber,
        status: "INACTIVE",
        detail: `Companies House lists this company as "${ch.company_status ?? "unknown"}", not active.`,
        companiesHouse: chSummary,
      };
    }
    if (!namesAlign(businessName, ch.company_name)) {
      return {
        submittedNumber,
        status: "NAME_MISMATCH",
        detail: "The company number resolves to a real, active company, but the submitted business name does not align with the registered name.",
        companiesHouse: chSummary,
      };
    }
    return {
      submittedNumber,
      status: "MATCH",
      detail: "The company number matches an active Companies House record whose name aligns with the submitted business name.",
      companiesHouse: chSummary,
    };
  } catch (err) {
    return {
      submittedNumber,
      status: "ERROR",
      detail: "Could not reach Companies House to validate the company number.",
      companiesHouse: null,
    };
  }
}

async function checkVat(
  rawNumber: string | null,
  businessName: string,
): Promise<RegisterCheckResult["vat"]> {
  const submittedNumber = rawNumber?.trim() || null;
  if (!submittedNumber) {
    return {
      submittedNumber: null,
      status: "NOT_PROVIDED",
      detail: "No VAT number supplied.",
      hmrc: null,
    };
  }
  const normalised = normaliseVatNumber(submittedNumber);
  if (!normalised) {
    return {
      submittedNumber,
      status: "INVALID",
      detail: "The submitted VAT number is not a valid UK VAT number format.",
      hmrc: null,
    };
  }
  const result = await lookupVatNumber(submittedNumber);
  switch (result.outcome) {
    case "INVALID":
      return {
        submittedNumber: normalised,
        status: "INVALID",
        detail: "HMRC rejected the VAT number as invalid.",
        hmrc: null,
      };
    case "NOT_FOUND":
      return {
        submittedNumber: normalised,
        status: "NOT_FOUND",
        detail: "HMRC has no record for this VAT number.",
        hmrc: null,
      };
    case "ERROR":
      return {
        submittedNumber: normalised,
        status: "ERROR",
        detail: "Could not reach the HMRC VAT lookup service.",
        hmrc: null,
      };
    case "FOUND": {
      const hmrc = result.data;
      if (!namesAlign(businessName, hmrc.name)) {
        return {
          submittedNumber: normalised,
          status: "NAME_MISMATCH",
          detail: "HMRC has this VAT number on record, but the registered name does not align with the submitted business name.",
          hmrc,
        };
      }
      return {
        submittedNumber: normalised,
        status: "MATCH",
        detail: "The VAT number is registered with HMRC and the registered name aligns with the submitted business name.",
        hmrc,
      };
    }
  }
}

function rollUp(
  company: RegisterCheckResult["company"],
  vat: RegisterCheckResult["vat"],
): RegisterCheckOverall {
  const statuses = [company.status, vat.status];
  if (statuses.includes("ERROR")) return "ERROR";
  // Hard failures: a submitted identifier that's invalid, unknown to the
  // register, or belongs to an inactive company.
  const fails: (CompanyCheckStatus | VatCheckStatus)[] = ["INVALID", "NOT_FOUND", "INACTIVE"];
  if (statuses.some((s) => fails.includes(s))) return "FAIL";
  // Name mismatches warrant a manual look.
  if (statuses.includes("NAME_MISMATCH")) return "REVIEW";
  // Nothing to check at all.
  if (company.status === "NOT_PROVIDED" && vat.status === "NOT_PROVIDED") return "NOT_PROVIDED";
  // Anything that did resolve, resolved cleanly.
  return "PASS";
}

export async function runRegisterCheck(
  profile: Pick<TraderProfile, "userId" | "businessName" | "companyNumber" | "vatNumber">,
  options: { source: RegisterCheckSource; performedBy?: number | null } = { source: "AUTO_UNDER_REVIEW" },
): Promise<RegisterCheckResult> {
  let result: RegisterCheckResult;
  try {
    const [company, vat] = await Promise.all([
      checkCompany(profile.companyNumber, profile.businessName),
      checkVat(profile.vatNumber, profile.businessName),
    ]);
    result = { overall: rollUp(company, vat), company, vat };
  } catch (err) {
    result = {
      overall: "ERROR",
      company: { submittedNumber: profile.companyNumber ?? null, status: "ERROR", detail: "Register check failed.", companiesHouse: null },
      vat: { submittedNumber: profile.vatNumber ?? null, status: "ERROR", detail: "Register check failed.", hmrc: null },
      error: err instanceof Error ? err.message : String(err),
    };
  }

  await db
    .update(traderProfilesTable)
    .set({
      registerCheckStatus: result.overall,
      registerCheckData: result,
      registerCheckCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(traderProfilesTable.userId, profile.userId));

  await logAudit({
    userId: profile.userId,
    action: "REGISTER_CHECK_RAN",
    performedBy: options.performedBy ?? null,
    details: {
      source: options.source,
      overall: result.overall,
      company: result.company.status,
      vat: result.vat.status,
    },
    notes: `[${options.source}] Register check: ${result.overall} (company ${result.company.status}, VAT ${result.vat.status}).`,
  });

  return result;
}

/** Fire-and-forget wrapper for use during status transitions. */
export function triggerRegisterCheck(
  profile: Pick<TraderProfile, "userId" | "businessName" | "companyNumber" | "vatNumber">,
): void {
  void runRegisterCheck(profile, { source: "AUTO_UNDER_REVIEW" }).catch((err) => {
    console.error("[register-check] background failure for user", profile.userId, err);
  });
}
