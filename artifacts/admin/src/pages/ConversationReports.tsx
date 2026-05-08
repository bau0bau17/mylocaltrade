import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { ShieldAlert, MessageSquare, Eye, Check, X, Ban, AlertTriangle } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { detectContactInfo, contactViolationMessage } from "@/lib/content-filter";

interface AdminConversationReport {
  id: number;
  conversationId: number;
  reportedByUserId: number;
  reportedByRole: string;
  reason: string;
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  resolutionNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
  traderBusinessName: string;
  customerFullName: string;
  conversationStatus: string;
  contactBypassAttempts: number;
  contactBypassAttemptsRecent: number;
}

interface ContactBypassAttempt {
  id: number;
  userId: number;
  violationKind: string;
  source: string;
  snippet: string;
  createdAt: string;
}

interface AdminConvMessage {
  id: number;
  senderUserId: number | null;
  senderRole: string;
  body: string;
  systemMessage: boolean;
  createdAt: string;
}

interface AdminConvResponse {
  conversation: {
    id: number;
    customerName: string;
    customerEmail: string;
    traderBusinessName: string;
    status: string;
    traderStatus: string;
    createdAt: string;
    lastMessageAt: string;
  };
  messagesAccessible: boolean;
  messages: AdminConvMessage[];
  contactBypass: {
    threshold: number;
    total: number;
    recent: number;
    lastAt: string | null;
    attempts: ContactBypassAttempt[];
  };
}

const STATUS_TONE: Record<string, string> = {
  OPEN: "bg-red-500/10 text-red-600 border-red-500/30",
  RESOLVED: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  DISMISSED: "bg-muted text-muted-foreground border-border",
};

export default function ConversationReportsPage() {
  const [statusFilter, setStatusFilter] = useState<"OPEN" | "ALL">("OPEN");
  const [openConvId, setOpenConvId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "conversation-reports", statusFilter],
    queryFn: () =>
      api<{ reports: AdminConversationReport[] }>("/api/admin/conversation-reports", {
        query: statusFilter === "OPEN" ? { status: "OPEN" } : undefined,
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-red-500" />
            Conversation reports
          </h1>
          <p className="text-sm text-muted-foreground">
            Reported customer-trader conversations awaiting moderation.
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
            <ReportCard
              key={r.id}
              report={r}
              expanded={openConvId === r.conversationId}
              onToggle={() =>
                setOpenConvId((prev) => (prev === r.conversationId ? null : r.conversationId))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({
  report,
  expanded,
  onToggle,
}: {
  report: AdminConversationReport;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Card data-testid={`report-${report.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
              {report.traderBusinessName} ⇆ {report.customerFullName}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Reported by {report.reportedByRole} · {formatDateTime(report.createdAt)}
            </p>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            {report.reportedByRole === "system" ? (
              <Badge
                variant="outline"
                className="bg-amber-500/10 text-amber-700 border-amber-500/30"
                data-testid={`badge-auto-flagged-${report.id}`}
              >
                Auto-flagged
              </Badge>
            ) : null}
            {report.contactBypassAttempts > 0 ? (
              <Badge
                variant="outline"
                className="bg-amber-500/10 text-amber-700 border-amber-500/30 flex items-center gap-1"
                data-testid={`badge-bypass-${report.id}`}
                title={`${report.contactBypassAttemptsRecent} in the last 24h`}
              >
                <AlertTriangle className="w-3 h-3" />
                {report.contactBypassAttempts} contact-bypass
                {report.contactBypassAttempts === 1 ? " attempt" : " attempts"}
              </Badge>
            ) : null}
            <Badge variant="outline" className={STATUS_TONE[report.status]}>
              {report.status}
            </Badge>
            <Badge variant="outline">{report.conversationStatus.replace(/_/g, " ")}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Reason
          </div>
          <p className="text-sm whitespace-pre-wrap">{report.reason}</p>
        </div>
        {report.resolutionNotes ? (
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Resolution notes
            </div>
            <p className="text-sm whitespace-pre-wrap">{report.resolutionNotes}</p>
          </div>
        ) : null}
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={onToggle} data-testid={`btn-view-${report.id}`}>
            <Eye className="w-4 h-4 mr-1" />
            {expanded ? "Hide messages" : "View messages"}
          </Button>
          {report.status === "OPEN" ? (
            <ResolveActions reportId={report.id} />
          ) : null}
        </div>
        {expanded ? <ConversationMessages conversationId={report.conversationId} /> : null}
      </CardContent>
    </Card>
  );
}

function ConversationMessages({ conversationId }: { conversationId: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "conversation", conversationId],
    queryFn: () => api<AdminConvResponse>(`/api/admin/conversations/${conversationId}`),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load conversation.</AlertDescription>
      </Alert>
    );
  }
  if (!data) return null;
  const bypass = data.contactBypass;
  const bypassPanel =
    bypass && bypass.total > 0 ? (
      <div
        className="border border-amber-500/30 bg-amber-500/5 rounded-md p-3 space-y-2"
        data-testid={`bypass-panel-${conversationId}`}
      >
        <div className="flex items-center gap-2 text-amber-700 font-semibold text-sm">
          <AlertTriangle className="w-4 h-4" />
          Contact-bypass attempts: {bypass.total}
          <span className="text-xs font-normal text-muted-foreground">
            ({bypass.recent} in the last 24h · threshold {bypass.threshold})
          </span>
        </div>
        {bypass.attempts.length > 0 ? (
          <ul className="space-y-1 text-xs max-h-48 overflow-y-auto">
            {bypass.attempts.map((a) => (
              <li key={a.id} className="border-b border-amber-500/20 last:border-0 pb-1">
                <span className="font-mono uppercase text-amber-700">{a.violationKind}</span>
                <span className="text-muted-foreground"> · {a.source} · {formatDateTime(a.createdAt)}</span>
                <p className="whitespace-pre-wrap break-words">{a.snippet}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    ) : null;
  if (!data.messagesAccessible) {
    return (
      <div className="space-y-3">
        {bypassPanel}
        <Alert>
          <AlertDescription>
            Messages are not accessible (no active report on this conversation).
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {bypassPanel}
      <div className="border rounded-md bg-muted/30 max-h-96 overflow-y-auto p-3 space-y-2">
      {data.messages.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No messages.</p>
      ) : (
        data.messages.map((m) => (
          <div key={m.id} className="text-sm border-b border-border/50 pb-2 last:border-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold uppercase text-xs tracking-wide text-primary">
                {m.senderRole}
              </span>
              <span className="text-xs text-muted-foreground">{formatDateTime(m.createdAt)}</span>
            </div>
            <p className={m.systemMessage ? "italic text-muted-foreground" : ""}>{m.body}</p>
          </div>
        ))
      )}
      </div>
    </div>
  );
}

function ResolveActions({ reportId }: { reportId: number }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);

  const violation = useMemo(() => detectContactInfo(notes), [notes]);
  const violationText = violation ? contactViolationMessage(violation) : null;

  const mutation = useMutation({
    mutationFn: (action: "resolve" | "dismiss" | "block") =>
      api<{ ok: boolean }>(`/api/admin/conversation-reports/${reportId}/resolve`, {
        method: "POST",
        body: { action, notes: notes.trim() || undefined },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "conversation-reports"] });
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
        <Button
          size="sm"
          variant="destructive"
          onClick={() => mutation.mutate("block")}
          disabled={blocked}
          data-testid={`btn-block-${reportId}`}
        >
          <Ban className="w-4 h-4 mr-1" /> Block conversation
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
