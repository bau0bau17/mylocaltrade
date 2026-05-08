import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ExpiringDocumentsResponse } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { formatDate, daysUntil } from "@/lib/format";
import { ArrowRight } from "lucide-react";

const DOC_LABELS: Record<string, string> = {
  ID_DOCUMENT: "Photo ID",
  INSURANCE: "Insurance",
  PROOF_OF_ADDRESS: "Proof of address",
  QUALIFICATION: "Qualification",
  OTHER: "Other",
};

export default function ExpiringDocs() {
  const [withinDays, setWithinDays] = useState<string>("30");
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "expiring-documents", withinDays],
    queryFn: () =>
      api<ExpiringDocumentsResponse>("/api/admin/expiring-documents", {
        query: { withinDays },
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-end flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Expiring documents</h1>
          <p className="text-sm text-muted-foreground">Track upcoming and overdue document expirations.</p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="within" className="text-xs text-muted-foreground">Within</Label>
          <Select value={withinDays} onValueChange={setWithinDays}>
            <SelectTrigger id="within" className="w-32" data-testid="select-within"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="14">14 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="60">60 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{data ? `${data.documents.length} document(s)` : "Loading…"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : data?.documents.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No documents expiring soon.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Trader</th>
                    <th className="text-left px-4 py-2.5 font-medium">Document</th>
                    <th className="text-left px-4 py-2.5 font-medium">Expires</th>
                    <th className="text-left px-4 py-2.5 font-medium">Status</th>
                    <th className="text-right px-4 py-2.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data?.documents.map((d) => {
                    const days = daysUntil(d.expiresAt);
                    const expired = days != null && days < 0;
                    return (
                      <tr key={d.documentId}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{d.businessName ?? d.userEmail ?? `user #${d.userId}`}</div>
                          <div className="text-xs text-muted-foreground">{d.contactName ?? ""}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div>{DOC_LABELS[d.type] ?? d.type}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-xs">{d.originalFilename}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div>{formatDate(d.expiresAt)}</div>
                          {days != null && (
                            <div className={`text-xs ${expired ? "text-red-700" : "text-muted-foreground"}`}>
                              {expired ? `${Math.abs(days)}d ago` : `in ${days}d`}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {expired ? (
                            <Badge variant="outline" className="bg-red-100 text-red-800 border-transparent">Expired</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-amber-100 text-amber-900 border-transparent">Expiring</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/traders/${d.userId}`}>
                            <Button size="sm" variant="ghost">
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
