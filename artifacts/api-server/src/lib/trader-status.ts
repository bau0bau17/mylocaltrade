import { db } from "@workspace/db";
import { traderAuditLogTable, type TraderAuditAction, type TraderProfile, type User, type TraderDocument, type TraderDocumentType } from "@workspace/db/schema";

// Baseline documents required of every trader regardless of role.
export const REQUIRED_DOCUMENT_TYPES: TraderDocumentType[] = ["ID_DOCUMENT", "INSURANCE"];

// --- Periodic re-validation (trust maintenance) ---
// How long after verification (or a re-confirmation) a trader is next asked to
// re-confirm their key documents so the "Documents reviewed" badge stays current.
export const REVALIDATION_INTERVAL_MS = 365 * 24 * 60 * 60 * 1000;
// Grace window after the trader is first prompted. If they still haven't
// re-confirmed when it lapses, the profile is hidden from public search.
export const REVALIDATION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export const DOCUMENT_TYPE_LABELS: Record<TraderDocumentType, string> = {
  ID_DOCUMENT: "Photo ID",
  PROOF_OF_ADDRESS: "Proof of address",
  INSURANCE: "Public liability insurance",
  QUALIFICATION: "Trade qualification",
  COMPANY_REGISTRATION: "Company registration",
  VAT_REGISTRATION: "VAT registration",
  BUSINESS_ADDRESS: "Business address proof",
  AUTHORISATION: "Authorisation letter",
  OTHER: "Other supporting document",
};

export const DOCUMENT_TYPE_HINTS: Record<TraderDocumentType, string> = {
  ID_DOCUMENT: "Passport, driving licence or other government-issued photo ID.",
  PROOF_OF_ADDRESS: "Utility bill, bank statement or council tax letter from the last 3 months.",
  INSURANCE: "Current public liability insurance certificate.",
  QUALIFICATION: "Trade certificate, City & Guilds, NVQ or equivalent.",
  COMPANY_REGISTRATION: "Companies House certificate of incorporation (optional).",
  VAT_REGISTRATION: "HMRC VAT registration certificate (optional).",
  BUSINESS_ADDRESS: "Recent utility bill, lease or rates bill showing the business address (optional).",
  AUTHORISATION: "A signed letter from the business owner authorising you to act on their behalf.",
  OTHER: "Anything else that supports your application.",
};

/**
 * Context describing who is being verified, used to make document requirements
 * role-aware. All fields are optional so existing callers keep the baseline
 * behaviour (ID + insurance) when they don't pass any context.
 */
export interface DocumentEvaluationContext {
  businessRole?: string | null;
  authorisedRepresentative?: boolean | null;
}

/**
 * Documents that MUST be supplied for the given role. We never require a
 * company number / company registration — sole traders are first-class. The
 * only role-driven requirement is an authorisation letter when the person is a
 * non-owner acting as an authorised representative.
 */
export function getRequiredDocumentTypes(ctx?: DocumentEvaluationContext): TraderDocumentType[] {
  const required: TraderDocumentType[] = [...REQUIRED_DOCUMENT_TYPES];
  if (ctx?.authorisedRepresentative) required.push("AUTHORISATION");
  return required;
}

/**
 * Document types to surface (in display order) for the given role. Company
 * identity evidence is offered to everyone except sole traders, but always
 * as optional supporting evidence.
 */
export function getDisplayDocumentTypes(ctx?: DocumentEvaluationContext): TraderDocumentType[] {
  const types: TraderDocumentType[] = ["ID_DOCUMENT", "INSURANCE"];
  if (ctx?.authorisedRepresentative) types.push("AUTHORISATION");
  types.push("QUALIFICATION", "PROOF_OF_ADDRESS");
  if (ctx?.businessRole !== "SELF_EMPLOYED") {
    types.push("COMPANY_REGISTRATION", "VAT_REGISTRATION", "BUSINESS_ADDRESS");
  }
  return types;
}

export interface DocumentTypeStatus {
  type: TraderDocumentType;
  label: string;
  required: boolean;
  hint: string;
  satisfied: boolean;
  hasUpload: boolean;
  count: number;
  latestStatus?: string;
  rejectionReason?: string;
  expiresAt?: string | null;
  expired?: boolean;
  expiringSoon?: boolean;
}

export interface DocumentsEvaluation {
  complete: boolean;
  byType: DocumentTypeStatus[];
  hasExpiredRequired: boolean;
  hasExpiringSoonRequired: boolean;
}

const EXPIRY_SOON_DAYS = 30;

export function isDocExpired(
  d: Pick<TraderDocument, "status" | "expiresAt">,
  now: Date = new Date(),
): boolean {
  if (d.status === "EXPIRED") return true;
  if (d.expiresAt && d.expiresAt.getTime() <= now.getTime()) return true;
  return false;
}

