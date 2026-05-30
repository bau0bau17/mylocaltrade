import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, downloadAuthed, fetchAuthedBlob, ApiError } from "@/lib/api";
import { queryClient as qc } from "@/lib/queryClient";
import { BUSINESS_ROLE_LABELS, type TraderDetailResponse, type TraderDocument } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, DocumentStatusBadge } from "@/components/StatusBadge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { formatDate, formatDateTime, daysUntil } from "@/lib/format";
import { detectContactInfo, contactViolationMessage } from "@/lib/content-filter";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Pause,
  Play,
  MessageSquare,
  Download,
  ExternalLink,
  Eye,
  Loader2,
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

interface Props {
  userId: number;
}

type ActionType = "approve" | "reject" | "suspend" | "request-info" | "unsuspend";

interface ActionDialogState {
  type: ActionType;
  open: boolean;
}

interface DocActionDialogState {
  type: "approve" | "reject";
  doc: TraderDocument;
  open: boolean;
}

interface PreviewState {
  doc: TraderDocument;
  status: "loading" | "ready" | "error" | "unsupported";
  url: string | null;
  mimeType: string | null;
  error: string | null;
  revoke: (() => void) | null;
}

const SAFE_INLINE_PREVIEW_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

const ACTION_LABELS: Record<ActionType, { title: string; description: string; needsReason: "required" | "optional" | "none"; verb: string; variant?: "destructive" }> = {
  approve: {
    title: "Approve trader",
    description: "Grant verified status. Optionally add internal notes.",
    needsReason: "optional",
    verb: "Approve",
  },
  reject: {
    title: "Reject trader",
    description: "The trader will be emailed this reason and their profile will not go live. Be specific so they understand the decision.",
    needsReason: "required",
    verb: "Reject & email trader",
    variant: "destructive",
  },
  suspend: {
    title: "Suspend trader",
    description: "Temporarily disable this trader's account. The trader will be emailed this reason and it is recorded in the audit log.",
    needsReason: "required",
    verb: "Suspend & email trader",
    variant: "destructive",
  },
  "request-info": {
    title: "Request more information",
    description: "The trader is emailed your message and returned to \"awaiting documents\". Describe exactly what you need (e.g. clearer ID photo, updated insurance certificate).",
    needsReason: "required",
    verb: "Send email",
  },
  unsuspend: {
    title: "Lift suspension",
    description: "Restore this trader. Status will be recomputed from current documents.",
    needsReason: "none",
    verb: "Lift suspension",
  },
};

