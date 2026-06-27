import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Ban, Check, X, Apple } from "lucide-react";
import { formatDateTime } from "@/lib/format";

interface AdminCancellationRequest {
  id: number;
  userId: number;
  traderName: string | null;
  traderEmail: string | null;
  businessName: string | null;
  provider: "apple" | "stripe" | "demo";
  withinCoolingOff: boolean;
  originalPurchaseAt: string | null;
  coolingOffEndsAt: string | null;
  userNote: string | null;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "DISMISSED";
  resolutionNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<string, string> = {
  OPEN: "bg-red-500/10 text-red-600 border-red-500/30",
  IN_PROGRESS: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  RESOLVED: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  DISMISSED: "bg-muted text-muted-foreground border-border",
};

const PROVIDER_LABEL: Record<string, string> = {
  apple: "Apple (App Store)",
  stripe: "Stripe (web)",
  demo: "Demo",
};

export default function CancellationRequestsPage() {
  const [statusFilter, setStatusFilter] = useState<"OPEN" | "ALL">("OPEN");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "cancellation-requests", statusFilter],
    queryFn: () =>
      api<{ requests: AdminCancellationRequest[] }>("/api/admin/cancellation-requests", {
        query: statusFilter === "OPEN" ? { status: "OPEN" } : undefined,
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Ban className="w-6 h-6 text-red-500" />
            Cancellation requests
          </h1>
          <p className="text-sm text-muted-foreground">
            Cooling-off and cancellation requests filed by traders. Apple-owned subscriptions are
            cancelled and refunded by Apple — assist the trader and record the outcome here.
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
            {error instanceof ApiError ? error.message : "Could not load cancellation requests."}
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
            No cancellation requests {statusFilter === "OPEN" ? "currently open" : "yet"}.
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

function subjectName(request: AdminCancellationRequest): string {
  return request.businessName || request.traderName || `User #${request.userId}`;
}

function RequestCard({ request }: { request: AdminCancellationRequest }) {
  const isApple = request.provider === "apple";
  return (
    <Card data-testid={`request-${request.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Ban className="w-4 h-4 text-muted-foreground" />
              {subjectName(request)}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {request.traderName || `#${request.userId}`} requested cancellation ·{" "}
              {formatDateTime(request.createdAt)}
            </p>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <Badge variant="outline" className="flex items-center gap-1">
              {isApple ? <Apple className="w-3 h-3" /> : null}
              {PROVIDER_LABEL[request.provider] ?? request.provider}
            </Badge>
            {request.withinCoolingOff ? (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
                Within cooling-off
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
                Outside cooling-off
              </Badge>
            )}
            <Badge variant="outline" className={STATUS_TONE[request.status]}>
              {request.status}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-1 text-sm">
          <div>
            <span className="text-muted-foreground">Trader: </span>
            {request.traderName || "Unknown"}{" "}
            {request.traderEmail ? (
              <span className="text-muted-foreground">({request.traderEmail})</span>
            ) : null}
          </div>
          {request.originalPurchaseAt ? (
            <div>
              <span className="text-muted-foreground">First purchase: </span>
              {formatDateTime(request.originalPurchaseAt)}
            </div>
          ) : null}
          {request.coolingOffEndsAt ? (
            <div>
              <span className="text-muted-foreground">Cooling-off ends: </span>
              {formatDateTime(request.coolingOffEndsAt)}
            </div>
          ) : null}
        </div>
        {isApple ? (
          <Alert>
            <AlertDescription className="text-xs">
              Apple owns this subscription. Cancellation and any refund are handled by Apple — do not
              attempt to issue a refund from our side. Help the trader through Apple and record the
              outcome.
            </AlertDescription>
          </Alert>
        ) : null}
        {request.userNote ? (
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Trader note
            </div>
            <p className="text-sm whitespace-pre-wrap">{request.userNote}</p>
          </div>
        ) : null}
        {request.resolutionNotes ? (
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Resolution notes
            </div>
            <p className="text-sm whitespace-pre-wrap">{request.resolutionNotes}</p>
          </div>
        ) : null}
        {request.status === "OPEN" || request.status === "IN_PROGRESS" ? (
          <ResolveActions requestId={request.id} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function ResolveActions({ requestId }: { requestId: number }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);

  const mutation = useMutation({
    mutationFn: (action: "resolve" | "dismiss") =>
      api<{ ok: boolean }>(`/api/admin/cancellation-requests/${requestId}/resolve`, {
        method: "POST",
        body: { action, notes: notes.trim() || undefined },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "cancellation-requests"] });
      setNotes("");
      setShowNotes(false);
    },
  });

  const blocked = mutation.isPending;

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          variant="default"
          onClick={() => mutation.mutate("resolve")}
          disabled={blocked}
          data-testid={`btn-resolve-${requestId}`}
        >
          <Check className="w-4 h-4 mr-1" /> Resolve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => mutation.mutate("dismiss")}
          disabled={blocked}
          data-testid={`btn-dismiss-${requestId}`}
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
          data-testid={`notes-${requestId}`}
        />
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