export function isDocExpiringSoon(
  d: Pick<TraderDocument, "status" | "expiresAt">,
  now: Date = new Date(),
): boolean {
  if (!d.expiresAt) return false;
  if (isDocExpired(d, now)) return false;
  const diff = d.expiresAt.getTime() - now.getTime();
  return diff > 0 && diff <= EXPIRY_SOON_DAYS * 24 * 60 * 60 * 1000;
}

export function evaluateDocumentsComplete(
  documents: Pick<TraderDocument, "type" | "status" | "rejectionReason" | "createdAt" | "expiresAt">[],
  ctx?: DocumentEvaluationContext,
): DocumentsEvaluation {
  const now = new Date();
  const requiredTypes = getRequiredDocumentTypes(ctx);
  const displayTypes = getDisplayDocumentTypes(ctx);
  const byType: DocumentTypeStatus[] = displayTypes.map((type) => {
    const docs = documents.filter((d) => d.type === type);
    const sorted = [...docs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const latest = sorted[0];
    const required = requiredTypes.includes(type);
    // Acceptable = pending or approved AND not expired (by status or by date).
    const acceptable = docs.some(
      (d) => (d.status === "PENDING_REVIEW" || d.status === "APPROVED") && !isDocExpired(d, now),
    );
    const latestExpired = latest ? isDocExpired(latest, now) : false;
    const latestExpiringSoon = latest ? isDocExpiringSoon(latest, now) : false;
    return {
      type,
      label: DOCUMENT_TYPE_LABELS[type],
      required,
      hint: DOCUMENT_TYPE_HINTS[type],
      satisfied: required ? acceptable : true,
      hasUpload: docs.length > 0,
      count: docs.length,
      latestStatus: latest?.status,
      rejectionReason: latest?.status === "REJECTED" ? latest.rejectionReason ?? undefined : undefined,
      expiresAt: latest?.expiresAt ? latest.expiresAt.toISOString() : null,
      expired: latestExpired,
      expiringSoon: latestExpiringSoon,
    };
  });
  const complete = requiredTypes.every((req) => byType.find((b) => b.type === req)?.satisfied);
  const hasExpiredRequired = byType.some((b) => b.required && b.expired);
  const hasExpiringSoonRequired = byType.some((b) => b.required && b.expiringSoon);
  return { complete, byType, hasExpiredRequired, hasExpiringSoonRequired };
}

export const TRADER_STATUS = {
  PENDING_EMAIL_VERIFICATION: "PENDING_EMAIL_VERIFICATION",
  PENDING_PHONE_VERIFICATION: "PENDING_PHONE_VERIFICATION",
  PROFILE_INCOMPLETE: "PROFILE_INCOMPLETE",
  PENDING_DOCUMENTS: "PENDING_DOCUMENTS",
  UNDER_REVIEW: "UNDER_REVIEW",
  NEEDS_MORE_INFO: "NEEDS_MORE_INFO",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED",
  SUSPENDED: "SUSPENDED",
  EXPIRED_DOCUMENTS: "EXPIRED_DOCUMENTS",
} as const;

export type TraderStatus = (typeof TRADER_STATUS)[keyof typeof TRADER_STATUS];

/**
 * Single source of truth for whether a trader profile is publicly visible.
 * As later phases land (subscription gating, document expiry checks), tighten this.
 */
export function isTraderProfilePublic(
  user: Pick<User, "emailVerified" | "isActive" | "role" | "deletedAt" | "deletionStatus">,
  profile: Pick<TraderProfile, "verificationStatus" | "phoneVerified" | "businessProfileCompleted" | "isActive" | "businessRole" | "authorisedRepresentative" | "revalidationOverdue">,
  subscription?: { status: string | null } | null,
  documents?: Pick<TraderDocument, "type" | "status" | "rejectionReason" | "createdAt" | "expiresAt">[] | null,
): boolean {
  if (user.role !== "trader") return false;
  // GDPR: any account in the deletion lifecycle (or already soft-deleted)
  // must not appear in public listings, search results or detail pages.
  if (user.deletedAt) return false;
  if (user.deletionStatus) return false;
  if (!user.emailVerified) return false;
  if (profile.verificationStatus !== TRADER_STATUS.VERIFIED) return false;
  if (!profile.isActive) return false;
  // Periodic re-validation: a verified trader who let the grace period lapse
  // without re-confirming their key documents is hidden until they re-confirm.
  if (profile.revalidationOverdue) return false;
  // Phase 6: subscription must be active for the profile to be public.
  // If a caller doesn't pass subscription info, fall back on profile.isActive — the
  // subscription activation flow flips that flag on, and cancellation flips it off,
  // so the field stays in sync. The explicit check is preferred when available.
  if (subscription !== undefined && subscription?.status !== "active") return false;
  // Phase 7: any expired required document hides the profile.
  if (documents) {
    const evaluation = evaluateDocumentsComplete(documents, {
      businessRole: profile.businessRole,
      authorisedRepresentative: profile.authorisedRepresentative,
    });
    if (evaluation.hasExpiredRequired) return false;
  }
  return true;
}

export interface AuditEntry {
  userId: number;
  action: TraderAuditAction;
  performedBy?: number | null;
  details?: Record<string, unknown>;
  notes?: string;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(traderAuditLogTable).values({
      userId: entry.userId,
      action: entry.action,
      performedBy: entry.performedBy ?? null,
      details: entry.details ?? null,
      notes: entry.notes ?? null,
    });
  } catch {
    // Never throw from audit logging.
  }
}

