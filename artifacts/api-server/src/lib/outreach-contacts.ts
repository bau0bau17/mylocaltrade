import { and, eq, exists, inArray, isNull, notExists, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  earlyAccessRegistrationsTable,
  outreachContactsTable,
  outreachSuppressionsTable,
  OUTREACH_BUSINESS_TYPES,
  OUTREACH_LAWFUL_ROUTES,
  type OutreachBusinessType,
  type OutreachLawfulRoute,
  type OutreachEligibilityCategory,
} from "@workspace/db/schema";

/**
 * Outreach Contacts engine: server-side lawful-eligibility evaluation, CSV
 * template/parsing/validation and cross-list dedupe.
 *
 * INVARIANTS (UK GDPR / PECR):
 * - A publicly available email address is NEVER treated as consent.
 * - Eligibility is ALWAYS computed here from stored evidence — the client
 *   can never assert eligibility, and there is NO admin override that turns
 *   an unknown/unverified contact into an eligible one.
 * - Sole traders, ordinary partnerships and individuals are individual
 *   subscribers under PECR: BLOCKED without valid consent or a fully
 *   evidenced soft opt-in.
 * - The corporate B2B route applies ONLY to verified corporate subscribers
 *   (Ltd/LLP) with stored company evidence, relevance/purpose and a
 *   documented legitimate-interest assessment.
 * - A consent-request email is NOT a workaround: it is itself direct
 *   marketing, so no such flow exists anywhere in this system.
 * - This software records and enforces the operator's decisions; it does
 *   not provide legal advice or guarantee compliance.
 */

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export type EligibilityInput = {
  businessType: OutreachBusinessType;
  lawfulRoute: OutreachLawfulRoute;
  companyNumber: string | null;
  sourceName: string;
  sourceDetail: string;
  consentAt: Date | null;
  consentEvidence: string | null;
  soiSaleEvidence: string | null;
  soiRelevanceEvidence: string | null;
  soiOptOutEvidence: string | null;
  b2bCompanyEvidence: string | null;
  b2bRelevanceEvidence: string | null;
  b2bLiaEvidence: string | null;
  unsubscribedAt?: Date | null;
  emailSuppressedAt?: Date | null;
};

export type EligibilityVerdict = {
  status: "eligible" | "blocked";
  category: OutreachEligibilityCategory;
  reason: string;
};

/** Evidence must be substantive — a tick or "yes" is not evidence. */
const MIN_EVIDENCE_LENGTH = 15;

function hasEvidence(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length >= MIN_EVIDENCE_LENGTH;
}

/** UK Companies House number: 8 digits or 2-letter prefix + 6 digits. */
export function looksLikeCompanyNumber(value: string | null): boolean {
  if (!value) return false;
  return /^([A-Za-z]{2}\d{6}|\d{8})$/.test(value.trim());
}

function individualCategory(
  businessType: OutreachBusinessType,
): OutreachEligibilityCategory {
  return businessType === "unknown"
    ? "UNKNOWN_OR_UNVERIFIED"
    : businessType === "limited_company" || businessType === "llp"
      ? "CORPORATE_B2B"
      : "SOLE_TRADER_OR_INDIVIDUAL";
}

/**
 * The ONLY place an outreach contact's lawful eligibility is decided.
 * Pure function — callable at import, edit, preview, queue and send time so
 * every stage re-checks the same rules against the LIVE stored evidence.
 */
