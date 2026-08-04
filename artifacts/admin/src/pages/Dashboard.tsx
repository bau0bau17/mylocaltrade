import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DashboardSummary, TraderListResponse } from "@/lib/types";
import { REVIEW_FILTER_STATUSES, STATUS_LABELS } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { relativeTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import {
  Users,
  FileWarning,
  Mail,
  ClipboardList,
  ShieldAlert,
  RefreshCw,
  ChevronRight,
  CircleCheck,
  CircleX,
  CircleSlash,
  UserPlus,
  FileCheck2,
  Activity,
} from "lucide-react";

// Mirror the Traders page filter list exactly so every status a reviewer can
// filter by also appears (and is counted) on the dashboard, in the same order.
const HIGHLIGHT_STATUSES = REVIEW_FILTER_STATUSES;

type Tone = "muted" | "info" | "warning" | "success" | "danger";

// Tone per trader status for the progress-bar breakdown (approved design).
const STATUS_TONES: Record<string, Tone> = {
  PROFILE_INCOMPLETE: "muted",
  PENDING_DOCUMENTS: "info",
  UNDER_REVIEW: "warning",
  NEEDS_MORE_INFO: "warning",
  VERIFIED: "success",
  REJECTED: "danger",
  SUSPENDED: "muted",
  EXPIRED_DOCUMENTS: "warning",
  PENDING_EMAIL_VERIFICATION: "muted",
  PENDING_PHONE_VERIFICATION: "muted",
};

const toneTextClass: Record<Tone, string> = {
  muted: "text-muted-foreground",
  info: "text-[hsl(var(--info))]",
  warning: "text-[hsl(var(--warning))]",
  success: "text-[hsl(var(--success))]",
  danger: "text-[hsl(var(--destructive))]",
};

const toneBarClass: Record<Tone, string> = {
  muted: "bg-muted-foreground/40",
  info: "bg-[hsl(var(--info))]",
  warning: "bg-[hsl(var(--warning))]",
  success: "bg-[hsl(var(--success))]",
  danger: "bg-[hsl(var(--destructive))]",
};

const toneChipClass: Record<Tone, string> = {
  muted: "bg-muted text-muted-foreground",
  info: "bg-[hsl(var(--info-tint))] text-[hsl(var(--info))]",
  warning: "bg-[hsl(var(--warning-tint))] text-[hsl(var(--warning))]",
  success: "bg-[hsl(var(--success-tint))] text-[hsl(var(--success))]",
  danger: "bg-[hsl(var(--destructive-tint))] text-[hsl(var(--destructive))]",
};

// Icon + tone for audit-log actions in the activity feed. Heuristic on the
// action string; anything unrecognised falls back to a neutral row.
function activityVisual(action: string): { icon: typeof CircleCheck; tone: Tone } {
  const a = action.toUpperCase();
  if (a.includes("VERIF") && !a.includes("UNVERIF")) return { icon: CircleCheck, tone: "success" };
  if (a.includes("APPROV") || a.includes("PASS")) return { icon: FileCheck2, tone: "success" };
  if (a.includes("REJECT") || a.includes("DELET") || a.includes("FAIL")) return { icon: CircleX, tone: "danger" };
  if (a.includes("SUSPEND") || a.includes("BAN")) return { icon: CircleSlash, tone: "muted" };
  if (a.includes("SUBMIT") || a.includes("CREATE") || a.includes("REGISTER") || a.includes("NEW"))
    return { icon: UserPlus, tone: "info" };
  return { icon: Activity, tone: "muted" };
}

const TABLE_STATUS_CHIP: Record<string, Tone> = {
  UNDER_REVIEW: "warning",
  NEEDS_MORE_INFO: "warning",
  VERIFIED: "success",
  REJECTED: "danger",
};

/** "Updated Xs ago" pill that re-renders every few seconds. */
function UpdatedPill({ updatedAt }: { updatedAt: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);
  if (!updatedAt) return null;
  const secs = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  const label = secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`;
  return (
    <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground bg-card border border-[hsl(var(--card-border))] rounded-full px-3 py-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--success))]" />
      Updated {label}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { data, isLoading, error, refetch, dataUpdatedAt, isRefetching } = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: () => api<DashboardSummary>("/api/admin/dashboard"),
    // Keep the counts live so the dashboard reflects status changes without a
    // manual refresh.
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  // Newest submissions awaiting a decision (approved design's preview table).
  const { data: reviewData } = useQuery({
    queryKey: ["admin", "dashboard", "awaiting-review"],
    queryFn: () =>
      api<TraderListResponse>("/api/admin/traders", {
        query: { status: "UNDER_REVIEW", limit: 5, offset: 0 },
      }),
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
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
  const breakdownTotal = HIGHLIGHT_STATUSES.reduce((n, s) => n + (countMap.get(s) ?? 0), 0);
  const reviewRows = reviewData?.traders ?? [];
  const reviewTotal = reviewData?.total ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3 admin-animate">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Operational overview at a glance.</p>
        </div>
        <div className="flex items-center gap-2">
          <UpdatedPill updatedAt={dataUpdatedAt} />
          <button
            type="button"
            onClick={() => void refetch()}
            className="w-9 h-9 rounded-lg border border-[hsl(var(--card-border))] bg-card flex items-center justify-center text-muted-foreground hover:text-primary hover:border-[hsl(var(--primary)/0.4)] transition-colors"
            aria-label="Refresh"
            data-testid="button-refresh-dashboard"
          >
            <RefreshCw className={`w-4 h-4 ${isRefetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <StatCard
          icon={Users}
          label="Total traders"
          value={data.totals.totalTraders}
          hint={`${verified} verified`}
          delayMs={0}
        />
        <Link href="/traders?status=UNDER_REVIEW">
          <StatCard
            icon={ClipboardList}
            label="Awaiting review"
            value={underReview}
            hint="Click to review"
            highlight={underReview > 0}
            delayMs={40}
          />
        </Link>
        <Link href="/conversation-reports?status=OPEN">
          <StatCard
            icon={ShieldAlert}
            label="Open reports"
            value={data.openConversationReports}
            hint="Conversation reports"
            highlight={data.openConversationReports > 0}
            delayMs={80}
          />
        </Link>
        <Link href="/expiring-documents">
          <StatCard
            icon={FileWarning}
            label="Docs expiring soon"
            value={data.expiringSoonCount}
            hint="Within 30 days"
            highlight={data.expiringSoonCount > 0}
            delayMs={120}
          />
        </Link>
        <Link href="/enquiries">
          <StatCard
            icon={Mail}
            label="Enquiries (7 days)"
            value={data.enquiriesLast7d}
            hint={`${data.totals.totalCustomers} customers total`}
            delayMs={160}
          />
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div
          className="bg-card border border-[hsl(var(--card-border))] rounded-xl admin-animate lg:col-span-1"
          style={{ animationDelay: "200ms" }}
        >
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <h2 className="text-[15px] font-bold">Trader status</h2>
            <span className="text-xs text-muted-foreground admin-mono">{breakdownTotal} total</span>
          </div>
          <div className="px-4 pb-4 space-y-3">
            {HIGHLIGHT_STATUSES.map((s) => {
              const c = countMap.get(s) ?? 0;
              const tone = STATUS_TONES[s] ?? "muted";
              const pct = breakdownTotal > 0 ? Math.round((c / breakdownTotal) * 100) : 0;
              return (
                <Link key={s} href={`/traders?status=${s}`} className="block group">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13px] font-medium group-hover:text-primary transition-colors">
                      {STATUS_LABELS[s] ?? s}
                    </span>
                    <span className={`text-[13px] font-semibold admin-mono ${toneTextClass[tone]}`}>{c}</span>
                  </div>
                  <div className="bg-muted h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${toneBarClass[tone]}`}
                      style={{ width: `${c > 0 ? Math.max(pct, 3) : 0}%` }}
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {user?.isSuperAdmin && (
          <div
            className="bg-card border border-[hsl(var(--card-border))] rounded-xl admin-animate lg:col-span-2"
            style={{ animationDelay: "240ms" }}
          >
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <h2 className="text-[15px] font-bold">Recent activity</h2>
              <Link
                href="/audit-report"
                className="text-xs font-semibold text-primary flex items-center gap-0.5 hover:gap-1.5 transition-all"
              >
                View all <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
            <div className="px-2 pb-2">
              {data.recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground px-2.5 pb-2.5">No recent activity.</p>
              ) : (
                data.recentActivity.map((entry) => {
                  const { icon: Icon, tone } = activityVisual(entry.action);
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 px-2.5 py-2.5 rounded-lg hover:bg-muted transition-colors"
                    >
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${toneChipClass[tone]}`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold truncate capitalize">
                          {entry.action.replace(/_/g, " ").toLowerCase()}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {entry.businessName ?? entry.userEmail ?? `user #${entry.userId ?? "?"}`}
                        </div>
                      </div>
                      <div className="text-[11px] text-muted-foreground whitespace-nowrap admin-mono">
                        {relativeTime(entry.createdAt)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      <div
        className="bg-card border border-[hsl(var(--card-border))] rounded-xl overflow-hidden admin-animate"
        style={{ animationDelay: "280ms" }}
      >
        <div className="px-4 pt-4 pb-3 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-[15px] font-bold">Awaiting review</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Newest submissions needing a decision.</p>
          </div>
        </div>
        {reviewRows.length === 0 ? (
          <p className="text-sm text-muted-foreground px-4 pb-4">Nothing awaiting review right now.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-t border-[hsl(var(--card-border))] text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left px-4 py-2.5 font-bold">Business</th>
                    <th className="text-left px-4 py-2.5 font-bold hidden sm:table-cell">Contact</th>
                    <th className="text-left px-4 py-2.5 font-bold">Status</th>
                    <th className="text-left px-4 py-2.5 font-bold hidden md:table-cell">Submitted</th>
                    <th className="text-right px-4 py-2.5 font-bold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[hsl(var(--card-border))]">
                  {reviewRows.map((t) => {
                    const chipTone = TABLE_STATUS_CHIP[t.verificationStatus] ?? "muted";
                    return (
                      <tr
                        key={t.userId}
                        className="hover:bg-muted/60 transition-colors cursor-pointer"
                        onClick={() => navigate(`/traders/${t.userId}`)}
                      >
                        <td className="px-4 py-3">
                          <div className="min-w-0">
                            <div className="font-semibold truncate">
                              {t.businessName ?? t.contactName ?? t.email}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {t.mainCategory ?? "—"}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground hidden sm:table-cell">
                          {t.email}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${toneChipClass[chipTone]}`}
                          >
                            {STATUS_LABELS[t.verificationStatus] ?? t.verificationStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell admin-mono">
                          {t.submittedForReviewAt ? relativeTime(t.submittedForReviewAt) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/traders/${t.userId}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-primary px-2.5 py-1.5 rounded-md hover:bg-[hsl(var(--primary-tint))] transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Open <ChevronRight className="w-3.5 h-3.5" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-[hsl(var(--card-border))] flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {reviewRows.length} of {reviewTotal} traders
              </p>
              <Link
                href="/traders?status=UNDER_REVIEW"
                className="text-xs font-semibold border border-[hsl(var(--card-border))] rounded-md px-3 py-1.5 hover:bg-muted transition-colors"
              >
                View all
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  highlight,
  delayMs,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  hint?: string;
  highlight?: boolean;
  delayMs: number;
}) {
  return (
    <div
      className={`bg-card border border-[hsl(var(--card-border))] admin-card-hover admin-animate rounded-xl p-4 cursor-pointer ${
        highlight ? "ring-1 ring-[hsl(var(--primary)/0.35)]" : ""
      }`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center ${
          highlight
            ? "bg-[hsl(var(--primary-tint))] text-primary"
            : "bg-muted text-muted-foreground"
        }`}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="mt-3 text-[28px] font-extrabold leading-none admin-mono tracking-tight">
        {value.toLocaleString()}
      </div>
      <div className="mt-1.5 text-[13px] font-semibold text-foreground">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