export interface BusinessProfileRequirement {
  field: string;
  label: string;
  satisfied: boolean;
  hint: string;
}

export interface BusinessProfileEvaluation {
  complete: boolean;
  requirements: BusinessProfileRequirement[];
}

const MIN_DESCRIPTION_LEN = 80;

export function evaluateBusinessProfileComplete(
  profile: Pick<TraderProfile,
    "businessDescription" | "businessAddress" | "additionalServices" | "serviceAreas" |
    "openingHours" | "town" | "postcode" | "mainCategory">,
): BusinessProfileEvaluation {
  const desc = (profile.businessDescription ?? "").trim();
  const addr = (profile.businessAddress ?? "").trim();
  const town = (profile.town ?? "").trim();
  const postcode = (profile.postcode ?? "").trim();
  const services = profile.additionalServices ?? [];
  const areas = profile.serviceAreas ?? [];
  const hours = (profile.openingHours ?? "").trim();
  const category = (profile.mainCategory ?? "").trim();

  const requirements: BusinessProfileRequirement[] = [
    {
      field: "mainCategory",
      label: "Main trade category",
      satisfied: category.length > 0,
      hint: "Select your main trade (e.g. Plumber, Electrician).",
    },
    {
      field: "businessDescription",
      label: "Business description",
      satisfied: desc.length >= MIN_DESCRIPTION_LEN,
      hint: `At least ${MIN_DESCRIPTION_LEN} characters describing what you do.`,
    },
    {
      field: "businessAddress",
      label: "Business address",
      satisfied: addr.length > 0 && town.length > 0 && postcode.length > 0,
      hint: "Full street address, town and postcode.",
    },
    {
      field: "additionalServices",
      label: "Services offered",
      satisfied: services.length >= 1,
      hint: "Add at least one service you provide.",
    },
    {
      field: "serviceAreas",
      label: "Service areas",
      satisfied: areas.length >= 1,
      hint: "Add at least one town/area you cover.",
    },
    {
      field: "openingHours",
      label: "Opening hours",
      satisfied: hours.length > 0,
      hint: "Tell customers when you're available.",
    },
  ];

  return {
    complete: requirements.every(r => r.satisfied),
    requirements,
  };
}

export interface ChecklistStep {
  key: "email" | "phone" | "business_profile" | "documents" | "review" | "subscription" | "live";
  label: string;
  state: "completed" | "pending" | "action_required" | "locked" | "rejected" | "expired";
  description?: string;
  comingSoon?: boolean;
}

