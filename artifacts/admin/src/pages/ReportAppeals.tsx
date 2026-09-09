import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Gavel } from "lucide-react";
import { formatDateTime } from "@/lib/format";

type Outcome = "ACTION_TAKEN" | "NO_VIOLATION" | "INSUFFICIENT_EVIDENCE" | "REFERRED_ESCALATED";
const outcomes: Outcome[] = ["ACTION_TAKEN", "NO_VIOLATION", "INSUFFICIENT_EVIDENCE", "REFERRED_ESCALATED"];

interface Appeal {
  id: number;
  reportId: number | null;
  conversationReportId: number | null;
  appellantUserId: number;
  reason: string;
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  resolution: Outcome | null;
  resolutionNotes: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export default function ReportAppealsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"OPEN" | "ALL">("OPEN");
  const query = useQuery({
    queryKey: ["admin", "report-appeals", filter],
    queryFn: () => api<{ appeals: Appeal[] }>("/api/admin/report-appeals"),
  });
  const appeals = (query.data?.appeals ?? []).filter((a) => filter === "ALL" || a.status === "OPEN");
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Gavel className="w-6 h-6 text-amber-500" /> Report appeals</h1>
          <p className="text-sm text-muted-foreground">Internal review queue. Decisions are never shown to the reported user.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={filter === "OPEN" ? "default" : "outline"} onClick={() => setFilter("OPEN")}>Open</Button>
          <Button size="sm" variant={filter === "ALL" ? "default" : "outline"} onClick={() => setFilter("ALL")}>All</Button>
        </div>
      </div>
      {query.error ? <Alert variant="destructive"><AlertDescription>{query.error instanceof ApiError ? query.error.message : "Could not load appeals."}</AlertDescription></Alert> : null}
      {query.isLoading ? <Skeleton className="h-32 w-full" /> : appeals.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No appeals {filter === "OPEN" ? "currently open" : "yet"}.</CardContent></Card>
      ) : appeals.map((appeal) => <AppealCard key={appeal.id} appeal={appeal} onSuccess={() => qc.invalidateQueries({ queryKey: ["admin", "report-appeals"] })} />)}
    </div>
  );
}

function AppealCard({ appeal, onSuccess }: { appeal: Appeal; onSuccess: () => void }) {
  const [outcome, setOutcome] = useState<Outcome>("ACTION_TAKEN");
  const [notes, setNotes] = useState("");
  const mutation = useMutation({
    mutationFn: (action: "resolve" | "dismiss") => api(`/api/admin/report-appeals/${appeal.id}/resolve`, {
      method: "POST", body: { action, outcome: action === "dismiss" ? "NO_VIOLATION" : outcome, notes: notes.trim() || undefined },
    }),
    onSuccess,
  });
  return (
    <Card data-testid={`appeal-${appeal.id}`}>
      <CardHeader className="pb-3 flex-row items-start justify-between gap-3">
        <CardTitle className="text-base">Appeal #{appeal.id}</CardTitle>
        <Badge variant="outline">{appeal.status}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Filed by user #{appeal.appellantUserId} · {formatDateTime(appeal.createdAt)} · Original report {appeal.reportId ?? appeal.conversationReportId ?? "unknown"}</p>
        <div><div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Appeal reason</div><p className="text-sm whitespace-pre-wrap">{appeal.reason}</p></div>
        {appeal.status === "OPEN" ? <div className="space-y-2">
          <div className="flex gap-2 flex-wrap">
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" data-testid={`appeal-outcome-${appeal.id}`}>
              {outcomes.map((item) => <option key={item} value={item}>{item.replace(/_/g, " ")}</option>)}
            </select>
            <Button size="sm" onClick={() => mutation.mutate("resolve")} disabled={mutation.isPending} data-testid={`appeal-resolve-${appeal.id}`}>Accept decision</Button>
            <Button size="sm" variant="outline" onClick={() => mutation.mutate("dismiss")} disabled={mutation.isPending} data-testid={`appeal-dismiss-${appeal.id}`}>Dismiss appeal</Button>
          </div>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal decision notes (audit log); do not copy sensitive content." rows={2} />
        </div> : <p className="text-sm text-muted-foreground">Outcome: {appeal.resolution?.replace(/_/g, " ")}</p>}
        {mutation.error ? <Alert variant="destructive"><AlertDescription>{mutation.error instanceof ApiError ? mutation.error.message : "Action failed."}</AlertDescription></Alert> : null}
      </CardContent>
    </Card>
  );
}