export function evaluateOutreachEligibility(
  input: EligibilityInput,
): EligibilityVerdict {
  // Opt-outs and deliverability suppression override every route.
  if (input.unsubscribedAt) {
    return {
      status: "blocked",
      category: individualCategory(input.businessType),
      reason: "Unsubscribed or objected — permanently excluded from marketing.",
    };
  }
  if (input.emailSuppressedAt) {
    return {
      status: "blocked",
      category: individualCategory(input.businessType),
      reason: "Email suppressed (bounce/complaint/block) — cannot be contacted.",
    };
  }

  switch (input.lawfulRoute) {
    case "confirmed_consent": {
      const missing: string[] = [];
      if (!input.consentAt || Number.isNaN(input.consentAt.getTime()))
        missing.push("consent date");
      else if (input.consentAt.getTime() > Date.now())
        missing.push("consent date (cannot be in the future)");
      if (!hasEvidence(input.consentEvidence))
        missing.push("consent evidence incl. exact wording");
      if (!input.sourceName.trim() || !input.sourceDetail.trim())
        missing.push("consent source");
      if (missing.length > 0) {
        return {
          status: "blocked",
          category: individualCategory(input.businessType),
          reason: `Consent route claimed but incomplete: missing ${missing.join(", ")}. Incomplete consent is no consent.`,
        };
      }
      return {
        status: "eligible",
        category: "CONFIRMED_CONSENT",
        reason: "Valid consent evidence, date, wording and source stored.",
      };
    }

    case "soft_opt_in": {
      const missing: string[] = [];
      if (!hasEvidence(input.soiSaleEvidence))
        missing.push("evidence the address was obtained directly during a sale or genuine negotiation");
      if (!hasEvidence(input.soiRelevanceEvidence))
        missing.push("evidence the campaign concerns similar MyLocalTrade services");
      if (!hasEvidence(input.soiOptOutEvidence))
        missing.push("evidence an opt-out was offered when collected");
      if (missing.length > 0) {
        return {
          status: "blocked",
          category: individualCategory(input.businessType),
          reason: `Soft opt-in claimed but not fully evidenced: missing ${missing.join("; ")}.`,
        };
      }
      return {
        status: "eligible",
        category: "EXISTING_CUSTOMER_SOFT_OPT_IN",
        reason:
          "Soft opt-in fully evidenced (collected during sale/negotiation, similar services, opt-out offered at collection and in every email).",
      };
    }

    case "corporate_b2b": {
      if (input.businessType !== "limited_company" && input.businessType !== "llp") {
        return {
          status: "blocked",
          category: individualCategory(input.businessType),
          reason:
            input.businessType === "unknown"
              ? "Corporate B2B route requires a VERIFIED corporate subscriber — business type is unknown/unverified."
              : "Corporate B2B route applies only to Limited companies and LLPs. Sole traders, partnerships and individuals need consent or a fully evidenced soft opt-in.",
        };
      }
      const missing: string[] = [];
      if (!looksLikeCompanyNumber(input.companyNumber))
        missing.push("a valid Companies House number");
      if (!hasEvidence(input.b2bCompanyEvidence))
        missing.push("company verification evidence");
      if (!hasEvidence(input.b2bRelevanceEvidence))
        missing.push("relevance/purpose evidence");
      if (!hasEvidence(input.b2bLiaEvidence))
        missing.push("a documented legitimate-interest assessment");
      if (missing.length > 0) {
        return {
          status: "blocked",
          category: "CORPORATE_B2B",
          reason: `Corporate B2B route claimed but incomplete: missing ${missing.join(", ")}.`,
        };
      }
      return {
        status: "eligible",
        category: "CORPORATE_B2B",
        reason:
          "Verified corporate subscriber (Ltd/LLP) with company evidence, relevance/purpose and documented legitimate-interest assessment. Named corporate addresses remain personal data — objection rights always honoured.",
      };
    }

    case "none":
    default:
      return {
        status: "blocked",
        category: individualCategory(input.businessType),
        reason:
          input.businessType === "unknown"
            ? "Unknown or unverified contact — blocked. No lawful marketing route claimed."
            : "No lawful marketing route claimed. A publicly available email address is not consent.",
      };
  }
}

// ---------------------------------------------------------------------------
// Campaign audience (outreach) — mirrors the Early Access audience helpers,
// but ALWAYS re-evaluates evidence live and applies cross-list dedupe.
// ---------------------------------------------------------------------------

const oc = outreachContactsTable;
const osup = outreachSuppressionsTable;
const ea = earlyAccessRegistrationsTable;

