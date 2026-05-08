import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, downloadAuthed } from "@/lib/api";
import type { AuditReport } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatDateTime } from "@/lib/format";
import { Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ACTION_OPTIONS = [
  "ALL",
  "TRADER_APPROVED",
  "TRADER_REJECTED",
  "TRADER_SUSPENDED",
  "TRADER_UNSUSPENDED",
  "ADMIN_REQUESTED_INFO",
  "DOCUMENT_APPROVED",
  "DOCUMENT_REJECTED",
  "DOCUMENT_EXPIRED",
  "DOCUMENT_UPLOADED",
  "TRADER_SUBMITTED_FOR_REVIEW",
  "BUSINESS_PROFILE_COMPLETED",
  "EMAIL_VERIFIED",
  "PHONE_VERIFIED",
  "SUBSCRIPTION_ACTIVATED",
  "SUBSCRIPTION_CANCELLED",
  "REVIEW_SUBMITTED",
  "REVIEW_APPROVED",
  "REVIEW_REJECTED",
  "REVIEW_FLAGGED",
];

const REVIEW_QUICK_FILTERS: Array<{ label: string; value: string }> = [
  { label: "All review activity", value: "REVIEW_ALL" },
  { label: "Submitted", value: "REVIEW_SUBMITTED" },
  { label: "Approved", value: "REVIEW_APPROVED" },
  { label: "Rejected", value: "REVIEW_REJECTED" },
  { label: "Flagged", value: "REVIEW_FLAGGED" },
];

function isReviewAction(a: string): boolean {
  return a.startsWith("REVIEW_");
}

function reviewIdFromDetails(details: unknown): number | null {
  if (details && typeof details === "object" && "reviewId" in details) {
    const v = (details as { reviewId: unknown }).reviewId;
    if (typeof v === "number") return v;
  }
  return null;
}

function isoDateOnly(value: string): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export default function AuditReportPage() {
  const { toast } = useToast();
  const today = new Date();
  const monthAgo = new Date(Date.now() - 30 * 86400000);
  const [from, setFrom] = useState(monthAgo.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [action, setAction] = useState<string>("ALL");

  const queryParams = useMemo(
    () => ({
      from: new Date(`${from}T00:00:00.000Z`).toISOString(),
      to: new Date(`${to}T23:59:59.999Z`).toISOString(),
      // REVIEW_ALL is a client-side composite filter; we fetch all rows in the
      // window and narrow on the client below.
      action: action === "ALL" || action === "REVIEW_ALL" ? undefined : action,
    }),
    [from, to, action],
  );

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "audit-report", queryParams],
    queryFn: () => api<AuditReport>("/api/admin/audit-report", { query: queryParams }),
  });

  async function handleExportCsv() {
    try {
      await downloadAuthed(
        `/api/admin/audit-report?from=${encodeURIComponent(queryParams.from)}&to=${encodeURIComponent(queryParams.to)}${
          queryParams.action ? `&action=${encodeURIComponent(queryParams.action)}` : ""
        }&format=csv`,
        `audit-${isoDateOnly(from)}-to-${isoDateOnly(to)}.csv`,
      );
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Audit report</h1>
        <p className="text-sm text-muted-foreground">Review compliance-grade actions across the platform.</p>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Moderation shortcuts</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {REVIEW_QUICK_FILTERS.map((q) => {
            const active =
              q.value === "REVIEW_ALL"
                ? action === "REVIEW_ALL"
                : action === q.value;
            return (
              <Button
                key={q.value}
                size="sm"
                variant={active ? "default" : "outline"}
                onClick={() => setAction(q.value)}
                data-testid={`btn-review-${q.value}`}
              >
                {q.label}
              </Button>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Filters</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="from">From</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="input-from" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">To</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="input-to" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="action">Action</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger id="action" data-testid="select-action"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTION_OPTIONS.map((a) => (
                  <SelectItem key={a} value={a}>{a === "ALL" ? "All actions" : a.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={() => refetch()} disabled={isFetching} className="flex-1" data-testid="button-apply">
              {isFetching ? "Loading…" : "Apply"}
            </Button>
            <Button variant="outline" onClick={handleExportCsv} data-testid="button-export-csv">
              <Download className="w-4 h-4 mr-1.5" /> CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <Skeleton className="h-72" />
      ) : data ? (
        (() => {
        const filteredEntries = action === "REVIEW_ALL"
          ? data.entries.filter((e) => isReviewAction(e.action))
          : data.entries;
        const filteredCounts = action === "REVIEW_ALL"
          ? data.counts.filter((c) => isReviewAction(c.action))
          : data.counts;
        const totalShown = action === "REVIEW_ALL" ? filteredEntries.length : data.total;
        const showReviewCol = action === "REVIEW_ALL" || isReviewAction(action);
        return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader><CardTitle className="text-base">Actions ({totalShown})</CardTitle></CardHeader>
            <CardContent>
              {filteredCounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matching entries.</p>
              ) : (
                <ul className="space-y-1.5">
                  {filteredCounts.map((c) => (
                    <li key={c.action} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{c.action.replace(/_/g, " ")}</span>
                      <span className="font-mono tabular-nums">{c.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Entries</CardTitle></CardHeader>
            <CardContent className="p-0">
              {filteredEntries.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No entries.</p>
              ) : (
                <div className="max-h-[28rem] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">When</th>
                        <th className="text-left px-3 py-2">Action</th>
                        <th className="text-left px-3 py-2">Trader</th>
                        {showReviewCol && (
                          <th className="text-left px-3 py-2">Review</th>
                        )}
                        <th className="text-left px-3 py-2">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredEntries.map((e) => {
                        const reviewId = reviewIdFromDetails(e.details);
                        return (
                          <tr key={e.id}>
                            <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                              {formatDateTime(e.createdAt)}
                            </td>
                            <td className="px-3 py-2 font-medium whitespace-nowrap">{e.action.replace(/_/g, " ")}</td>
                            <td className="px-3 py-2 text-xs">
                              {e.businessName ?? e.userEmail ?? `user #${e.userId}`}
                            </td>
                            {showReviewCol && (
                              <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                                {reviewId != null ? `#${reviewId}` : "—"}
                              </td>
                            )}
                            <td className="px-3 py-2 text-xs text-muted-foreground">{e.notes ?? ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        );
        })()
      ) : null}
    </div>
  );
}
