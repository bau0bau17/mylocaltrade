import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/api";
import type { DashboardSummary, TraderStatus } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/StatusBadge";
import { relativeTime } from "@/lib/format";
import { Users, FileWarning, Mail, ClipboardList } from "lucide-react";

const HIGHLIGHT_STATUSES: TraderStatus[] = [
  "UNDER_REVIEW",
  "VERIFIED",
  "PENDING_DOCUMENTS",
  "EXPIRED_DOCUMENTS",
  "REJECTED",
  "SUSPENDED",
];

export default function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: () => api<DashboardSummary>("/api/admin/dashboard"),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{(error as Error)?.message ?? "Failed to load dashboard"}</AlertDescription>
      </Alert>
    );
  }

  const countMap = new Map(data.counts.map((c) => [c.status, c.count]));
  const underReview = countMap.get("UNDER_REVIEW") ?? 0;
  const verified = countMap.get("VERIFIED") ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Operational overview at a glance.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Users className="w-4 h-4" />}
          label="Total traders"
          value={data.totals.totalTraders}
          hint={`${verified} verified`}
        />
        <Link href="/traders?status=UNDER_REVIEW">
          <StatCard
            icon={<ClipboardList className="w-4 h-4" />}
            label="Awaiting review"
            value={underReview}
            hint="Click to review"
            highlight={underReview > 0}
          />
        </Link>
        <Link href="/expiring-documents">
          <StatCard
            icon={<FileWarning className="w-4 h-4" />}
            label="Documents expiring soon"
            value={data.expiringSoonCount}
            hint="Within 30 days"
            highlight={data.expiringSoonCount > 0}
          />
        </Link>
        <Link href="/enquiries">
          <StatCard
            icon={<Mail className="w-4 h-4" />}
            label="Enquiries (7 days)"
            value={data.enquiriesLast7d}
            hint={`${data.totals.totalCustomers} customers total`}
          />
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Trader status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {HIGHLIGHT_STATUSES.map((s) => {
              const c = countMap.get(s) ?? 0;
              return (
                <Link
                  key={s}
                  href={`/traders?status=${s}`}
                  className="flex items-center justify-between hover:bg-muted/50 px-2 py-1.5 rounded-md"
                >
                  <StatusBadge status={s} />
                  <span className="font-mono text-sm tabular-nums">{c}</span>
                </Link>
              );
            })}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent activity.</p>
            ) : (
              <ul className="divide-y">
                {data.recentActivity.map((entry) => (
                  <li key={entry.id} className="py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{entry.action.replace(/_/g, " ")}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {entry.businessName ?? entry.userEmail ?? `user #${entry.userId ?? "?"}`}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {relativeTime(entry.createdAt)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <Card className={`transition-shadow hover:shadow-md ${highlight ? "ring-2 ring-primary/40" : ""}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <div className="text-3xl font-semibold mt-2 tabular-nums">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}