export function contactToEligibilityInput(contact: {
  businessType: string;
  lawfulRoute: string;
  companyNumber: string | null;
  sourceName: string;
  sourceDetail: string;
  consentAt: Date | null;
  consentEvidence: string | null;
  soiSaleEvidence: string | null;
  soiRelevanceEvidence: string | null;
  soiOptOutEvidence: string | null;
  b2bCompanyEvidence: string | null;
  b2bRelevanceEvidence: string | null;
  b2bLiaEvidence: string | null;
  unsubscribedAt: Date | null;
  emailSuppressedAt: Date | null;
}): EligibilityInput {
  return {
    businessType: (OUTREACH_BUSINESS_TYPES as readonly string[]).includes(
      contact.businessType,
    )
      ? (contact.businessType as OutreachBusinessType)
      : "unknown",
    lawfulRoute: (OUTREACH_LAWFUL_ROUTES as readonly string[]).includes(
      contact.lawfulRoute,
    )
      ? (contact.lawfulRoute as OutreachLawfulRoute)
      : "none",
    companyNumber: contact.companyNumber,
    sourceName: contact.sourceName,
    sourceDetail: contact.sourceDetail,
    consentAt: contact.consentAt,
    consentEvidence: contact.consentEvidence,
    soiSaleEvidence: contact.soiSaleEvidence,
    soiRelevanceEvidence: contact.soiRelevanceEvidence,
    soiOptOutEvidence: contact.soiOptOutEvidence,
    b2bCompanyEvidence: contact.b2bCompanyEvidence,
    b2bRelevanceEvidence: contact.b2bRelevanceEvidence,
    b2bLiaEvidence: contact.b2bLiaEvidence,
    unsubscribedAt: contact.unsubscribedAt,
    emailSuppressedAt: contact.emailSuppressedAt,
  };
}

/** SQL pre-filter for outreach sendability (evidence re-check happens in JS). */
function outreachSendableCondition() {
  return and(
    eq(oc.eligibilityStatus, "eligible"),
    isNull(oc.unsubscribedAt),
    isNull(oc.emailSuppressedAt),
    notExists(
      db
        .select({ one: sql`1` })
        .from(osup)
        .where(eq(osup.emailNormalized, oc.emailNormalized)),
    ),
    // Cross-list dedupe: an address on the Early Access list is governed by
    // that list's consent state and must never be contacted via outreach.
    notExists(
      db
        .select({ one: sql`1` })
        .from(ea)
        .where(eq(ea.emailNormalized, oc.emailNormalized)),
    ),
  )!;
}

/**
 * Eligible outreach contacts for preview/queue. The stored eligibility flag
 * is only a pre-filter — every returned contact has been RE-EVALUATED from
 * its stored evidence at call time, so a rule change or edited evidence is
 * always enforced even against an old import.
 */
export async function selectEligibleOutreachContacts(
  executor: Pick<typeof db, "select">,
) {
  const rows = await executor
    .select()
    .from(oc)
    .where(outreachSendableCondition())
    .orderBy(oc.id);
  return rows
    .filter(
      (row) =>
        evaluateOutreachEligibility(contactToEligibilityInput(row)).status ===
        "eligible",
    )
    .map((row) => ({
      id: row.id,
      name: row.contactName ?? row.companyName ?? "",
      emailNormalized: row.emailNormalized,
      sourceName: row.sourceName,
      sourceDetail: row.sourceDetail,
    }));
}

export type OutreachAudienceBreakdown = {
  eligible: number;
  excludedBlocked: number;
  excludedUnsubscribedOrSuppressed: number;
  excludedOnSuppressionList: number;
  excludedEarlyAccessDuplicate: number;
  /** Passed the SQL pre-filter but failed the live evidence re-evaluation. */
  excludedByLiveRecheck: number;
  total: number;
};