export default function TraderDetail({ userId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const detailKey = ["admin", "trader", userId];

  const { data, isLoading, error } = useQuery({
    queryKey: detailKey,
    queryFn: () => api<TraderDetailResponse>(`/api/admin/traders/${userId}`),
  });

  const [actionDialog, setActionDialog] = useState<ActionDialogState | null>(null);
  const [docDialog, setDocDialog] = useState<DocActionDialogState | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [accessReason, setAccessReason] = useState("");
  const [reason, setReason] = useState("");

  // Release the blob URL when the component unmounts so we don't leak memory
  // if the admin closes the page while a preview is still open.
  useEffect(() => {
    return () => {
      if (preview?.revoke) preview.revoke();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const reasonViolation = useMemo(() => detectContactInfo(reason), [reason]);
  const reasonViolationText = reasonViolation ? contactViolationMessage(reasonViolation) : null;

  const traderActionMutation = useMutation({
    mutationFn: async ({ type, reason }: { type: ActionType; reason: string }) => {
      const path = `/api/admin/traders/${userId}/${type}`;
      const body: Record<string, string> = {};
      if (type === "approve") {
        if (reason) body.notes = reason;
      } else if (type === "request-info") {
        body.notes = reason;
      } else if (type === "reject" || type === "suspend") {
        body.reason = reason;
      }
      return api(path, { method: "POST", body: type === "unsuspend" ? undefined : body });
    },
    onSuccess: (_data, vars) => {
      toast({ title: `Action complete`, description: ACTION_LABELS[vars.type].title });
      queryClient.invalidateQueries({ queryKey: detailKey });
      qc.invalidateQueries({ queryKey: ["admin", "traders"] });
      qc.invalidateQueries({ queryKey: ["admin", "dashboard"] });
      setActionDialog(null);
      setReason("");
    },
    onError: (err) => {
      toast({
        title: "Action failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const docActionMutation = useMutation({
    mutationFn: async ({ type, docId, reason }: { type: "approve" | "reject"; docId: number; reason?: string }) => {
      return api(`/api/admin/documents/${docId}/${type}`, {
        method: "POST",
        body: type === "reject" ? { reason } : {},
      });
    },
    onSuccess: () => {
      toast({ title: "Document updated" });
      queryClient.invalidateQueries({ queryKey: detailKey });
      qc.invalidateQueries({ queryKey: ["admin", "expiring-documents"] });
      setDocDialog(null);
      setReason("");
    },
    onError: (err) => {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const registerCheckMutation = useMutation({
    mutationFn: async () => api(`/api/admin/traders/${userId}/register-check/run`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Register check complete" });
      queryClient.invalidateQueries({ queryKey: detailKey });
    },
    onError: (err) => {
      toast({
        title: "Register check failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-48" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <BackLink />
        <Alert variant="destructive">
          <AlertDescription>{(error as Error)?.message ?? "Failed to load trader"}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { profile, user, documents, documentsEvaluation, auditLog } = data;
  const isSuspended = profile.verificationStatus === "SUSPENDED";

  function openAction(type: ActionType) {
    setReason("");
    setActionDialog({ type, open: true });
  }

  function submitAction() {
    if (!actionDialog) return;
    const cfg = ACTION_LABELS[actionDialog.type];
    if (cfg.needsReason === "required" && !reason.trim()) {
      toast({ title: "A reason is required", variant: "destructive" });
      return;
    }
    if (cfg.needsReason !== "none" && reasonViolation) {
      toast({
        title: "Message blocked",
        description: contactViolationMessage(reasonViolation),
        variant: "destructive",
      });
      return;
    }
    traderActionMutation.mutate({ type: actionDialog.type, reason: reason.trim() });
  }

  function submitDocAction() {
    if (!docDialog) return;
    if (docDialog.type === "reject" && !reason.trim()) {
      toast({ title: "A reason is required", variant: "destructive" });
      return;
    }
    if (docDialog.type === "reject" && reasonViolation) {
      toast({
        title: "Message blocked",
        description: contactViolationMessage(reasonViolation),
        variant: "destructive",
      });
      return;
    }
    docActionMutation.mutate({
      type: docDialog.type,
      docId: docDialog.doc.id,
      reason: docDialog.type === "reject" ? reason.trim() : undefined,
    });
  }

  async function openPreview(doc: TraderDocument) {
    // Re-review gate (mirrors the server). Once a document is APPROVED,
    // the admin must enter a written reason before re-opening it.
    if (doc.status === "APPROVED" && accessReason.trim().length < 3) {
      toast({
        title: "Reason required",
        description:
          'This document is already approved. Type a short reason in the "Reason for access" box (e.g. an ICO request reference) before re-opening.',
        variant: "destructive",
      });
      return;
    }
    // Revoke any previously-loaded blob so we don't leak memory if the admin
    // opens a second document without first closing the dialog.
    if (preview?.revoke) preview.revoke();
    setPreview({
      doc,
      status: "loading",
      url: null,
      mimeType: null,
      error: null,
      revoke: null,
    });
    try {
      const blob = await fetchAuthedBlob(`/api/admin/documents/${doc.id}/file`, {
        mode: "view",
        reason: accessReason.trim() || undefined,
      });
      // Refresh the audit-log tab so the new ADMIN_VIEWED_DOCUMENT entry shows up.
      queryClient.invalidateQueries({ queryKey: detailKey });
      const supported = SAFE_INLINE_PREVIEW_TYPES.has(blob.mimeType);
      setPreview({
        doc,
        status: supported ? "ready" : "unsupported",
        url: blob.url,
        mimeType: blob.mimeType,
        error: null,
        revoke: blob.revoke,
      });
    } catch (err) {
      setPreview({
        doc,
        status: "error",
        url: null,
        mimeType: null,
        error: err instanceof Error ? err.message : "Unknown error",
        revoke: null,
      });
    }
  }

  function closePreview() {
    if (preview?.revoke) preview.revoke();
    setPreview(null);
  }

  function openInNewTab() {
    if (!preview?.url) return;
    // Blob URL inherits the admin origin; only open when MIME is in the safe
    // allowlist (already enforced by `status === 'ready'`).
    window.open(preview.url, "_blank", "noopener,noreferrer");
  }

  async function handleDownloadDocument(doc: TraderDocument, reasonOverride?: string) {
    try {
      const reasonText = (reasonOverride ?? accessReason).trim();
      // Re-review gate: same rule as preview — approved docs require a
      // reason. Server enforces it too with HTTP 403, but failing fast in
      // the client gives a better message.
      if (doc.status === "APPROVED" && reasonText.length < 3) {
        toast({
          title: "Reason required",
          description:
            'This document is already approved. Type a short reason in the "Reason for access" box before downloading it.',
          variant: "destructive",
        });
        return;
      }
      await downloadAuthed(
        `/api/admin/documents/${doc.id}/file`,
        doc.originalFilename,
        { reason: reasonText || undefined },
      );
      queryClient.invalidateQueries({ queryKey: detailKey });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined;
      toast({
        title: "Download failed",
        description: status ? `HTTP ${status}` : (err instanceof Error ? err.message : "Unknown"),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-5">
      <BackLink />

      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{profile.businessName || user.email}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <StatusBadge status={profile.verificationStatus} />
            {profile.isFeatured && <Badge variant="secondary">Featured</Badge>}
            {profile.isActive && <Badge className="bg-emerald-100 text-emerald-800 border-transparent">Live</Badge>}
            <span className="text-xs text-muted-foreground">
              Joined {formatDate(profile.createdAt)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isSuspended && (
            <>
              <Button onClick={() => openAction("approve")} data-testid="button-approve">
                <CheckCircle2 className="w-4 h-4 mr-1.5" /> Approve
              </Button>
              <Button variant="outline" onClick={() => openAction("request-info")} data-testid="button-request-info">
                <MessageSquare className="w-4 h-4 mr-1.5" /> Request info
              </Button>
              <Button variant="outline" onClick={() => openAction("reject")} data-testid="button-reject">
                <XCircle className="w-4 h-4 mr-1.5" /> Reject
              </Button>
              <Button variant="outline" onClick={() => openAction("suspend")} data-testid="button-suspend">
                <Pause className="w-4 h-4 mr-1.5" /> Suspend
              </Button>
            </>
          )}
          {isSuspended && (
            <Button onClick={() => openAction("unsuspend")} data-testid="button-unsuspend">
              <Play className="w-4 h-4 mr-1.5" /> Lift suspension
            </Button>
          )}
        </div>
      </div>

      {documentsEvaluation.hasExpiredRequired && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>One or more required documents have expired.</AlertDescription>
        </Alert>
      )}
      {profile.rejectionReason && (
        <Alert variant="destructive">
          <AlertDescription>
            <strong>Rejection reason:</strong> {profile.rejectionReason}
          </AlertDescription>
        </Alert>
      )}
      {profile.verificationStatus === "NEEDS_MORE_INFO" && profile.needsMoreInfoReason && (
        <Alert>
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>
            <strong>Information requested:</strong> {profile.needsMoreInfoReason}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile" data-testid="tab-profile">Profile</TabsTrigger>
          <TabsTrigger value="checks" data-testid="tab-checks">Checks</TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-documents">
            Documents ({documents.length})
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">
            Audit log ({auditLog.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Business profile</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Field label="Business name" value={profile.businessName} />
              <Field label="Contact name" value={profile.contactName} />
              <Field label="Email" value={user.email} />
              <Field label="Phone" value={profile.phone} extra={profile.phoneVerified ? "verified" : "unverified"} />
              <Field label="Main category" value={profile.mainCategory} />
              <Field
                label="Role in business"
                value={profile.businessRole ? (BUSINESS_ROLE_LABELS[profile.businessRole] ?? profile.businessRole) : "—"}
              />
              <Field
                label="Authorised representative"
                value={profile.authorisedRepresentative ? "Yes — acting on behalf of the owner" : "No"}
              />
              <Field label="Business email domain" value={profile.businessEmailDomain || "—"} />
              {profile.businessEmailDomain ? (
                <Field
                  label="Business email confirmation"
                  value={
                    profile.businessEmailVerified
                      ? `Confirmed${
                          profile.businessEmailVerifiedAddress
                            ? ` (${profile.businessEmailVerifiedAddress})`
                            : ""
                        }${
                          profile.businessEmailVerifiedAt
                            ? ` · ${new Date(profile.businessEmailVerifiedAt).toLocaleDateString("en-GB")}`
                            : ""
                        }`
                      : profile.businessEmailVerificationTarget
                        ? `Self-declared — verification pending (${profile.businessEmailVerificationTarget})`
                        : "Self-declared (not confirmed by email)"
                  }
                />
              ) : null}
              <Field
                label="Additional services"
                value={profile.additionalServices?.join(", ") || "—"}
              />
              <Field label="Town" value={profile.town} />
              <Field label="Postcode" value={profile.postcode} />
              <Field
                label="Service areas"
                value={profile.serviceAreas?.join(", ") || "—"}
              />
              <Field label="Website" value={profile.website || "—"} />
              <Field label="Plan" value={profile.plan?.toUpperCase() ?? "—"} />
              <Field label="Rating" value={profile.rating != null ? `${profile.rating} / 5 (${profile.reviewCount})` : "No reviews"} />
              <Field label="Submitted for review" value={formatDateTime(profile.submittedForReviewAt)} />
              <Field label="Verified at" value={formatDateTime(profile.verifiedAt)} />
              {profile.verificationStatus === "VERIFIED" && (
                <Field
                  label="Re-validation"
                  value={
                    profile.revalidationOverdue
                      ? "Overdue — hidden from search"
                      : profile.revalidationRemindedAt
                        ? `Re-confirmation requested ${formatDateTime(profile.revalidationRemindedAt)}`
                        : profile.revalidationDueAt
                          ? `Next due ${formatDateTime(profile.revalidationDueAt)}`
                          : "—"
                  }
                />
              )}
              <Field label="Terms accepted" value={`${formatDateTime(profile.termsAcceptedAt)} (v${profile.termsVersion ?? "—"})`} />
              <Field label="Privacy accepted" value={`${formatDateTime(profile.privacyAcceptedAt)} (v${profile.privacyVersion ?? "—"})`} />
              <Field
                label="Description"
                value={profile.businessDescription || "—"}
                full
              />
              <Field label="Admin notes" value={profile.adminNotes || "—"} full />
              <Field label="Verification notes" value={profile.verificationNotes || "—"} full />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="checks" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Verification checks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground leading-relaxed">
                AI cross-check of submitted business details against the Companies House
                record. This is a support aid only — manual review remains the final decision.
              </p>
              {!profile.aiVerificationCheckedAt || !profile.aiVerificationData ? (
                <p className="text-sm text-muted-foreground" data-testid="text-ai-none">
                  No Companies House cross-check yet.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <AiVerdictBadge verdict={profile.aiVerificationData.verdict} />
                    <span className="text-xs text-muted-foreground">
                      Checked {formatDateTime(profile.aiVerificationCheckedAt)}
                    </span>
                  </div>
                  <p className="text-sm">{profile.aiVerificationData.reasoning}</p>
                  {profile.aiVerificationData.companiesHouse ? (
                    <div className="rounded-md border bg-muted/40 p-3 space-y-1.5">
                      <div className="text-xs font-medium text-muted-foreground">
                        Submitted vs Companies House
                      </div>
                      <CompareRow
                        label="Name"
                        a={profile.aiVerificationData.submitted.businessName}
                        b={profile.aiVerificationData.companiesHouse.companyName ?? "—"}
                      />
                      <CompareRow
                        label="Address"
                        a={profile.aiVerificationData.submitted.address || "—"}
                        b={profile.aiVerificationData.companiesHouse.address ?? "—"}
                      />
                      <CompareRow
                        label="Postcode"
                        a={profile.aiVerificationData.submitted.postcode}
                        b={profile.aiVerificationData.companiesHouse.postcode ?? "—"}
                      />
                      {profile.aiVerificationData.companiesHouse.companyNumber ? (
                        <CompareRow label="Co. number" a="—" b={profile.aiVerificationData.companiesHouse.companyNumber} />
                      ) : null}
                      {profile.aiVerificationData.companiesHouse.status ? (
                        <CompareRow label="CH status" a="—" b={profile.aiVerificationData.companiesHouse.status} />
                      ) : null}
                    </div>
                  ) : null}
                  {profile.aiVerificationData.error ? (
                    <p className="text-xs text-red-700">Error: {profile.aiVerificationData.error}</p>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-base">Register checks</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => registerCheckMutation.mutate()}
                disabled={registerCheckMutation.isPending}
                data-testid="button-run-register-check"
              >
                {registerCheckMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-1.5" />
                )}
                {profile.registerCheckCheckedAt ? "Re-run register check" : "Run register check"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Validates the submitted company number against Companies House and the VAT
                number against the HMRC register.
              </p>
              {!profile.registerCheckCheckedAt || !profile.registerCheckData ? (
                <p className="text-sm text-muted-foreground" data-testid="text-register-none">
                  No register check yet. Use the button above to run it.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <RegisterOverallBadge overall={profile.registerCheckData.overall} />
                    <span className="text-xs text-muted-foreground">
                      Checked {formatDateTime(profile.registerCheckCheckedAt)}
                    </span>
                  </div>

                  <div className="rounded-md border p-3 space-y-1.5" data-testid="register-company">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-medium">Company number</span>
                      <CompanyStatusBadge status={profile.registerCheckData.company.status} />
                    </div>
                    <p className="text-sm">{profile.registerCheckData.company.detail}</p>
                    {profile.registerCheckData.company.submittedNumber ? (
                      <p className="text-xs text-muted-foreground">
                        Submitted: {profile.registerCheckData.company.submittedNumber}
                      </p>
                    ) : null}
                    {profile.registerCheckData.company.companiesHouse ? (
                      <div className="rounded-md border bg-muted/40 p-3 mt-2 space-y-1.5">
                        <div className="text-xs font-medium text-muted-foreground">Companies House record</div>
                        {profile.registerCheckData.company.companiesHouse.companyName ? (
                          <CompareRow label="Name" a={profile.businessName} b={profile.registerCheckData.company.companiesHouse.companyName} />
                        ) : null}
                        {profile.registerCheckData.company.companiesHouse.status ? (
                          <CompareRow label="Status" a="—" b={profile.registerCheckData.company.companiesHouse.status} />
                        ) : null}
                        {profile.registerCheckData.company.companiesHouse.address ? (
                          <CompareRow label="Address" a="—" b={profile.registerCheckData.company.companiesHouse.address} />
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-md border p-3 space-y-1.5" data-testid="register-vat">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-medium">VAT number</span>
                      <VatStatusBadge status={profile.registerCheckData.vat.status} />
                    </div>
                    <p className="text-sm">{profile.registerCheckData.vat.detail}</p>
                    {profile.registerCheckData.vat.submittedNumber ? (
                      <p className="text-xs text-muted-foreground">
                        Submitted: {profile.registerCheckData.vat.submittedNumber}
                      </p>
                    ) : null}
                    {profile.registerCheckData.vat.hmrc ? (
                      <div className="rounded-md border bg-muted/40 p-3 mt-2 space-y-1.5">
                        <div className="text-xs font-medium text-muted-foreground">HMRC record</div>
                        {profile.registerCheckData.vat.hmrc.name ? (
                          <CompareRow label="Name" a={profile.businessName} b={profile.registerCheckData.vat.hmrc.name} />
                        ) : null}
                        {profile.registerCheckData.vat.hmrc.address ? (
                          <CompareRow label="Address" a="—" b={profile.registerCheckData.vat.hmrc.address} />
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {profile.registerCheckData.error ? (
                    <p className="text-xs text-red-700">Error: {profile.registerCheckData.error}</p>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Verification documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert className="border-amber-300 bg-amber-50 text-amber-900">
                <ShieldAlert className="w-4 h-4" />
                <AlertDescription className="text-xs leading-relaxed">
                  These files contain personal data. Every preview and download is recorded in
                  the audit log under UK GDPR (Article 5(2) — accountability). Only access them
                  when necessary for verification or to respond to an ICO / data-protection
                  request. Optionally record the reason below so it is attached to the audit entry.
                </AlertDescription>
              </Alert>
              <div className="space-y-1.5">
                <Label htmlFor="access-reason" className="text-xs">
                  Reason for access — required to re-open or download approved documents (e.g. "ICO subject access request ref. 123")
                </Label>
                <Textarea
                  id="access-reason"
                  value={accessReason}
                  onChange={(e) => setAccessReason(e.target.value.slice(0, 500))}
                  rows={2}
                  placeholder="Routine verification review"
                  data-testid="textarea-access-reason"
                />
              </div>
              {documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No documents uploaded.</p>
              ) : (
                <div className="space-y-3">
                  {documents.map((doc) => {
                    const days = daysUntil(doc.expiresAt);
                    const expSoon = days != null && days >= 0 && days <= 30;
                    const expired = doc.status === "EXPIRED" || (days != null && days < 0);
                    const isLocked =
                      doc.status === "APPROVED" && accessReason.trim().length < 3;
                    return (
                      <div
                        key={doc.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border rounded-md"
                        data-testid={`document-${doc.id}`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{labelForDocType(doc.type)}</span>
                            <DocumentStatusBadge status={doc.status} />
                            {expired && <Badge variant="outline" className="bg-orange-100 text-orange-900 border-transparent">Expired</Badge>}
                            {expSoon && !expired && (
                              <Badge variant="outline" className="bg-amber-100 text-amber-900 border-transparent">
                                Expires in {days}d
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 truncate">
                            {doc.originalFilename} · uploaded {formatDate(doc.createdAt)}
                            {doc.expiresAt && ` · expires ${formatDate(doc.expiresAt)}`}
                          </div>
                          {doc.rejectionReason && (
                            <div className="text-xs text-red-700 mt-1">Reason: {doc.rejectionReason}</div>
                          )}
                          {isLocked && (
                            <div className="text-xs text-muted-foreground mt-1 italic">
                              Approved — enter a reason above to re-open or download.
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => openPreview(doc)}
                            disabled={isLocked}
                            data-testid={`button-view-${doc.id}`}
                          >
                            <Eye className="w-4 h-4 mr-1" /> View
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDownloadDocument(doc)}
                            disabled={isLocked}
                            data-testid={`button-download-${doc.id}`}
                          >
                            <Download className="w-4 h-4 mr-1" /> Download
                          </Button>
                          {doc.status === "PENDING_REVIEW" && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => {
                                  setReason("");
                                  setDocDialog({ type: "approve", doc, open: true });
                                }}
                                data-testid={`button-doc-approve-${doc.id}`}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setReason("");
                                  setDocDialog({ type: "reject", doc, open: true });
                                }}
                                data-testid={`button-doc-reject-${doc.id}`}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Audit log</CardTitle>
            </CardHeader>
            <CardContent>
              {auditLog.length === 0 ? (
                <p className="text-sm text-muted-foreground">No audit entries.</p>
              ) : (
                <ul className="divide-y">
                  {auditLog.map((e) => {
                    // Pull the document section (doc.type) out of the JSON
                    // details so the activity line tells the admin WHICH
                    // section was opened, not just the filename.
                    const details = (e.details ?? {}) as Record<string, unknown>;
                    const docType = typeof details.documentType === "string" ? details.documentType : null;
                    const sectionLabel = docType ? labelForDocType(docType) : null;
                    return (
                      <li key={e.id} className="py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium">
                              {e.action.replace(/_/g, " ")}
                              {sectionLabel ? ` — ${sectionLabel}` : ""}
                            </div>
                            {e.notes && <div className="text-xs text-muted-foreground mt-0.5">{e.notes}</div>}
                            {e.details && Object.keys(e.details).length > 0 && (
                              <pre className="text-[11px] bg-muted/60 rounded p-2 mt-1 overflow-x-auto">
                                {JSON.stringify(e.details, null, 2)}
                              </pre>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDateTime(e.createdAt)}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!actionDialog?.open} onOpenChange={(o) => !o && setActionDialog(null)}>
        <DialogContent>
          {actionDialog && (
            <>
              <DialogHeader>
                <DialogTitle>{ACTION_LABELS[actionDialog.type].title}</DialogTitle>
                <DialogDescription>{ACTION_LABELS[actionDialog.type].description}</DialogDescription>
              </DialogHeader>
              {ACTION_LABELS[actionDialog.type].needsReason !== "none" && (
                <div className="space-y-2">
                  <Label htmlFor="action-reason">
                    {ACTION_LABELS[actionDialog.type].needsReason === "required" ? "Reason" : "Notes (optional)"}
                  </Label>
                  <Textarea
                    id="action-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={4}
                    className={reasonViolationText ? "border-destructive focus-visible:ring-destructive" : undefined}
                    data-testid="textarea-action-reason"
                  />
                  {reasonViolationText ? (
                    <Alert variant="destructive" data-testid="violation-action-reason">
                      <AlertTriangle className="w-4 h-4" />
                      <AlertDescription>{reasonViolationText}</AlertDescription>
                    </Alert>
                  ) : null}
                </div>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setActionDialog(null)}>Cancel</Button>
                <Button
                  variant={ACTION_LABELS[actionDialog.type].variant ?? "default"}
                  onClick={submitAction}
                  disabled={
                    traderActionMutation.isPending ||
                    (ACTION_LABELS[actionDialog.type].needsReason !== "none" && !!reasonViolation)
                  }
                  data-testid="button-confirm-action"
                >
                  {traderActionMutation.isPending ? "Working…" : ACTION_LABELS[actionDialog.type].verb}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!docDialog?.open} onOpenChange={(o) => !o && setDocDialog(null)}>
        <DialogContent>
          {docDialog && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {docDialog.type === "approve" ? "Approve document" : "Reject document"}
                </DialogTitle>
                <DialogDescription>
                  {labelForDocType(docDialog.doc.type)} · {docDialog.doc.originalFilename}
                </DialogDescription>
              </DialogHeader>
              {docDialog.type === "reject" && (
                <div className="space-y-2">
                  <Label htmlFor="doc-reason">Reason (emailed to trader)</Label>
                  <Textarea
                    id="doc-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    placeholder='e.g. The ID photo is blurry and the expiry date is not legible. Please re-upload a clear scan of both sides.'
                    className={reasonViolationText ? "border-destructive focus-visible:ring-destructive" : undefined}
                    data-testid="textarea-doc-reason"
                  />
                  <p className="text-xs text-muted-foreground">
                    The trader will receive an email with this reason and can re-upload the document.
                  </p>
                  {reasonViolationText ? (
                    <Alert variant="destructive" data-testid="violation-doc-reason">
                      <AlertTriangle className="w-4 h-4" />
                      <AlertDescription>{reasonViolationText}</AlertDescription>
                    </Alert>
                  ) : null}
                </div>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDocDialog(null)}>Cancel</Button>
                <Button
                  variant={docDialog.type === "reject" ? "destructive" : "default"}
                  onClick={submitDocAction}
                  disabled={
                    docActionMutation.isPending ||
                    (docDialog.type === "reject" && !!reasonViolation)
                  }
                  data-testid="button-confirm-doc-action"
                >
                  {docActionMutation.isPending
                    ? "Working…"
                    : docDialog.type === "approve"
                      ? "Approve"
                      : "Reject & email trader"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!preview}
        onOpenChange={(o) => {
          if (!o) closePreview();
        }}
      >
        <DialogContent className="max-w-4xl">
          {preview && (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <DialogTitle className="truncate">
                      {labelForDocType(preview.doc.type)}
                    </DialogTitle>
                    <DialogDescription className="truncate">
                      {preview.doc.originalFilename}
                    </DialogDescription>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={openInNewTab}
                      disabled={preview.status !== "ready"}
                      data-testid="button-preview-external"
                    >
                      <ExternalLink className="w-4 h-4 mr-1" /> Open in new tab
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownloadDocument(preview.doc)}
                      data-testid="button-preview-download"
                    >
                      <Download className="w-4 h-4 mr-1" /> Download
                    </Button>
                  </div>
                </div>
              </DialogHeader>

              <div className="bg-muted/40 rounded-md min-h-[60vh] flex items-center justify-center overflow-hidden">
                {preview.status === "loading" && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading secure preview…
                  </div>
                )}
                {preview.status === "error" && (
                  <Alert variant="destructive" className="m-4">
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription>
                      Could not load document: {preview.error}
                    </AlertDescription>
                  </Alert>
                )}
                {preview.status === "unsupported" && (
                  <div className="text-sm text-muted-foreground p-6 text-center">
                    This file type ({preview.mimeType ?? "unknown"}) cannot be previewed in the
                    browser. Use Download to inspect it locally.
                  </div>
                )}
                {preview.status === "ready" && preview.url && preview.mimeType?.startsWith("image/") && (
                  <img
                    src={preview.url}
                    alt={preview.doc.originalFilename}
                    className="max-h-[70vh] max-w-full object-contain"
                    data-testid="img-doc-preview"
                  />
                )}
                {preview.status === "ready" && preview.url && preview.mimeType === "application/pdf" && (
                  <iframe
                    src={preview.url}
                    title={preview.doc.originalFilename}
                    className="w-full h-[70vh] border-0 bg-white"
                    // allow-same-origin is required so the iframe can fetch the
                    // blob URL we created in the parent document; scripts and
                    // forms remain disabled, and the embedded PDF is rendered
                    // by the browser's built-in viewer (no inline script
                    // execution from the file itself).
                    sandbox="allow-same-origin"
                    data-testid="iframe-doc-preview"
                  />
                )}
              </div>

              <p className="text-[11px] text-muted-foreground">
                This access has been recorded in the audit log
                {accessReason.trim() ? ` with reason: "${accessReason.trim()}"` : ""}.
              </p>

              <DialogFooter>
                <Button variant="ghost" onClick={closePreview} data-testid="button-preview-close">
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value, full, extra }: { label: string; value: string | null | undefined; full?: boolean; extra?: string }) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <div className="text-xs uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className="mt-0.5 break-words">
        {value || "—"}
        {extra && <span className="ml-2 text-xs text-muted-foreground">({extra})</span>}
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/traders" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center">
      <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to traders
    </Link>
  );
}

const GREEN = "bg-emerald-100 text-emerald-800 border-transparent";
const AMBER = "bg-amber-100 text-amber-900 border-transparent";
const RED = "bg-red-100 text-red-800 border-transparent";
const GREY = "bg-muted text-muted-foreground border-transparent";

function CheckBadge({ label, className, testId }: { label: string; className: string; testId?: string }) {
  return (
    <Badge variant="outline" className={`${className} font-medium`} data-testid={testId}>
      {label}
    </Badge>
  );
}

function AiVerdictBadge({ verdict }: { verdict: "MATCH" | "PARTIAL_MATCH" | "NO_MATCH" | "NOT_FOUND" | "ERROR" }) {
  const map: Record<string, { label: string; className: string }> = {
    MATCH: { label: "AI: Match", className: GREEN },
    PARTIAL_MATCH: { label: "AI: Partial match", className: AMBER },
    NO_MATCH: { label: "AI: No match", className: RED },
    NOT_FOUND: { label: "AI: Not found on CH", className: GREY },
    ERROR: { label: "AI: Check failed", className: GREY },
  };
  const v = map[verdict] ?? map.ERROR;
  return <CheckBadge label={v.label} className={v.className} testId="badge-ai-verdict" />;
}

function RegisterOverallBadge({ overall }: { overall: "PASS" | "REVIEW" | "FAIL" | "NOT_PROVIDED" | "ERROR" }) {
  const map: Record<string, { label: string; className: string }> = {
    PASS: { label: "Registers: Pass", className: GREEN },
    REVIEW: { label: "Registers: Review", className: AMBER },
    FAIL: { label: "Registers: Fail", className: RED },
    NOT_PROVIDED: { label: "Registers: Nothing to check", className: GREY },
    ERROR: { label: "Registers: Check failed", className: GREY },
  };
  const v = map[overall] ?? map.ERROR;
  return <CheckBadge label={v.label} className={v.className} testId="badge-register-overall" />;
}

const REGISTER_STATUS_MAP: Record<string, { label: string; className: string }> = {
  MATCH: { label: "Match", className: GREEN },
  NAME_MISMATCH: { label: "Name mismatch", className: AMBER },
  INACTIVE: { label: "Inactive", className: RED },
  NOT_FOUND: { label: "Not found", className: RED },
  INVALID: { label: "Invalid format", className: RED },
  NOT_PROVIDED: { label: "Not provided", className: GREY },
  ERROR: { label: "Check failed", className: GREY },
};

type CompanyStatus = NonNullable<TraderDetailResponse["profile"]["registerCheckData"]>["company"]["status"];
type VatStatus = NonNullable<TraderDetailResponse["profile"]["registerCheckData"]>["vat"]["status"];

function CompanyStatusBadge({ status }: { status: CompanyStatus }) {
  const v = REGISTER_STATUS_MAP[status] ?? REGISTER_STATUS_MAP.ERROR;
  return <CheckBadge label={v.label} className={v.className} />;
}

function VatStatusBadge({ status }: { status: VatStatus }) {
  const v = REGISTER_STATUS_MAP[status] ?? REGISTER_STATUS_MAP.ERROR;
  return <CheckBadge label={v.label} className={v.className} />;
}

function CompareRow({ label, a, b }: { label: string; a: string; b: string }) {
  const same = a.trim().toLowerCase() === b.trim().toLowerCase();
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span>
        <span className="block">{a}</span>
        <span className={`block ${same ? "text-emerald-700" : "text-foreground"}`}>{b}</span>
      </span>
    </div>
  );
}

function labelForDocType(type: string): string {
  switch (type) {
    case "ID_DOCUMENT": return "Photo ID";
    case "PROOF_OF_ADDRESS": return "Proof of address";
    case "INSURANCE": return "Public liability insurance";
    case "QUALIFICATION": return "Trade qualification";
    case "COMPANY_REGISTRATION": return "Company registration";
    case "VAT_REGISTRATION": return "VAT registration";
    case "BUSINESS_ADDRESS": return "Business address";
    case "AUTHORISATION": return "Authorisation letter";
    default: return "Other document";
  }
}