export function buildOnboardingChecklist(
  user: Pick<User, "emailVerified">,
  profile: Pick<TraderProfile, "verificationStatus" | "phoneVerified" | "businessProfileCompleted" | "documentsSubmitted" | "isActive" | "rejectionReason" | "adminNotes" | "needsMoreInfoReason">,
  subscription?: { status: string | null; planId?: string | null; cancelAtPeriodEnd?: boolean } | null,
): ChecklistStep[] {
  const status = profile.verificationStatus as TraderStatus;
  const emailDone = user.emailVerified;
  const phoneDone = profile.phoneVerified;
  const businessDone = profile.businessProfileCompleted;
  const docsDone = profile.documentsSubmitted;
  const verified = status === TRADER_STATUS.VERIFIED;
  const rejected = status === TRADER_STATUS.REJECTED;
  const underReview = status === TRADER_STATUS.UNDER_REVIEW;
  const needsMoreInfo = status === TRADER_STATUS.NEEDS_MORE_INFO;
  const subActive = subscription?.status === "active";
  const subCancelling = subActive && subscription?.cancelAtPeriodEnd === true;

  return [
    {
      key: "email",
      label: "Email verified",
      state: emailDone ? "completed" : "action_required",
      description: emailDone ? undefined : "Click the link we emailed you, or resend it from below.",
    },
    {
      key: "phone",
      label: "Phone verified",
      state: !emailDone ? "locked" : phoneDone ? "completed" : "action_required",
      description: !emailDone
        ? "Verify your email first."
        : phoneDone
          ? undefined
          : "We'll send you a 6-digit code to confirm your number.",
    },
    {
      key: "business_profile",
      label: "Business profile completed",
      state: !phoneDone ? "locked" : businessDone ? "completed" : "action_required",
      description: !phoneDone
        ? "Verify your phone first."
        : businessDone
          ? undefined
          : "Tell customers what you do, where you work and when you're available.",
    },
    {
      key: "documents",
      label: "Verification documents uploaded",
      state: !businessDone
        ? "locked"
        : status === TRADER_STATUS.EXPIRED_DOCUMENTS
          ? "expired"
          : needsMoreInfo
            ? "action_required"
            : docsDone
              ? "completed"
              : "action_required",
      description: !businessDone
        ? "Complete your business profile first."
        : status === TRADER_STATUS.EXPIRED_DOCUMENTS
          ? "A required document has expired. Upload a fresh copy to restore your listing."
          : needsMoreInfo
            ? profile.needsMoreInfoReason ?? "Our team needs more information — see the details above and upload what's requested."
            : docsDone
              ? undefined
              : "Upload your photo ID and current public liability insurance.",
    },
    {
      key: "review",
      label: "Admin review",
      state: rejected
        ? "rejected"
        : verified
          ? "completed"
          : needsMoreInfo
            ? "action_required"
            : underReview
              ? "pending"
              : "locked",
      description: rejected
        ? profile.rejectionReason ?? undefined
        : needsMoreInfo
          ? profile.needsMoreInfoReason ?? "Our team needs more information before we can verify your account."
          : profile.adminNotes ?? undefined,
      comingSoon: docsDone && !verified && !rejected && !needsMoreInfo, // Phase 5
    },
    {
      key: "subscription",
      label: "Subscription active",
      state: !verified
        ? "locked"
        : subActive
          ? "completed"
          : "action_required",
      description: !verified
        ? "Get verified first."
        : subActive
          ? subCancelling
            ? `${(subscription?.planId ?? "Plan").toString().toUpperCase()} — cancels at period end.`
            : `${(subscription?.planId ?? "Plan").toString().toUpperCase()} plan active.`
          : "Choose a plan to make your profile live.",
    },
    {
      key: "live",
      label: "Profile live",
      state: profile.isActive && verified && subActive ? "completed" : "locked",
      description: profile.isActive && verified && subActive
        ? "Your profile is visible to customers."
        : verified && !subActive
          ? "Activate a subscription to publish."
          : undefined,
    },
  ];
}

export function statusMessage(profile: Pick<TraderProfile, "verificationStatus" | "rejectionReason" | "needsMoreInfoReason">): string {
  const status = profile.verificationStatus as TraderStatus;
  switch (status) {
    case TRADER_STATUS.PENDING_EMAIL_VERIFICATION:
      return "Please verify your email address to continue setting up your Trader account.";
    case TRADER_STATUS.PENDING_PHONE_VERIFICATION:
      return "Phone verification required before your profile can be reviewed.";
    case TRADER_STATUS.PROFILE_INCOMPLETE:
      return "Complete your business profile so we can review your account.";
    case TRADER_STATUS.PENDING_DOCUMENTS:
      return "Upload your verification documents (ID, insurance, qualifications).";
    case TRADER_STATUS.UNDER_REVIEW:
      return "Your profile is currently under review. We'll notify you once your documents have been checked.";
    case TRADER_STATUS.NEEDS_MORE_INFO:
      return profile.needsMoreInfoReason
        ? `We need a bit more information before we can verify your account: ${profile.needsMoreInfoReason}`
        : "We need a bit more information before we can verify your account. Please check your dashboard for details.";
    case TRADER_STATUS.VERIFIED:
      return "Your profile is verified. Choose a subscription plan to make it live.";
    case TRADER_STATUS.REJECTED:
      return profile.rejectionReason
        ? `Your application was rejected: ${profile.rejectionReason}`
        : "Your application was rejected. Please contact support.";
    case TRADER_STATUS.SUSPENDED:
      return "Your account has been suspended. Please contact support.";
    case TRADER_STATUS.EXPIRED_DOCUMENTS:
      return "One of your required documents has expired. Please upload a new one to make your profile visible again.";
    default:
      return "Complete the steps below to activate your profile.";
  }
}
