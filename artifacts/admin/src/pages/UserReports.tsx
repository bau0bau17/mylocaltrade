import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Flag, Check, X, AlertTriangle } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { detectContactInfo, contactViolationMessage } from "@/lib/content-filter";

interface AdminUserReport {
  id: number;
  reporterUserId: number;
  reporterRole: string;
  reporterName: string | null;
  reporterEmail: string | null;
  reportedUserId: number;
  reportedRole: string;
  reportedName: string | null;
  reportedEmail: string | null;
  reportedTraderProfileId: number | null;
  reportedTraderBusinessName: string | null;
  category: string;
  categoryLabel: string;
  detail: string | null;
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  resolutionNotes: string | null;
  resolvedAt: string | null;
  conversationId: number | null;
  createdAt: string;
}

const STATUS_TONE: Record<string, string> = {
  OPEN: "bg-red-500/10 text-red-600 border-red-500/30",
  RESOLVED: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  DISMISSED: "bg-muted text-muted-foreground border-border",
};

export default function UserReportsPage() {
  const [statusFilter, setStatusFilter] = useState<"OPEN" | "ALL">("OPEN");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "user-reports", statusFilter],
    queryFn: () =>
      api<{ reports: AdminUserReport[] }>("/api/admin/user-reports", {
        query: statusFilter === "OPEN" ? { status: "OPEN" } : undefined,
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Flag className="w-6 h-6 text-red-500" />
            User reports
          </h1>
          <p className="text-sm text-muted-foreground">
            Reports raised against traders and customers awaiting moderation.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={statusFilter === "OPEN" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter("OPEN")}
            data-testid="filter-open"
          >
            Open
          </Button>
          <Button
            variant={statusFilter === "ALL" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter("ALL")}
            data-testid="filter-all"
          >
            All
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof ApiError ? error.message : "Could not load reports."}
          </AlertDescription>
        </Alert>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : (data?.reports?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No reports {statusFilter === "OPEN" ? "currently open" : "yet"}.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data!.reports.map((r) => (
            <ReportCard key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function subjectName(report: AdminUserReport): string {
  if (report.reportedRole === "trader") {
    return report.reportedTraderBusinessName || report.reportedName || `User #${report.reportedUserId}`;
  }
  return report.reportedName || `User #${report.reportedUserId}`;
}

function ReportCard({ report }: { report: AdminUserReport }) {
  return (
    <Card data-testid={`report-${report.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Flag className="w-4 h-4 text-muted-foreground" />
              {report.categoryLabel}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {report.reporterRole === "customer" ? "Customer" : "Trader"}{" "}
              {report.reporterName || `#${report.reporterUserId}`} reported{" "}
              {report.reportedRole} {subjectName(report)} · {formatDateTime(report.createdAt)}
            </p>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <Badge variant="outline">{report.reportedRole}</Badge>
            <Badge variant="outline" className={STATUS_TONE[report.status]}>
              {report.status}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-1 text-sm">
          <div>
            <span className="text-muted-foreground">Reported by: </span>
            {report.reporterName || "Unknown"}{" "}
            {report.reporterEmail ? (
              <span className="text-muted-foreground">({report.reporterEmail})</span>
            ) : null}
          </div>
          <div>
            <span className="text-muted-foreground">Subject: </span>
            {subjectName(report)}{" "}
            {report.reportedEmail ? (
              <span className="text-muted-foreground">({report.reportedEmail})</span>
            ) : null}
          </div>
        </div>
        {report.detail ? (
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Detail
            </div>
            <p className="text-sm whitespace-pre-wrap">{report.detail}</p>
          </div>
        ) : null}
        {report.resolutionNotes ? (
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Resolution notes
            </div>
            <p className="text-sm whitespace-pre-wrap">{report.resolutionNotes}</p>
          </div>
        ) : null}
        {report.status === "OPEN" ? <ResolveActions reportId={report.id} /> : null}
      </CardContent>
    </Card>
  );
}

function ResolveActions({ reportId }: { reportId: number }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);

  const violation = useMemo(() => detectContactInfo(notes), [notes]);
  const violationText = violation ? contactViolationMessage(violation) : null;

  const mutation = useMutation({
    mutationFn: (action: "resolve" | "dismiss") =>
      api<{ ok: boolean }>(`/api/admin/user-reports/${reportId}/resolve`, {
        method: "POST",
        body: { action, notes: notes.trim() || undefined },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "user-reports"] });
      setNotes("");
      setShowNotes(false);
    },
  });

  const blocked = !!violation || mutation.isPending;

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          variant="default"
          onClick={() => mutation.mutate("resolve")}
          disabled={blocked}
          data-testid={`btn-resolve-${reportId}`}
        >
          <Check className="w-4 h-4 mr-1" /> Resolve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => mutation.mutate("dismiss")}
          disabled={blocked}
          data-testid={`btn-dismiss-${reportId}`}
        >
          <X className="w-4 h-4 mr-1" /> Dismiss
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowNotes((s) => !s)}>
          {showNotes ? "Hide notes" : "Add notes"}
        </Button>
      </div>
      {showNotes ? (
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional resolution notes (audit log)"
          rows={2}
          className={violationText ? "border-destructive focus-visible:ring-destructive" : undefined}
          data-testid={`notes-${reportId}`}
        />
      ) : null}
      {violationText ? (
        <Alert variant="destructive" data-testid={`violation-${reportId}`}>
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>{violationText}</AlertDescription>
        </Alert>
      ) : null}
      {mutation.error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {mutation.error instanceof ApiError ? mutation.error.message : "Action failed."}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
