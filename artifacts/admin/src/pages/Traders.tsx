import { useMemo, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { TraderListResponse, TraderStatus } from "@/lib/types";
import { REVIEW_FILTER_STATUSES, STATUS_LABELS } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/StatusBadge";
import { AiVerdictBadge, RegisterOverallBadge } from "@/components/CheckBadges";
import { formatDate } from "@/lib/format";
import { Search, ArrowRight } from "lucide-react";

function rowRisk(t: TraderListResponse["traders"][number]): "high" | "medium" | null {
  if (
    t.verificationStatus === "REJECTED" ||
    t.registerCheckStatus === "FAIL" ||
    t.aiVerificationStatus === "NO_MATCH"
  ) {
    return "high";
  }
  if (
    t.verificationStatus === "NEEDS_MORE_INFO" ||
    t.verificationStatus === "EXPIRED_DOCUMENTS" ||
    t.registerCheckStatus === "REVIEW" ||
    t.aiVerificationStatus === "PARTIAL_MATCH" ||
    t.aiVerificationStatus === "NOT_FOUND"
  ) {
    return "medium";
  }
  return null;
}

function useQueryParams() {
  const [location] = useLocation();
  return useMemo(() => {
    const idx = location.indexOf("?");
    if (idx < 0) return new URLSearchParams();
    return new URLSearchParams(location.slice(idx + 1));
  }, [location]);
}

export default function Traders() {
  const params = useQueryParams();
  const [, navigate] = useLocation();
  const initialStatus = (params.get("status") as TraderStatus | null) ?? "UNDER_REVIEW";
  const [status, setStatus] = useState<TraderStatus | "ALL">(initialStatus ?? "UNDER_REVIEW");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debouncedQ, setDebouncedQ] = useState(q);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    const sp = new URLSearchParams();
    if (status && status !== "ALL") sp.set("status", status);
    if (debouncedQ) sp.set("q", debouncedQ);
    const qs = sp.toString();
    navigate(`/traders${qs ? `?${qs}` : ""}`, { replace: true });
  }, [status, debouncedQ, navigate]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "traders", status, debouncedQ],
    queryFn: () =>
      api<TraderListResponse>("/api/admin/traders", {
        query: {
          status: status === "ALL" ? undefined : status,
          q: debouncedQ || undefined,
          limit: 200,
        },
      }),
  });

  const counts = data?.counts ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Traders</h1>
          <p className="text-sm text-muted-foreground">Review trader applications and manage accounts.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, business…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
              data-testid="input-search-traders"
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as TraderStatus | "ALL")}>
            <SelectTrigger className="w-full sm:w-64" data-testid="select-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {REVIEW_FILTER_STATUSES.map((s) => {
                const c = counts.find((x) => x.status === s)?.count ?? 0;
                return (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]} ({c})
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : data?.traders.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">
              No traders match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Business</th>
                    <th className="text-left px-4 py-2.5 font-medium">Contact</th>
                    <th className="text-left px-4 py-2.5 font-medium">Location</th>
                    <th className="text-left px-4 py-2.5 font-medium">Status</th>
                    <th className="text-left px-4 py-2.5 font-medium">Checks</th>
                    <th className="text-left px-4 py-2.5 font-medium">Submitted</th>
                    <th className="text-right px-4 py-2.5 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data?.traders.map((t) => {
                    const risk = rowRisk(t);
                    const accent =
                      risk === "high"
                        ? "border-l-4 border-l-red-500"
                        : risk === "medium"
                          ? "border-l-4 border-l-amber-400"
                          : "border-l-4 border-l-transparent";
                    return (
                    <tr key={t.userId} className="hover:bg-muted/30" data-testid={`row-trader-${t.userId}`}>
                      <td className={`px-4 py-3 ${accent}`}>
                        <div className="font-medium">{t.businessName ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{t.mainCategory ?? "Category not set"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{t.contactName ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{t.email}</div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {t.town ? `${t.town}${t.postcode ? `, ${t.postcode}` : ""}` : "—"}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={t.verificationStatus} /></td>
                      <td className="px-4 py-3" data-testid={`checks-trader-${t.userId}`}>
                        {t.registerCheckStatus || t.aiVerificationStatus ? (
                          <div className="flex flex-col gap-1 items-start">
                            {t.registerCheckStatus ? (
                              <RegisterOverallBadge overall={t.registerCheckStatus} compact />
                            ) : null}
                            {t.aiVerificationStatus ? (
                              <AiVerdictBadge verdict={t.aiVerificationStatus} compact />
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not run</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatDate(t.submittedForReviewAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/traders/${t.userId}`}>
                          <Button size="sm" variant="ghost" data-testid={`button-open-${t.userId}`}>
                            Open <ArrowRight className="w-3.5 h-3.5 ml-1" />
                          </Button>
                        </Link>
                      </td>
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
}
