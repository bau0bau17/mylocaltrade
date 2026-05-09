import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, downloadAuthed, viewAuthed, ApiError } from "@/lib/api";
import { queryClient as qc } from "@/lib/queryClient";
import type { TraderDetailResponse, TraderDocument } from "@/lib/types";
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
  AlertTriangle,
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

const ACTION_LABELS: Record<ActionType, { title: string; description: string; needsReason: "required" | "optional" | "none"; verb: string; variant?: "destructive" }> = {
  approve: {
    title: "Approve trader",
    description: "Grant verified status. Optionally add internal notes.",
    needsReason: "optional",
    verb: "Approve",
  },
  reject: {
    title: "Reject trader",
    description: "Provide a reason — this will be visible to the trader.",
    needsReason: "required",
    verb: "Reject",
    variant: "destructive",
  },
  suspend: {
    title: "Suspend trader",
    description: "Temporarily disable this trader's account. Provide a reason for the audit log.",
    needsReason: "required",
    verb: "Suspend",
    variant: "destructive",
  },
  "request-info": {
    title: "Request more information",
    description: "Ask the trader for additional details. Notes are required.",
    needsReason: "required",
    verb: "Send request",
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
  const [reason, setReason] = useState("");
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

  async function handleViewDocument(doc: TraderDocument) {
    try {
      // Stream the file through the authenticated endpoint and open it as a
      // blob so we never hand a signed URL to the browser address bar.
      // viewAuthed checks the Content-Type and only opens safe types inline;
      // anything else falls back to a forced download.
      await viewAuthed(`/api/admin/documents/${doc.id}/file`, doc.originalFilename);
    } catch (err) {
      toast({
        title: "Could not open document",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function handleDownloadDocument(doc: TraderDocument) {
    try {
      await downloadAuthed(`/api/admin/documents/${doc.id}/file`, doc.originalFilename);
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

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile" data-testid="tab-profile">Profile</TabsTrigger>
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
              <Field label="Terms accepted" value={`${formatDateTime(profile.termsAcceptedAt)} (v${profile.termsVersion ?? "—"})`} />
              <Field label="Privacy accepted" value={`${formatDateTime(profile.privacyAcceptedAt)} (v${profile.privacyVersion ?? "—"})`} />
              <Field
                label="Description"
                value={profile.businessDescription || "—"}
                full
              />
              <Field label="Admin notes" value={profile.adminNotes || "—"} full />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Verification documents</CardTitle>
            </CardHeader>
            <CardContent>
              {documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No documents uploaded.</p>
              ) : (
                <div className="space-y-3">
                  {documents.map((doc) => {
                    const days = daysUntil(doc.expiresAt);
                    const expSoon = days != null && days >= 0 && days <= 30;
                    const expired = doc.status === "EXPIRED" || (days != null && days < 0);
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
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <Button size="sm" variant="ghost" onClick={() => handleViewDocument(doc)} data-testid={`button-view-${doc.id}`}>
                            <ExternalLink className="w-4 h-4 mr-1" /> View
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDownloadDocument(doc)} data-testid={`button-download-${doc.id}`}>
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
                  {auditLog.map((e) => (
                    <li key={e.id} className="py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">{e.action.replace(/_/g, " ")}</div>
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
                  ))}
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
                  <Label htmlFor="doc-reason">Reason (visible to trader)</Label>
                  <Textarea
                    id="doc-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    className={reasonViolationText ? "border-destructive focus-visible:ring-destructive" : undefined}
                    data-testid="textarea-doc-reason"
                  />
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
                      : "Reject"}
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

function labelForDocType(type: string): string {
  switch (type) {
    case "ID_DOCUMENT": return "Photo ID";
    case "PROOF_OF_ADDRESS": return "Proof of address";
    case "INSURANCE": return "Public liability insurance";
    case "QUALIFICATION": return "Trade qualification";
    default: return "Other document";
  }
}
