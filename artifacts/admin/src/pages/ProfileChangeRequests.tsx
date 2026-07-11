import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { UserCog, Check, X, HelpCircle, ShieldCheck, ShieldAlert, History } from "lucide-react";
import { formatDateTime } from "@/lib/format";

interface AdminProfileChangeRequest {
  id: number;
  userId: number;
  role: "trader" | "customer";
  traderProfileId: number | null;
  user: { id: number; email: string; fullName: string } | null;
  businessName: string | null;
  field: string;
  fieldLabel: string;
  sensitive: boolean;
  currentValue: string | null;
  proposedValue: string | null;
  status: "PENDING" | "NEEDS_INFO" | "APPROVED" | "REJECTED" | "CANCELLED";
  phoneOtpVerified: boolean;
  phoneOtpVerifiedAt: string | null;
  adminInfoRequest: string | null;
  decisionReason: string | null;
  decidedByAdminId: number | null;
  decidedByEmail: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_TONE: Record<string, string> = {
  PENDING: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  NEEDS_INFO: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  APPROVED: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  REJECTED: "bg-red-500/10 text-red-600 border-red-500/30",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending review",
  NEEDS_INFO: "Awaiting info",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled by user",
};

type RoleFilter = "" | "trader" | "customer";
type StatusFilter = "ACTIVE" | "ALL";

export default function ProfileChangeRequestsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ACTIVE");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "profile-change-requests", statusFilter, roleFilter],
    queryFn: () =>
      api<{ requests: AdminProfileChangeRequest[] }>("/api/admin/profile-change-requests", {
        query: {
          ...(statusFilter === "ACTIVE" ? { status: "ACTIVE" } : {}),
          ...(roleFilter ? { role: roleFilter } : {}),
        },
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <UserCog className="w-6 h-6 text-primary" />
            Profile change requests
          </h1>
          <p className="text-sm text-muted-foreground">
            Requested changes to protected identity and business details. The live value stays
            unchanged until a change is approved here.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={statusFilter === "ACTIVE" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter("ACTIVE")}
            data-testid="filter-active"
          >
            Needs action
          </Button>
          <Button
            variant={statusFilter === "ALL" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter("ALL")}
            data-testid="filter-all"
          >
            All
          </Button>
          <span className="w-px bg-border mx-1" />
          <Button
            variant={roleFilter === "" ? "default" : "outline"}
            size="sm"
            onClick={() => setRoleFilter("")}
            data-testid="filter-role-all"
          >
            Everyone
          </Button>
          <Button
            variant={roleFilter === "trader" ? "default" : "outline"}
            size="sm"
            onClick={() => setRoleFilter("trader")}
            data-testid="filter-role-trader"
          >
            Traders
          </Button>
          <Button
            variant={roleFilter === "customer" ? "default" : "outline"}
            size="sm"
            onClick={() => setRoleFilter("customer")}
            data-testid="filter-role-customer"
          >
            Customers
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof ApiError ? error.message : "Could not load profile change requests."}
          </AlertDescription>
        </Alert>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : (data?.requests?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No profile change requests {statusFilter === "ACTIVE" ? "need action" : "yet"}.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data!.requests.map((r) => (
            <RequestCard key={r.id} request={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function subjectName(request: AdminProfileChangeRequest): string {
  if (request.role === "trader") {
    return request.businessName || request.user?.fullName || `User #${request.userId}`;
  }
  return request.user?.fullName || `User #${request.userId}`;
}

interface ChangeRequestEvent {
  id: number;
  actorUserId: number | null;
  actorRole: string | null;
  actorEmail: string | null;
  eventType: string;
  note: string | null;
  createdAt: string;
}

const EVENT_LABEL: Record<string, string> = {
  SUBMITTED: "Request submitted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  INFO_REQUESTED: "More information requested",
  CANCELLED: "Cancelled by user",
};

function RequestCard({ request }: { request: AdminProfileChangeRequest }) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<"approve" | "reject" | "info" | null>(null);
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const detail = useQuery({
    queryKey: ["admin", "profile-change-requests", "detail", request.id],
    queryFn: () =>
      api<{ request: AdminProfileChangeRequest; events: ChangeRequestEvent[] }>(
        `/api/admin/profile-change-requests/${request.id}`,
      ),
    enabled: showHistory,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "profile-change-requests"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "attention-counts"] });
  };

  const approve = useMutation({
    mutationFn: () =>
      api<{ request: AdminProfileChangeRequest }>(
        `/api/admin/profile-change-requests/${request.id}/approve`,
        { method: "POST", body: { reason: note.trim() } },
      ),
    onSuccess: () => {
      setAction(null);
      setNote("");
      setActionError(null);
      invalidate();
    },
    onError: (e) =>
      setActionError(e instanceof ApiError ? e.message : "Could not approve this change."),
  });

  const reject = useMutation({
    mutationFn: () =>
      api<{ request: AdminProfileChangeRequest }>(
        `/api/admin/profile-change-requests/${request.id}/reject`,
        { method: "POST", body: { reason: note.trim() } },
      ),
    onSuccess: () => {
      setAction(null);
      setNote("");
      setActionError(null);
      invalidate();
    },
    onError: (e) =>
      setActionError(e instanceof ApiError ? e.message : "Could not reject this change."),
  });

  const requestInfo = useMutation({
    mutationFn: () =>
      api<{ request: AdminProfileChangeRequest }>(
        `/api/admin/profile-change-requests/${request.id}/request-info`,
        { method: "POST", body: { message: note.trim() } },
      ),
    onSuccess: () => {
      setAction(null);
      setNote("");
      setActionError(null);
      invalidate();
    },
    onError: (e) =>
      setActionError(e instanceof ApiError ? e.message : "Could not request more information."),
  });

  const busy = approve.isPending || reject.isPending || requestInfo.isPending;
  const active = request.status === "PENDING" || request.status === "NEEDS_INFO";

  const startAction = (next: "approve" | "reject" | "info") => {
    setActionError(null);
    setNote("");
    setAction((prev) => (prev === next ? null : next));
  };

  const confirm = () => {
    if (action === "approve") approve.mutate();
    else if (action === "reject") reject.mutate();
    else if (action === "info") requestInfo.mutate();
  };

  const confirmDisabled =
    busy ||
    (action === "reject" && note.trim().length < 3) ||
    (action === "info" && note.trim().length < 3) ||
    (action === "approve" && request.sensitive && note.trim().length < 3);

  return (
    <Card data-testid={`change-request-${request.id}`}>
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="font-medium flex items-center gap-2 flex-wrap">
              {subjectName(request)}
              <Badge variant="outline" className="capitalize">
                {request.role}
              </Badge>
              <Badge variant="outline" className={STATUS_TONE[request.status] ?? ""}>
                {STATUS_LABEL[request.status] ?? request.status}
              </Badge>
              {request.sensitive ? (
                <Badge variant="outline" className="bg-purple-500/10 text-purple-600 border-purple-500/30">
                  Sensitive
                </Badge>
              ) : null}
            </div>
            <div className="text-sm text-muted-foreground">
              {request.user?.email ?? "—"} · Submitted {formatDateTime(request.createdAt)}
            </div>
          </div>
          {request.field === "phone" ? (
            <div className="flex items-center gap-1.5 text-sm">
              {request.phoneOtpVerified ? (
                <>
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span className="text-emerald-600">
                    OTP verified{request.phoneOtpVerifiedAt ? ` ${formatDateTime(request.phoneOtpVerifiedAt)}` : ""}
                  </span>
                </>
              ) : (
                <>
                  <ShieldAlert className="w-4 h-4 text-red-600" />
                  <span className="text-red-600">Not OTP verified</span>
                </>
              )}
            </div>
          ) : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-md border bg-muted/40 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Current {request.fieldLabel.toLowerCase()}
            </div>
            <div className="text-sm break-words">{request.currentValue || <em>Empty</em>}</div>
          </div>
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Proposed {request.fieldLabel.toLowerCase()}
            </div>
            <div className="text-sm break-words font-medium">
              {request.proposedValue || <em>Empty</em>}
            </div>
          </div>
        </div>

        {request.adminInfoRequest && request.status === "NEEDS_INFO" ? (
          <div className="text-sm text-blue-600 bg-blue-500/10 border border-blue-500/30 rounded-md p-3">
            Info requested: {request.adminInfoRequest}
          </div>
        ) : null}

        {request.decisionReason && (request.status === "APPROVED" || request.status === "REJECTED") ? (
          <div className="text-sm text-muted-foreground">
            Decision{request.decidedByEmail ? ` by ${request.decidedByEmail}` : ""}
            {request.decidedAt ? ` on ${formatDateTime(request.decidedAt)}` : ""}: {request.decisionReason}
          </div>
        ) : null}

        <div>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setShowHistory((s) => !s)}
            data-testid={`history-${request.id}`}
          >
            <History className="w-4 h-4 mr-1" />
            {showHistory ? "Hide history" : "View history"}
          </Button>
          {showHistory ? (
            detail.isLoading ? (
              <Skeleton className="h-16 w-full mt-2" />
            ) : detail.error ? (
              <div className="text-sm text-destructive mt-2">Could not load history.</div>
            ) : (
              <ol className="mt-2 space-y-2 border-l pl-4">
                {(detail.data?.events ?? []).map((e) => (
                  <li key={e.id} className="text-sm">
                    <span className="font-medium">{EVENT_LABEL[e.eventType] ?? e.eventType}</span>
                    <span className="text-muted-foreground">
                      {" "}· {formatDateTime(e.createdAt)}
                      {e.actorEmail ? ` · ${e.actorEmail}` : e.actorRole ? ` · ${e.actorRole}` : ""}
                    </span>
                    {e.note ? (
                      <div className="text-muted-foreground text-xs mt-0.5">{e.note}</div>
                    ) : null}
                  </li>
                ))}
                {(detail.data?.events ?? []).length === 0 ? (
                  <li className="text-sm text-muted-foreground">No events recorded.</li>
                ) : null}
              </ol>
            )
          ) : null}
        </div>

        {actionError ? (
          <Alert variant="destructive">
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null}

        {active ? (
          <div className="space-y-2">
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant={action === "approve" ? "default" : "outline"}
                onClick={() => startAction("approve")}
                disabled={busy}
                data-testid={`approve-${request.id}`}
              >
                <Check className="w-4 h-4 mr-1" /> Approve
              </Button>
              <Button
                size="sm"
                variant={action === "reject" ? "destructive" : "outline"}
                onClick={() => startAction("reject")}
                disabled={busy}
                data-testid={`reject-${request.id}`}
              >
                <X className="w-4 h-4 mr-1" /> Reject
              </Button>
              <Button
                size="sm"
                variant={action === "info" ? "default" : "outline"}
                onClick={() => startAction("info")}
                disabled={busy}
                data-testid={`request-info-${request.id}`}
              >
                <HelpCircle className="w-4 h-4 mr-1" /> Request info
              </Button>
            </div>

            {action ? (
              <div className="space-y-2">
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    action === "approve"
                      ? request.sensitive
                        ? "Confirmation note (required for sensitive fields, e.g. checked supporting evidence)"
                        : "Optional note"
                      : action === "reject"
                        ? "Rejection reason (shown to the user)"
                        : "What extra information do you need from the user?"
                  }
                  rows={2}
                  data-testid={`note-${request.id}`}
                />
                <Button size="sm" onClick={confirm} disabled={confirmDisabled} data-testid={`confirm-${request.id}`}>
                  {busy
                    ? "Working…"
                    : action === "approve"
                      ? "Confirm approval"
                      : action === "reject"
                        ? "Confirm rejection"
                        : "Send request"}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