/** Server-side outreach audience calculation — the ONLY recipient count source. */
export async function computeOutreachAudience(): Promise<OutreachAudienceBreakdown> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      excludedBlocked: sql<number>`count(*) filter (where ${oc.eligibilityStatus} = 'blocked' and ${oc.unsubscribedAt} is null and ${oc.emailSuppressedAt} is null)::int`,
      excludedUnsubscribedOrSuppressed: sql<number>`count(*) filter (where ${oc.unsubscribedAt} is not null or ${oc.emailSuppressedAt} is not null)::int`,
      preFiltered: sql<number>`count(*) filter (where ${outreachSendableCondition()})::int`,
      // NOTE: the correlated EXISTS conditions MUST be built with the
      // drizzle exists()/notExists() builders — hand-written `exists
      // (select 1 from ${table} where ${col} = ${col})` renders the inner
      // column unqualified, silently de-correlating the subquery.
      excludedOnSuppressionList: sql<number>`count(*) filter (where ${and(
        eq(oc.eligibilityStatus, "eligible"),
        isNull(oc.unsubscribedAt),
        isNull(oc.emailSuppressedAt),
        exists(
          db
            .select({ one: sql`1` })
            .from(osup)
            .where(eq(osup.emailNormalized, oc.emailNormalized)),
        ),
      )})::int`,
      excludedEarlyAccessDuplicate: sql<number>`count(*) filter (where ${and(
        eq(oc.eligibilityStatus, "eligible"),
        isNull(oc.unsubscribedAt),
        isNull(oc.emailSuppressedAt),
        notExists(
          db
            .select({ one: sql`1` })
            .from(osup)
            .where(eq(osup.emailNormalized, oc.emailNormalized)),
        ),
        exists(
          db
            .select({ one: sql`1` })
            .from(ea)
            .where(eq(ea.emailNormalized, oc.emailNormalized)),
        ),
      )})::int`,
    })
    .from(oc);
  const eligibleRows = await selectEligibleOutreachContacts(db);
  return {
    eligible: eligibleRows.length,
    excludedBlocked: row.excludedBlocked,
    excludedUnsubscribedOrSuppressed: row.excludedUnsubscribedOrSuppressed,
    excludedOnSuppressionList: row.excludedOnSuppressionList,
    excludedEarlyAccessDuplicate: row.excludedEarlyAccessDuplicate,
    excludedByLiveRecheck: row.preFiltered - eligibleRows.length,
    total: row.total,
  };
}

// ---------------------------------------------------------------------------
// CSV template / parsing / validation
// ---------------------------------------------------------------------------

export const OUTREACH_CSV_COLUMNS = [
  "email",
  "contact_name",
  "company_name",
  "business_type",
  "company_number",
  "website",
  "source_name",
  "source_detail",
  "date_obtained",
  "country",
  "lawful_route",
  "consent_date",
  "consent_evidence",
  "soi_sale_evidence",
  "soi_relevance_evidence",
  "soi_opt_out_evidence",
  "b2b_company_evidence",
  "b2b_relevance_evidence",
  "b2b_lia_evidence",
  "notes",
] as const;

export const OUTREACH_IMPORT_MAX_ROWS = 1000;
export const OUTREACH_CSV_MAX_BYTES = 800 * 1024;

/**
 * Cells beginning with =, +, -, @ (or tab/CR variants) can execute as
 * formulas when a CSV is opened in a spreadsheet. Every EXPORTED cell is
 * neutralised with a leading apostrophe; imports may CONTAIN such values
 * (they are stored verbatim and rendered as inert text everywhere).
 */
