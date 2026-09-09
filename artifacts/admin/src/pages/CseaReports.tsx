import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert } from "lucide-react";
import { formatDateTime } from "@/lib/format";

interface RestrictedUserReport {
  id: number; reporterUserId: number; reportedUserId: number; reportedRole: string;
  category: string; detail: string | null; reviewId: number | null;
  cseaEscalatedAt: string; cseaEscalatedByAdminId: number | null; createdAt: string;
}
interface RestrictedConversationReport {
  id: number; conversationId: number; reportedByUserId: number; reason: string;
  messageId: number | null; category: string | null; detail: string | null;
  cseaEscalatedAt: string; cseaEscalatedByAdminId: number | null; createdAt: string;
}

export default function CseaReportsPage() {
  const qc = useQueryClient();
  const activeQuery = useQuery({
    queryKey: ["admin", "csea-reports"],
    queryFn: () => api<{ userReports: RestrictedUserReport[]; conversationReports: RestrictedConversationReport[] }>("/api/admin/csea-reports"),
  });
  const candidateQuery = useQuery({
    queryKey: ["admin", "csea-candidates"],
    queryFn: () => api<{ userReports: RestrictedUserReport[]; conversationReports: RestrictedConversationReport[] }>("/api/admin/csea-candidates"),
  });
  const users = activeQuery.data?.userReports ?? [];
  const conversations = activeQuery.data?.conversationReports ?? [];
  const candidateUsers = candidateQuery.data?.userReports ?? [];
  const candidateConversations = candidateQuery.data?.conversationReports ?? [];
  const error = activeQuery.error ?? candidateQuery.error;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><ShieldAlert className="w-6 h-6 text-red-500" /> Restricted specialist queue</h1>
        <p className="text-sm text-muted-foreground">Access is limited to authorised CSEA specialist admins. Handle manually using the approved specialist process; do not copy sensitive content into notes or external systems.</p>
      </div>
      {error ? <Alert variant="destructive"><AlertDescription>{error instanceof ApiError ? error.message : "Specialist access is required to load this queue."}</AlertDescription></Alert> : null}
      {activeQuery.isLoading || candidateQuery.isLoading ? <Skeleton className="h-32 w-full" /> : null}
      <h2 className="text-lg font-semibold pt-2">Intake candidates</h2>
      <p className="text-sm text-muted-foreground">Un-escalated suspected-illegal-content reports. Escalate only after following the approved intake process.</p>
      {candidateUsers.map((report) => <RestrictedCard key={`candidate-u-${report.id}`} kind="user" mode="candidate" report={report} onSuccess={() => { qc.invalidateQueries({ queryKey: ["admin", "csea-candidates"] }); qc.invalidateQueries({ queryKey: ["admin", "csea-reports"] }); }} />)}
      {candidateConversations.map((report) => <RestrictedCard key={`candidate-c-${report.id}`} kind="conversation" mode="candidate" report={report} onSuccess={() => { qc.invalidateQueries({ queryKey: ["admin", "csea-candidates"] }); qc.invalidateQueries({ queryKey: ["admin", "csea-reports"] }); }} />)}
      {candidateUsers.length === 0 && candidateConversations.length === 0 && !candidateQuery.isLoading ? <p className="text-sm text-muted-foreground">No intake candidates.</p> : null}
      <h2 className="text-lg font-semibold pt-4">Active restricted cases</h2>
      <p className="text-sm text-muted-foreground">Escalated cases awaiting specialist manual handling. Mark complete only when the approved process is finished.</p>
      {users.map((report) => <RestrictedCard key={`u-${report.id}`} kind="user" mode="active" report={report} onSuccess={() => qc.invalidateQueries({ queryKey: ["admin", "csea-reports"] })} />)}
      {conversations.map((report) => <RestrictedCard key={`c-${report.id}`} kind="conversation" mode="active" report={report} onSuccess={() => qc.invalidateQueries({ queryKey: ["admin", "csea-reports"] })} />)}
      {users.length === 0 && conversations.length === 0 && !activeQuery.isLoading ? <p className="text-sm text-muted-foreground">No active restricted cases.</p> : null}
    </div>
  );
}

function RestrictedCard({ kind, mode, report, onSuccess }: { kind: "user" | "conversation"; mode: "candidate" | "active"; report: RestrictedUserReport | RestrictedConversationReport; onSuccess: () => void }) {
  const id = report.id;
  const mutation = useMutation({
    mutationFn: () => api(mode === "candidate"
      ? `/api/admin/${kind === "user" ? "user-reports" : "conversation-reports"}/${id}/csea-escalate`
      : `/api/admin/csea-reports/${kind}/${id}/complete`, { method: "POST" }),
    onSuccess,
  });
  const user = kind === "user";
  return (
    <Card data-testid={`csea-${kind}-${id}`} className="border-red-500/40">
      <CardHeader className="pb-3 flex-row items-start justify-between gap-3">
        <CardTitle className="text-base flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-red-500" /> {user ? "User/profile/review report" : "Conversation/message report"}</CardTitle>
        <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/30">Restricted</Badge>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-xs text-muted-foreground">Report #{id} · escalated {formatDateTime(report.cseaEscalatedAt)} · manual handling only</p>
        {user ? <p>Category: {(report as RestrictedUserReport).category} · reporter #{(report as RestrictedUserReport).reporterUserId} · subject #{(report as RestrictedUserReport).reportedUserId}{(report as RestrictedUserReport).reviewId ? ` · review #${(report as RestrictedUserReport).reviewId}` : ""}</p> : <p>Category: {(report as RestrictedConversationReport).category ?? "conversation report"} · message #{(report as RestrictedConversationReport).messageId ?? "not specified"} · conversation #{(report as RestrictedConversationReport).conversationId}</p>}
        <p className="text-xs text-red-700 font-medium">Use the approved specialist channel and record only the minimum necessary audit information. Do not copy sensitive content.</p>
        <Button size="sm" variant={mode === "candidate" ? "destructive" : "outline"} onClick={() => mutation.mutate()} disabled={mutation.isPending} data-testid={`csea-${mode}-${kind}-${id}`}>
          {mode === "candidate" ? "Intake and escalate" : "Mark handled and complete"}
        </Button>
        {mutation.error ? <Alert variant="destructive"><AlertDescription>{mutation.error instanceof ApiError ? mutation.error.message : "Specialist action failed."}</AlertDescription></Alert> : null}
      </CardContent>
    </Card>
  );
}