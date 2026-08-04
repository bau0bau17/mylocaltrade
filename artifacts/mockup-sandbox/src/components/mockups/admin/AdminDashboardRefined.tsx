import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  FileWarning,
  ClipboardList,
  Mail,
  CreditCard,
  Star,
  LogOut,
  Shield,
  ShieldAlert,
  Flag,
  Tag,
  Trash2,
  Ban,
  UserCog,
  UsersRound,
  BellOff,
  ChevronRight,
  RefreshCw,
  ArrowUpRight,
  CircleCheck,
  CircleX,
  CircleSlash,
  FileCheck2,
  UserPlus,
  Search,
} from "lucide-react";
import "./admin-dashboard-refined.css";

// ---------------------------------------------------------------------------
// Mock data — this is a visual refinement of the existing Admin dashboard;
// there is no live API wired into this sandbox, so the numbers below are
// representative sample data only.
// ---------------------------------------------------------------------------

interface NavLeaf {
  label: string;
  icon: typeof LayoutDashboard;
  count?: number;
  superAdminOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavLeaf[];
}

const NAV_GROUPS: NavGroup[] = [
  { label: "Overview", items: [{ label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "Verification",
    items: [
      { label: "Traders", icon: Users, count: 23 },
      { label: "Expiring docs", icon: FileWarning, count: 12 },
      { label: "Profile changes", icon: UserCog, count: 3 },
    ],
  },
  {
    label: "Trust & safety",
    items: [
      { label: "Reviews", icon: Star, count: 5 },
      { label: "Conversation reports", icon: ShieldAlert, count: 4 },
      { label: "User reports", icon: Flag, count: 2 },
      { label: "Cancellations", icon: Ban, count: 1 },
      { label: "Account deletions", icon: Trash2, count: 6 },
    ],
  },
  {
    label: "Billing",
    items: [
      { label: "Subscriptions", icon: CreditCard },
      { label: "Promo codes", icon: Tag },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Notification health", icon: BellOff },
      { label: "Audit report", icon: ClipboardList, superAdminOnly: true },
      { label: "Admin team", icon: UsersRound, superAdminOnly: true },
    ],
  },
];

const STATUS_BREAKDOWN: { label: string; count: number; tone: "muted" | "info" | "warning" | "success" | "danger" }[] = [
  { label: "Profile incomplete", count: 41, tone: "muted" },
  { label: "Pending documents", count: 28, tone: "info" },
  { label: "Under review", count: 23, tone: "warning" },
  { label: "Needs more info", count: 9, tone: "warning" },
  { label: "Verified", count: 1047, tone: "success" },
  { label: "Rejected", count: 14, tone: "danger" },
];

const ACTIVITY = [
  { id: 1, action: "Trader verified", who: "Kowalski Roofing & Gutters", time: "6m ago", icon: CircleCheck, tone: "success" as const },
  { id: 2, action: "Document rejected", who: "Bright Spark Electrical", time: "24m ago", icon: CircleX, tone: "danger" as const },
  { id: 3, action: "New trader submitted", who: "Fenwick & Doyle Joinery", time: "51m ago", icon: UserPlus, tone: "info" as const },
  { id: 4, action: "Register check passed", who: "Terra Firma Landscaping", time: "1h ago", icon: FileCheck2, tone: "success" as const },
  { id: 5, action: "Account suspended", who: "QuickFix Plumbing Ltd", time: "2h ago", icon: CircleSlash, tone: "muted" as const },
  { id: 6, action: "Trader verified", who: "Marlowe Damp Proofing", time: "3h ago", icon: CircleCheck, tone: "success" as const },
];

const TRADERS_PREVIEW = [
  { name: "Hensley Boiler Care", category: "Heating & gas", contact: "d.hensley@hensleyboiler.co.uk", status: "UNDER_REVIEW", risk: "medium" as const, submitted: "2h ago" },
  { name: "Ainsworth Stonemasons", category: "Masonry", contact: "info@ainsworthstone.uk", status: "UNDER_REVIEW", risk: null, submitted: "5h ago" },
  { name: "Voss Electrical Services", category: "Electrical", contact: "office@vosselectrical.com", status: "NEEDS_MORE_INFO", risk: "high", submitted: "1d ago" },
  { name: "Carrow Tree Surgery", category: "Landscaping", contact: "carrow.trees@gmail.com", status: "UNDER_REVIEW", risk: null, submitted: "1d ago" },
];

const STATUS_STYLES: Record<string, string> = {
  UNDER_REVIEW: "bg-[hsl(var(--adr-warning-tint))] text-[hsl(var(--adr-warning))]",
  NEEDS_MORE_INFO: "bg-[hsl(var(--adr-warning-tint))] text-[hsl(var(--adr-warning))]",
  VERIFIED: "bg-[hsl(var(--adr-success-tint))] text-[hsl(var(--adr-success))]",
  REJECTED: "bg-[hsl(var(--adr-danger-tint))] text-[hsl(var(--adr-danger))]",
};

const STATUS_LABELS: Record<string, string> = {
  UNDER_REVIEW: "Under review",
  NEEDS_MORE_INFO: "Needs more info",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
};

const toneText: Record<string, string> = {
  muted: "text-[hsl(var(--adr-muted))]",
  info: "text-[hsl(var(--adr-info))]",
  warning: "text-[hsl(var(--adr-warning))]",
  success: "text-[hsl(var(--adr-success))]",
  danger: "text-[hsl(var(--adr-danger))]",
};

const toneBg: Record<string, string> = {
  muted: "bg-[hsl(var(--adr-muted-bg))]",
  info: "bg-[hsl(var(--adr-info))]",
  warning: "bg-[hsl(var(--adr-warning))]",
  success: "bg-[hsl(var(--adr-success))]",
  danger: "bg-[hsl(var(--adr-danger))]",
};

const activityToneBg: Record<string, string> = {
  success: "bg-[hsl(var(--adr-success-tint))] text-[hsl(var(--adr-success))]",
  danger: "bg-[hsl(var(--adr-danger-tint))] text-[hsl(var(--adr-danger))]",
  info: "bg-[hsl(var(--adr-info-tint))] text-[hsl(var(--adr-info))]",
  muted: "bg-[hsl(var(--adr-muted-bg))] text-[hsl(var(--adr-muted))]",
};

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  delta,
  highlight,
  delayMs,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  hint: string;
  delta?: string;
  highlight?: boolean;
  delayMs: number;
}) {
  return (
    <div
      className={`adr-card adr-card-hover adr-animate rounded-xl p-4 cursor-pointer ${
        highlight ? "ring-1 ring-[hsl(var(--adr-primary)/0.35)]" : ""
      }`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="flex items-start justify-between">
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center ${
            highlight
              ? "bg-[hsl(var(--adr-primary-tint))] text-[hsl(var(--adr-primary))]"
              : "bg-[hsl(var(--adr-muted-bg))] text-[hsl(var(--adr-muted))]"
          }`}
        >
          <Icon className="w-4 h-4" />
        </div>
        {delta && (
          <span className="flex items-center gap-0.5 text-[11px] font-semibold text-[hsl(var(--adr-success))] adr-mono">
            <ArrowUpRight className="w-3 h-3" />
            {delta}
          </span>
        )}
      </div>
      <div className="mt-3 text-[28px] font-extrabold leading-none adr-mono tracking-tight">{value}</div>
      <div className="mt-1.5 text-[13px] font-semibold text-[hsl(var(--adr-foreground))]">{label}</div>
      <div className="mt-0.5 text-xs text-[hsl(var(--adr-muted))]">{hint}</div>
    </div>
  );
}

export default function AdminDashboardRefined() {
  const [activeItem, setActiveItem] = useState("Dashboard");
  const isSuperAdmin = true;
  const totalTraders = STATUS_BREAKDOWN.reduce((n, s) => n + s.count, 0);

  return (
    <div className="adr-root min-h-[100dvh] w-full flex">
      {/* Sidebar */}
      <aside className="adr-sidebar hidden md:flex md:flex-col w-64 shrink-0 text-[hsl(var(--adr-sidebar-fg))]">
        <div className="px-5 py-5 flex items-center gap-2.5 border-b border-[hsl(var(--adr-sidebar-border))]">
          <div className="bg-[hsl(var(--adr-primary))] text-white rounded-lg w-8 h-8 flex items-center justify-center shrink-0">
            <Shield className="w-4 h-4" />
          </div>
          <div className="leading-tight min-w-0">
            <div className="font-bold text-sm text-white truncate">MyLocalTrade</div>
            <div className="text-[11px] opacity-60">Admin console</div>
          </div>
        </div>

        <nav className="adr-scrollbar flex-1 px-3 py-4 space-y-5 overflow-y-auto">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((it) => !it.superAdminOnly || isSuperAdmin);
            if (items.length === 0) return null;
            return (
              <div key={group.label}>
                <div className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-wider opacity-40">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const active = activeItem === item.label;
                    return (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => setActiveItem(item.label)}
                        className={`adr-nav-item w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium ${
                          active ? "active" : ""
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="flex-1 text-left truncate">{item.label}</span>
                        {!!item.count && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[hsl(var(--adr-primary))] text-white adr-mono">
                            {item.count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-[hsl(var(--adr-sidebar-border))]">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-[hsl(0_0%_100%/0.1)] flex items-center justify-center text-xs font-bold text-white shrink-0">
              RH
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-white truncate">Rosa Hartmann</div>
              <div className="text-[11px] opacity-50 truncate">rosa@mylocaltrade.co.uk</div>
            </div>
            <button
              type="button"
              className="w-7 h-7 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-[hsl(0_0%_100%/0.08)] transition-colors"
              aria-label="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-[hsl(var(--adr-card-border))]">
          <div className="flex items-center gap-2 font-bold text-sm">
            <Shield className="w-4 h-4 text-[hsl(var(--adr-primary))]" /> MyLocalTrade Admin
          </div>
          <button type="button" className="w-8 h-8 rounded-md flex items-center justify-center text-[hsl(var(--adr-muted))]">
            <LogOut className="w-4 h-4" />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-5 md:p-8 space-y-6">
          {/* Page header */}
          <div className="flex items-start justify-between flex-wrap gap-3 adr-animate">
            <div>
              <h1 className="text-[26px] font-extrabold tracking-tight">Dashboard</h1>
              <p className="text-sm text-[hsl(var(--adr-muted))] mt-0.5">
                Operational overview at a glance.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-[hsl(var(--adr-muted))] bg-white border border-[hsl(var(--adr-card-border))] rounded-full px-3 py-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--adr-success))]" />
                Updated 12s ago
              </div>
              <button
                type="button"
                className="w-9 h-9 rounded-lg border border-[hsl(var(--adr-card-border))] bg-white flex items-center justify-center text-[hsl(var(--adr-muted))] hover:text-[hsl(var(--adr-primary))] hover:border-[hsl(var(--adr-primary)/0.4)] transition-colors"
                aria-label="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            <StatCard
              icon={Users}
              label="Total traders"
              value="1,284"
              hint="1,047 verified"
              delta="+3.1%"
              delayMs={0}
            />
            <StatCard
              icon={ClipboardList}
              label="Awaiting review"
              value="23"
              hint="Click to review"
              highlight
              delayMs={40}
            />
            <StatCard
              icon={ShieldAlert}
              label="Open reports"
              value="4"
              hint="Conversation reports"
              highlight
              delayMs={80}
            />
            <StatCard
              icon={FileWarning}
              label="Docs expiring soon"
              value="12"
              hint="Within 30 days"
              highlight
              delayMs={120}
            />
            <StatCard
              icon={Mail}
              label="Enquiries (7 days)"
              value="86"
              hint="612 customers total"
              delta="+11%"
              delayMs={160}
            />
          </div>

          {/* Status + Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="adr-card adr-animate rounded-xl lg:col-span-1" style={{ animationDelay: "200ms" }}>
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <h2 className="text-[15px] font-bold">Trader status</h2>
                <span className="text-xs text-[hsl(var(--adr-muted))] adr-mono">{totalTraders} total</span>
              </div>
              <div className="px-4 pb-4 space-y-3">
                {STATUS_BREAKDOWN.map((s) => {
                  const pct = Math.round((s.count / totalTraders) * 100);
                  return (
                    <button
                      key={s.label}
                      type="button"
                      className="w-full text-left group"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[13px] font-medium group-hover:text-[hsl(var(--adr-primary))] transition-colors">
                          {s.label}
                        </span>
                        <span className="text-[13px] font-semibold adr-mono">{s.count}</span>
                      </div>
                      <div className="adr-progress-track h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${toneBg[s.tone]}`}
                          style={{ width: `${Math.max(pct, 3)}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="adr-card adr-animate rounded-xl lg:col-span-2" style={{ animationDelay: "240ms" }}>
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <h2 className="text-[15px] font-bold">Recent activity</h2>
                <button type="button" className="text-xs font-semibold text-[hsl(var(--adr-primary))] flex items-center gap-0.5 hover:gap-1.5 transition-all">
                  View all <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="px-2 pb-2">
                {ACTIVITY.map((entry) => {
                  const Icon = entry.icon;
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 px-2.5 py-2.5 rounded-lg hover:bg-[hsl(var(--adr-muted-bg))] transition-colors"
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${activityToneBg[entry.tone]}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold truncate">{entry.action}</div>
                        <div className="text-xs text-[hsl(var(--adr-muted))] truncate">{entry.who}</div>
                      </div>
                      <div className="text-[11px] text-[hsl(var(--adr-muted))] whitespace-nowrap adr-mono">
                        {entry.time}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Traders preview table */}
          <div className="adr-card adr-animate rounded-xl overflow-hidden" style={{ animationDelay: "280ms" }}>
            <div className="px-4 pt-4 pb-3 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-[15px] font-bold">Awaiting review</h2>
                <p className="text-xs text-[hsl(var(--adr-muted))] mt-0.5">Newest submissions needing a decision.</p>
              </div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--adr-muted))]" />
                <input
                  placeholder="Search traders…"
                  className="text-xs pl-8 pr-3 py-1.5 rounded-lg border border-[hsl(var(--adr-card-border))] bg-[hsl(var(--adr-muted-bg))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--adr-primary)/0.3)] w-44"
                  readOnly
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-t border-[hsl(var(--adr-card-border))] text-[10px] uppercase tracking-wider text-[hsl(var(--adr-muted))]">
                    <th className="text-left px-4 py-2.5 font-bold">Business</th>
                    <th className="text-left px-4 py-2.5 font-bold hidden sm:table-cell">Contact</th>
                    <th className="text-left px-4 py-2.5 font-bold">Status</th>
                    <th className="text-left px-4 py-2.5 font-bold hidden md:table-cell">Submitted</th>
                    <th className="text-right px-4 py-2.5 font-bold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[hsl(var(--adr-card-border))]">
                  {TRADERS_PREVIEW.map((t) => (
                    <tr key={t.name} className="hover:bg-[hsl(var(--adr-muted-bg))] transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {t.risk && (
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                t.risk === "high" ? "bg-[hsl(var(--adr-danger))]" : "bg-[hsl(var(--adr-warning))]"
                              }`}
                            />
                          )}
                          <div className="min-w-0">
                            <div className="font-semibold truncate">{t.name}</div>
                            <div className="text-xs text-[hsl(var(--adr-muted))] truncate">{t.category}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[hsl(var(--adr-muted))] hidden sm:table-cell">{t.contact}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLES[t.status]}`}>
                          {STATUS_LABELS[t.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[hsl(var(--adr-muted))] hidden md:table-cell adr-mono">{t.submitted}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[hsl(var(--adr-primary))] px-2.5 py-1.5 rounded-md hover:bg-[hsl(var(--adr-primary-tint))] transition-colors"
                        >
                          Open <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-[hsl(var(--adr-card-border))] flex items-center justify-between">
              <p className="text-xs text-[hsl(var(--adr-muted))]">Showing 4 of 23 traders</p>
              <button
                type="button"
                className="text-xs font-semibold border border-[hsl(var(--adr-card-border))] rounded-md px-3 py-1.5 hover:bg-[hsl(var(--adr-muted-bg))] transition-colors"
              >
                Load more
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