export function csvCell(value: string | null | undefined): string {
  const raw = (value ?? "").replace(/\r?\n/g, " ");
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function outreachCsvTemplate(): string {
  const header = OUTREACH_CSV_COLUMNS.join(",");
  const exampleB2b = [
    "info@example-ltd.co.uk",
    "Jane Smith",
    "Example Trades Ltd",
    "limited_company",
    "12345678",
    "https://example-ltd.co.uk",
    "Companies House + company website",
    "https://find-and-update.company-information.service.gov.uk/company/12345678",
    "2026-08-01",
    "United Kingdom",
    "corporate_b2b",
    "",
    "",
    "",
    "",
    "",
    "Verified on Companies House register 2026-08-01, active status, matches website",
    "UK trade business relevant to MyLocalTrade trader recruitment",
    "LIA documented 2026-08-01 (ref LIA-001): balancing test passed for one B2B recruitment message with clear opt-out",
    "",
  ]
    .map((v) => csvCell(v))
    .join(",");
  const exampleConsent = [
    "owner@example-plumbing.co.uk",
    "Sam Jones",
    "Example Plumbing",
    "sole_trader",
    "",
    "",
    "In-person signup at trade show",
    "Signed consent form, NEC trade show stand 42",
    "2026-07-15",
    "United Kingdom",
    "confirmed_consent",
    "2026-07-15",
    "Signed form: 'Email me about MyLocalTrade trader services and launch offers' — form scanned, ref TS-0715-042",
    "",
    "",
    "",
    "",
    "",
    "",
    "Met at trade show",
  ]
    .map((v) => csvCell(v))
    .join(",");
  return `${header}\n${exampleB2b}\n${exampleConsent}\n`;
}

/**
 * Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). Returns null
 * for structurally malformed input (unterminated quote). No formula
 * evaluation, no prototype tricks — plain string cells only.
 */
export function parseCsv(text: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (cell.length > 0) return null; // quote opening mid-cell = malformed
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (inQuotes) return null; // unterminated quote
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Drop fully empty trailing rows.
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type ParsedContactRow = {
  email: string;
  emailNormalized: string;
  contactName: string | null;
  companyName: string | null;
  businessType: OutreachBusinessType;
  companyNumber: string | null;
  website: string | null;
  sourceName: string;
  sourceDetail: string;
  obtainedAt: Date;
  country: string;
  lawfulRoute: OutreachLawfulRoute;
  consentAt: Date | null;
  consentEvidence: string | null;
  soiSaleEvidence: string | null;
  soiRelevanceEvidence: string | null;
  soiOptOutEvidence: string | null;
  b2bCompanyEvidence: string | null;
  b2bRelevanceEvidence: string | null;
  b2bLiaEvidence: string | null;
  notes: string | null;
};

export type RowIssue = { field: string; problem: string };

function parseDateOnly(value: string): Date | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Reject rollovers such as 2026-02-31.
  if (date.toISOString().slice(0, 10) !== trimmed) return null;
  return date;
}

function opt(value: string | undefined, max: number): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * Validate ONE contact record (CSV row or manual form — identical rules).
 * Returns the typed row or the exact list of field problems.
 */
export function parseContactFields(
  fields: Record<string, string | undefined>,
): { row: ParsedContactRow; issues: [] } | { row: null; issues: RowIssue[] } {
  const issues: RowIssue[] = [];

  const email = (fields.email ?? "").trim();
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    issues.push({ field: "email", problem: "Invalid email address." });
  }

  const businessTypeRaw = (fields.business_type ?? "").trim().toLowerCase();
  const businessType = OUTREACH_BUSINESS_TYPES.includes(
    businessTypeRaw as OutreachBusinessType,
  )
    ? (businessTypeRaw as OutreachBusinessType)
    : null;
  if (!businessType) {
    issues.push({
      field: "business_type",
      problem: `Must be one of: ${OUTREACH_BUSINESS_TYPES.join(", ")}.`,
    });
  }

  const lawfulRouteRaw = (fields.lawful_route ?? "none").trim().toLowerCase() || "none";
  const lawfulRoute = OUTREACH_LAWFUL_ROUTES.includes(
    lawfulRouteRaw as OutreachLawfulRoute,
  )
    ? (lawfulRouteRaw as OutreachLawfulRoute)
    : null;
  if (!lawfulRoute) {
    issues.push({
      field: "lawful_route",
      problem: `Must be one of: ${OUTREACH_LAWFUL_ROUTES.join(", ")}.`,
    });
  }

  const sourceName = (fields.source_name ?? "").trim();
  if (!sourceName) {
    issues.push({ field: "source_name", problem: "Source name is required." });
  }
  const sourceDetail = (fields.source_detail ?? "").trim();
  if (!sourceDetail) {
    issues.push({
      field: "source_detail",
      problem: "Exact source URL or description is required.",
    });
  }

  const obtainedAt = parseDateOnly(fields.date_obtained ?? "");
  if (!obtainedAt) {
    issues.push({
      field: "date_obtained",
      problem: "Date obtained is required (YYYY-MM-DD).",
    });
  } else if (obtainedAt.getTime() > Date.now()) {
    issues.push({ field: "date_obtained", problem: "Cannot be in the future." });
  }

  const country = (fields.country ?? "").trim();
  if (!country) {
    issues.push({ field: "country", problem: "Country is required." });
  }

  let consentAt: Date | null = null;
  const consentDateRaw = (fields.consent_date ?? "").trim();
  if (consentDateRaw) {
    consentAt = parseDateOnly(consentDateRaw);
    if (!consentAt) {
      issues.push({ field: "consent_date", problem: "Use YYYY-MM-DD." });
    }
  }

  const website = opt(fields.website, 300);
  if (website && !/^https?:\/\/[^\s]+\.[^\s]+/.test(website)) {
    issues.push({ field: "website", problem: "Must be an http(s) URL." });
  }

  if (issues.length > 0) return { row: null, issues };

  return {
    row: {
      email,
      emailNormalized: normalizeEmail(email),
      contactName: opt(fields.contact_name, 100),
      companyName: opt(fields.company_name, 200),
      businessType: businessType!,
      companyNumber: opt(fields.company_number, 20),
      website,
      sourceName: sourceName.slice(0, 200),
      sourceDetail: sourceDetail.slice(0, 500),
      obtainedAt: obtainedAt!,
      country: country.slice(0, 60),
      lawfulRoute: lawfulRoute!,
      consentAt,
      consentEvidence: opt(fields.consent_evidence, 5000),
      soiSaleEvidence: opt(fields.soi_sale_evidence, 5000),
      soiRelevanceEvidence: opt(fields.soi_relevance_evidence, 5000),
      soiOptOutEvidence: opt(fields.soi_opt_out_evidence, 5000),
      b2bCompanyEvidence: opt(fields.b2b_company_evidence, 5000),
      b2bRelevanceEvidence: opt(fields.b2b_relevance_evidence, 5000),
      b2bLiaEvidence: opt(fields.b2b_lia_evidence, 5000),
      notes: opt(fields.notes, 5000),
    },
    issues: [],
  };
}

