export type TraderStatus =
  | "PENDING_EMAIL_VERIFICATION"
  | "PENDING_PHONE_VERIFICATION"
  | "PROFILE_INCOMPLETE"
  | "PENDING_DOCUMENTS"
  | "UNDER_REVIEW"
  | "VERIFIED"
  | "REJECTED"
  | "SUSPENDED"
  | "EXPIRED_DOCUMENTS";

export const STATUS_LABELS: Record<TraderStatus, string> = {
  PENDING_EMAIL_VERIFICATION: "Pending email",
  PENDING_PHONE_VERIFICATION: "Pending phone",
  PROFILE_INCOMPLETE: "Profile incomplete",
  PENDING_DOCUMENTS: "Pending documents",
  UNDER_REVIEW: "Under review",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
  EXPIRED_DOCUMENTS: "Expired documents",
};

export const REVIEW_FILTER_STATUSES: TraderStatus[] = [
  "UNDER_REVIEW",
  "PENDING_DOCUMENTS",
  "PROFILE_INCOMPLETE",
  "VERIFIED",
  "REJECTED",
  "SUSPENDED",
  "EXPIRED_DOCUMENTS",
];

export interface TraderListRow {
  userId: number;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  businessName: string | null;
  contactName: string | null;
  phone: string | null;
  town: string | null;
  postcode: string | null;
  mainCategory: string | null;
  verificationStatus: TraderStatus;
  phoneVerified: boolean;
  businessProfileCompleted: boolean;
  documentsSubmitted: boolean;
  submittedForReviewAt: string | null;
  verifiedAt: string | null;
  rejectedAt: string | null;
}

export interface StatusCount {
  status: TraderStatus;
  count: number;
}

export interface TraderListResponse {
  traders: TraderListRow[];
  counts: StatusCount[];
}

export type DocumentType =
  | "ID_DOCUMENT"
  | "PROOF_OF_ADDRESS"
  | "INSURANCE"
  | "QUALIFICATION"
  | "OTHER";

export type DocumentStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "EXPIRED";

export interface TraderDocument {
  id: number;
  userId: number;
  type: DocumentType;
  status: DocumentStatus;
  originalFilename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  expiresAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface TraderProfileFull {
  id: number;
  userId: number;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  mainCategory: string;
  additionalServices: string[] | null;
  businessAddress: string | null;
  town: string;
  postcode: string;
  serviceAreas: string[] | null;
  businessDescription: string | null;
  website: string | null;
  openingHours: string | null;
  logoUrl: string | null;
  galleryUrls: string[] | null;
  socialLinks: Record<string, string | undefined> | null;
  plan: string | null;
  isFeatured: boolean;
  isActive: boolean;
  rating: number | null;
  reviewCount: number;
  verificationStatus: TraderStatus;
  phoneVerified: boolean;
  businessProfileCompleted: boolean;
  documentsSubmitted: boolean;
  submittedForReviewAt: string | null;
  verifiedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  adminNotes: string | null;
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  privacyAcceptedAt: string | null;
  privacyVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTraderUser {
  id: number;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  emailVerified: boolean;
  createdAt: string;
}

export interface DocumentEvaluation {
  complete: boolean;
  byType: {
    type: DocumentType;
    label: string;
    required: boolean;
    hint: string;
    satisfied: boolean;
    hasUpload: boolean;
    count: number;
    latestStatus?: DocumentStatus;
    rejectionReason?: string;
    expiresAt?: string | null;
    expired?: boolean;
    expiringSoon?: boolean;
  }[];
  hasExpiredRequired: boolean;
  hasExpiringSoonRequired: boolean;
}

export interface AuditLogEntry {
  id: number;
  userId: number;
  action: string;
  performedBy: number | null;
  notes: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface TraderDetailResponse {
  user: AdminTraderUser;
  profile: TraderProfileFull;
  documents: TraderDocument[];
  documentsEvaluation: DocumentEvaluation;
  auditLog: AuditLogEntry[];
}

export interface DashboardSummary {
  counts: StatusCount[];
  totals: { totalTraders: number; totalCustomers: number };
  expiringSoonCount: number;
  enquiriesLast7d: number;
  recentActivity: {
    id: number;
    action: string;
    createdAt: string;
    userId: number | null;
    businessName: string | null;
    userEmail: string | null;
  }[];
}

export interface AuditReport {
  from: string;
  to: string;
  action: string | null;
  total: number;
  counts: { action: string; count: number }[];
  entries: (AuditLogEntry & { userEmail: string | null; businessName: string | null })[];
}

export interface ExpiringDocument {
  documentId: number;
  userId: number;
  type: DocumentType;
  status: DocumentStatus;
  expiresAt: string | null;
  originalFilename: string;
  businessName: string | null;
  contactName: string | null;
  userEmail: string | null;
}

export interface ExpiringDocumentsResponse {
  withinDays: number;
  documents: ExpiringDocument[];
}

export interface AdminEnquirySpecialistFields {
  propertyType?: "house" | "flat" | "commercial" | "other";
  tenure?: "owner" | "tenant" | "landlord" | "leaseholder";
  urgency?: "routine" | "soon" | "urgent";
}

export interface AdminEnquiry {
  id: number;
  traderId: number;
  traderUserId: number | null;
  traderBusinessName: string | null;
  customerId: number;
  customerEmail: string | null;
  customerName: string | null;
  message: string;
  serviceRequired: string;
  preferredDate: string | null;
  phone: string | null;
  specialistFields: AdminEnquirySpecialistFields | null;
  status: string;
  createdAt: string;
}

export interface AdminSubscription {
  id: number;
  userId: number;
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  businessName: string | null;
  contactName: string | null;
  email: string | null;
  verificationStatus: TraderStatus | null;
  isActive: boolean | null;
}
