import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AdminSubscription } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { ArrowRight } from "lucide-react";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 border-transparent",
  trialing: "bg-blue-100 text-blue-800 border-transparent",
  past_due: "bg-amber-100 text-amber-900 border-transparent",
  canceled: "bg-zinc-200 text-zinc-700 border-transparent",
  inactive: "bg-muted text-muted-foreground border-transparent",
};

export default function Subscriptions() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "subscriptions"],
    queryFn: () => api<{ subscriptions: AdminSubscription[] }>("/api/admin/subscriptions"),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Subscriptions</h1>
        <p className="text-sm text-muted-foreground">Active and recently changed trader subscriptions.</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{data ? `${data.subscriptions.length} records` : "Loading…"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : data?.subscriptions.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No subscriptions yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Trader</th>
                    <th className="text-left px-4 py-2.5 font-medium">Plan</th>
                    <th className="text-left px-4 py-2.5 font-medium">Status</th>
                    <th className="text-left px-4 py-2.5 font-medium">Renews / ends</th>
                    <th className="text-right px-4 py-2.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data?.subscriptions.map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{s.businessName ?? s.email ?? `user #${s.userId}`}</div>
                        <div className="text-xs text-muted-foreground">{s.contactName ?? ""}</div>
                      </td>
                      <td className="px-4 py-3 uppercase font-mono text-xs">{s.plan}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={STATUS_STYLE[s.status] ?? "bg-muted"}>
                          {s.status}
                        </Badge>
                        {s.cancelAtPeriodEnd && (
                          <Badge variant="outline" className="ml-1 bg-amber-100 text-amber-900 border-transparent">
                            cancelling
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">{formatDate(s.currentPeriodEnd)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/traders/${s.userId}`}>
                          <Button size="sm" variant="ghost">Open <ArrowRight className="w-3.5 h-3.5 ml-1" /></Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