export type ImportRowResult = {
  rowNumber: number;
  email: string;
  status:
    | "accepted"
    | "invalid"
    | "duplicate_in_file"
    | "duplicate_existing"
    | "duplicate_early_access"
    | "suppressed";
  /** Human-readable reason for every non-accepted row; for accepted rows,
   *  the server-computed eligibility verdict. */
  reason: string;
  eligibility?: EligibilityVerdict;
  row?: ParsedContactRow;
};

export type ImportValidation = {
  ok: boolean;
  error?: string;
  results: ImportRowResult[];
  summary: {
    total: number;
    accepted: number;
    acceptedEligible: number;
    acceptedBlocked: number;
    invalid: number;
    duplicates: number;
    suppressed: number;
  };
};

/**
 * Validate a COMPLETE import against file, list and legal rules WITHOUT
 * saving anything. Commit re-runs this and only then inserts, so a stale
 * preview can never smuggle a row past a rule that changed in between.
 */
export async function validateImport(csvText: string): Promise<ImportValidation> {
  const empty = {
    total: 0, accepted: 0, acceptedEligible: 0, acceptedBlocked: 0,
    invalid: 0, duplicates: 0, suppressed: 0,
  };
  if (Buffer.byteLength(csvText, "utf8") > OUTREACH_CSV_MAX_BYTES) {
    return { ok: false, error: "CSV is too large (max 800 KB).", results: [], summary: empty };
  }
  const parsed = parseCsv(csvText);
  if (!parsed || parsed.length === 0) {
    return { ok: false, error: "CSV is malformed or empty.", results: [], summary: empty };
  }
  const header = parsed[0].map((h) => h.trim().toLowerCase());
  const missingCols = OUTREACH_CSV_COLUMNS.filter((col) => !header.includes(col));
  if (missingCols.length > 0) {
    return {
      ok: false,
      error: `CSV header is missing required columns: ${missingCols.join(", ")}. Download the template for the exact format.`,
      results: [],
      summary: empty,
    };
  }
  const dataRows = parsed.slice(1);
  if (dataRows.length === 0) {
    return { ok: false, error: "CSV contains no data rows.", results: [], summary: empty };
  }
  if (dataRows.length > OUTREACH_IMPORT_MAX_ROWS) {
    return {
      ok: false,
      error: `Too many rows (${dataRows.length}). Import at most ${OUTREACH_IMPORT_MAX_ROWS} per file.`,
      results: [],
      summary: empty,
    };
  }

  const colIndex = new Map(header.map((h, idx) => [h, idx]));
  const results: ImportRowResult[] = [];
  const seenInFile = new Map<string, number>();
  const candidates: { rowNumber: number; row: ParsedContactRow }[] = [];

  for (let i = 0; i < dataRows.length; i += 1) {
    const rowNumber = i + 2; // 1-based + header row
    const cells = dataRows[i];
    const fields: Record<string, string | undefined> = {};
    for (const col of OUTREACH_CSV_COLUMNS) {
      const idx = colIndex.get(col)!;
      fields[col] = cells[idx];
    }
    const emailShown = (fields.email ?? "").trim().slice(0, 254);
    if (cells.length !== header.length) {
      results.push({
        rowNumber, email: emailShown, status: "invalid",
        reason: `Wrong number of columns (${cells.length}, expected ${header.length}).`,
      });
      continue;
    }
    const parsedRow = parseContactFields(fields);
    if (!parsedRow.row) {
      results.push({
        rowNumber, email: emailShown, status: "invalid",
        reason: parsedRow.issues.map((iss) => `${iss.field}: ${iss.problem}`).join(" "),
      });
      continue;
    }
    const firstRow = seenInFile.get(parsedRow.row.emailNormalized);
    if (firstRow !== undefined) {
      results.push({
        rowNumber, email: emailShown, status: "duplicate_in_file",
        reason: `Duplicate of row ${firstRow} in this file.`,
      });
      continue;
    }
    seenInFile.set(parsedRow.row.emailNormalized, rowNumber);
    candidates.push({ rowNumber, row: parsedRow.row });
  }

  // Cross-checks against existing lists, in bulk.
  const emails = candidates.map((cand) => cand.row.emailNormalized);
  const [existing, suppressions, earlyAccess] =
    emails.length === 0
      ? [[], [], []]
      : await Promise.all([
          db
            .select({ emailNormalized: outreachContactsTable.emailNormalized })
            .from(outreachContactsTable)
            .where(inArray(outreachContactsTable.emailNormalized, emails)),
          db
            .select({
              emailNormalized: outreachSuppressionsTable.emailNormalized,
              reason: outreachSuppressionsTable.reason,
            })
            .from(outreachSuppressionsTable)
            .where(inArray(outreachSuppressionsTable.emailNormalized, emails)),
          db
            .select({
              emailNormalized: earlyAccessRegistrationsTable.emailNormalized,
            })
            .from(earlyAccessRegistrationsTable)
            .where(inArray(earlyAccessRegistrationsTable.emailNormalized, emails)),
        ]);
  const existingSet = new Set(existing.map((r) => r.emailNormalized));
  const suppressionMap = new Map(suppressions.map((r) => [r.emailNormalized, r.reason]));
  const earlyAccessSet = new Set(earlyAccess.map((r) => r.emailNormalized));

  for (const cand of candidates) {
    const key = cand.row.emailNormalized;
    const suppressionReason = suppressionMap.get(key);
    if (suppressionReason) {
      results.push({
        rowNumber: cand.rowNumber, email: cand.row.email, status: "suppressed",
        reason: `On the outreach suppression list (${suppressionReason}) — this address opted out or bounced and can never be re-imported.`,
      });
      continue;
    }
    if (existingSet.has(key)) {
      results.push({
        rowNumber: cand.rowNumber, email: cand.row.email, status: "duplicate_existing",
        reason: "Already exists in Outreach Contacts.",
      });
      continue;
    }
    if (earlyAccessSet.has(key)) {
      results.push({
        rowNumber: cand.rowNumber, email: cand.row.email, status: "duplicate_early_access",
        reason:
          "Already on the Early Access list — that list (and its own consent state) governs this address; it must not be imported as an outreach contact.",
      });
      continue;
    }
    const eligibility = evaluateOutreachEligibility({
      ...cand.row,
      unsubscribedAt: null,
      emailSuppressedAt: null,
    });
    results.push({
      rowNumber: cand.rowNumber, email: cand.row.email, status: "accepted",
      reason:
        eligibility.status === "eligible"
          ? `Will be saved as ELIGIBLE (${eligibility.category}): ${eligibility.reason}`
          : `Will be saved but BLOCKED from campaigns (${eligibility.category}): ${eligibility.reason}`,
      eligibility,
      row: cand.row,
    });
  }

  results.sort((a, b) => a.rowNumber - b.rowNumber);
  const summary = {
    total: results.length,
    accepted: results.filter((r) => r.status === "accepted").length,
    acceptedEligible: results.filter((r) => r.eligibility?.status === "eligible").length,
    acceptedBlocked: results.filter((r) => r.eligibility?.status === "blocked").length,
    invalid: results.filter((r) => r.status === "invalid").length,
    duplicates: results.filter((r) =>
      r.status === "duplicate_in_file" ||
      r.status === "duplicate_existing" ||
      r.status === "duplicate_early_access",
    ).length,
    suppressed: results.filter((r) => r.status === "suppressed").length,
  };
  return { ok: true, results, summary };
}
