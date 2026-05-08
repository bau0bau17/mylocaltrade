import { db } from "@workspace/db";
import { traderAuditLogTable, type TraderAuditAction, type TraderProfile, type User } from "@workspace/db/schema";

export const TRADER_STATUS = {
  PENDING_EMAIL_VERIFICATION: "PENDING_EMAIL_VERIFICATION",
  PENDING_PHONE_VERIFICATION: "PENDING_PHONE_VERIFICATION",
  PROFILE_INCOMPLETE: "PROFILE_INCOMPLETE",
  PENDING_DOCUMENTS: "PENDING_DOCUMENTS",
  UNDER_REVIEW: "UNDER_REVIEW",
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
export function isTraderProfilePublic(user: Pick<User, "emailVerified" | "isActive" | "role">, profile: Pick<TraderProfile, "verificationStatus" | "phoneVerified" | "businessProfileCompleted" | "isActive">): boolean {
  if (user.role !== "trader") return false;
  if (!user.emailVerified) return false;
  if (profile.verificationStatus !== TRADER_STATUS.VERIFIED) return false;
  if (!profile.isActive) return false;
  // Phase 2+: phoneVerified, businessProfileCompleted, documents approved, subscription ACTIVE.
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

export interface ChecklistStep {
  key: "email" | "phone" | "business_profile" | "documents" | "review" | "subscription" | "live";
  label: string;
  state: "completed" | "pending" | "action_required" | "locked" | "rejected" | "expired";
  description?: string;
  comingSoon?: boolean;
}

export function buildOnboardingChecklist(
  user: Pick<User, "emailVerified">,
  profile: Pick<TraderProfile, "verificationStatus" | "phoneVerified" | "businessProfileCompleted" | "documentsSubmitted" | "isActive" | "rejectionReason" | "adminNotes">,
): ChecklistStep[] {
  const status = profile.verificationStatus as TraderStatus;
  const emailDone = user.emailVerified;
  const phoneDone = profile.phoneVerified;
  const businessDone = profile.businessProfileCompleted;
  const docsDone = profile.documentsSubmitted;
  const verified = status === TRADER_STATUS.VERIFIED;
  const rejected = status === TRADER_STATUS.REJECTED;
  const underReview = status === TRADER_STATUS.UNDER_REVIEW;

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
      state: !phoneDone ? "locked" : businessDone ? "completed" : "pending",
      comingSoon: phoneDone && !businessDone, // Phase 3
    },
    {
      key: "documents",
      label: "Verification documents uploaded",
      state: !businessDone ? "locked" : docsDone ? "completed" : "pending",
      comingSoon: businessDone && !docsDone, // Phase 4
    },
    {
      key: "review",
      label: "Admin review",
      state: rejected
        ? "rejected"
        : verified
          ? "completed"
          : underReview
            ? "pending"
            : "locked",
      description: rejected ? profile.rejectionReason ?? undefined : profile.adminNotes ?? undefined,
      comingSoon: docsDone && !verified && !rejected, // Phase 5
    },
    {
      key: "subscription",
      label: "Subscription active",
      state: !verified ? "locked" : "pending",
      comingSoon: verified, // Phase 6
    },
    {
      key: "live",
      label: "Profile live",
      state: profile.isActive && verified ? "completed" : "locked",
    },
  ];
}

export function statusMessage(profile: Pick<TraderProfile, "verificationStatus" | "rejectionReason">): string {
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
