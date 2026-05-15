import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AdminEnquiry } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { Search } from "lucide-react";

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  house: "House",
  flat: "Flat",
  commercial: "Commercial",
  other: "Other",
};
const TENURE_LABELS: Record<string, string> = {
  owner: "Owner",
  tenant: "Tenant",
  landlord: "Landlord",
  leaseholder: "Leaseholder",
};
const URGENCY_LABELS: Record<string, string> = {
  routine: "No rush",
  soon: "Within a month",
  urgent: "ASAP",
};

function specialistChips(fields: AdminEnquiry["specialistFields"]): { key: string; label: string }[] {
  if (!fields) return [];
  const out: { key: string; label: string }[] = [];
  if (fields.propertyType) out.push({ key: "propertyType", label: PROPERTY_TYPE_LABELS[fields.propertyType] ?? fields.propertyType });
  if (fields.tenure) out.push({ key: "tenure", label: TENURE_LABELS[fields.tenure] ?? fields.tenure });
  if (fields.urgency) out.push({ key: "urgency", label: URGENCY_LABELS[fields.urgency] ?? fields.urgency });
  return out;
}

export default function EnquiriesPage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(id);
  }, [q]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "enquiries", debouncedQ],
    queryFn: () =>
      api<{ enquiries: AdminEnquiry[] }>("/api/admin/enquiries", {
        query: { q: debouncedQ || undefined, limit: 200 },
      }),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Customer enquiries</h1>
        <p className="text-sm text-muted-foreground">All quote requests sent through the platform.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search trader, customer or service…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
              data-testid="input-search-enquiries"
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{data ? `${data.enquiries.length} enquiries` : "Loading…"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : data?.enquiries.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No enquiries.</div>
          ) : (
            <ul className="divide-y">
              {data?.enquiries.map((e) => (
                <li key={e.id} className="p-4 hover:bg-muted/30">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{e.serviceRequired}</span>
                        <Badge variant="outline">{e.status}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        From <strong>{e.customerName ?? e.customerEmail ?? `customer #${e.customerId}`}</strong>
                        {" · "}to{" "}
                        {e.traderUserId ? (
                          <Link href={`/traders/${e.traderUserId}`} className="underline hover:text-foreground">
                            {e.traderBusinessName ?? `trader #${e.traderId}`}
                          </Link>
                        ) : (
                          <span>{e.traderBusinessName ?? `trader #${e.traderId}`}</span>
                        )}
                      </div>
                      <p className="text-sm mt-2 whitespace-pre-line">{e.message}</p>
                      {(() => {
                        const chips = specialistChips(e.specialistFields);
                        if (chips.length === 0) return null;
                        return (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {chips.map((c) => (
                              <Badge key={c.key} variant="secondary" className="text-[10px]">
                                {c.label}
                              </Badge>
                            ))}
                          </div>
                        );
                      })()}
                      {(e.preferredDate || e.phone) && (
                        <div className="text-xs text-muted-foreground mt-1.5">
                          {e.preferredDate && <span>Preferred: {e.preferredDate} </span>}
                          {e.phone && <span>· Phone: {e.phone}</span>}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(e.createdAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
