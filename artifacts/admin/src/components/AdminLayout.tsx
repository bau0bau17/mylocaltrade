import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Contact,
  Users,
  FileWarning,
  ClipboardList,
  Mail,
  Armchair,
  CreditCard,
  Star,
  LogOut,
  Shield,
  ShieldAlert,
  Flag,
  Tag,
  Trash2,
  UserCog,
  UsersRound,
  BellOff,
  Rocket,
  Sun,
  Moon,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Key into the attention-counts response; sections without one never show a badge. */
  countKey?: keyof AttentionCounts;
  /** Only shown to super admins. */
  superAdminOnly?: boolean;
}

interface AttentionCounts {
  traders: number;
  expiringDocuments: number;
  reviews: number;
  conversationReports: number;
  userReports: number;
  accountDeletions: number;
  profileChangeRequests: number;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// Grouped navigation per the approved design: Overview / Verification /
// Trust & safety / Billing / System. Every route from the previous flat nav
// is preserved — only the visual grouping is new.
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/early-access", label: "Early Access", icon: Rocket },
      { href: "/outreach-contacts", label: "Outreach contacts", icon: Contact },
      { href: "/enquiries", label: "Enquiries", icon: Mail },
    ],
  },
  {
    label: "Verification",
    items: [
      { href: "/traders", label: "Traders", icon: Users, countKey: "traders" },
      { href: "/expiring-documents", label: "Expiring docs", icon: FileWarning, countKey: "expiringDocuments" },
      { href: "/profile-change-requests", label: "Profile changes", icon: UserCog, countKey: "profileChangeRequests" },
    ],
  },
  {
    label: "Trust & safety",
    items: [
      { href: "/reviews", label: "Reviews", icon: Star, countKey: "reviews" },
      { href: "/conversation-reports", label: "Conversation reports", icon: ShieldAlert, countKey: "conversationReports" },
      { href: "/user-reports", label: "User reports", icon: Flag, countKey: "userReports" },
      { href: "/account-deletions", label: "Account deletions", icon: Trash2, countKey: "accountDeletions" },
    ],
  },
  {
    label: "Billing",
    items: [
      { href: "/subscriptions", label: "Subscriptions", icon: CreditCard },
      { href: "/seat-exemptions", label: "Seat exemptions", icon: Armchair },
      { href: "/promo-codes", label: "Promo codes", icon: Tag },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/notification-health", label: "Notification health", icon: BellOff },
      { href: "/audit-report", label: "Audit report", icon: ClipboardList, superAdminOnly: true },
      { href: "/team", label: "Admin team", icon: UsersRound, superAdminOnly: true },
    ],
  },
];

const FLAT_NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

function isActive(itemHref: string, location: string): boolean {
  if (itemHref === "/") return location === "/" || location === "";
  return location === itemHref || location.startsWith(`${itemHref}/`);
}

function initialsOf(name: string | undefined | null, email: string | undefined | null): string {
  const source = (name || "").trim();
  if (source) {
    const parts = source.split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || source[0].toUpperCase();
  }
  return (email?.[0] ?? "?").toUpperCase();
}

function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === "light";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`admin-theme-toggle relative rounded-lg flex items-center justify-center active:scale-90 transition-all overflow-hidden ${className}`}
      aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
      title={isLight ? "Switch to dark theme" : "Switch to light theme"}
      data-testid="button-theme-toggle"
    >
      <Sun
        className={`w-4 h-4 absolute transition-all duration-300 ${
          isLight ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-50"
        }`}
      />
      <Moon
        className={`w-4 h-4 absolute transition-all duration-300 ${
          isLight ? "opacity-0 rotate-90 scale-50" : "opacity-100 rotate-0 scale-100"
        }`}
      />
    </button>
  );
}

export function AdminLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  const { data: counts } = useQuery({
    queryKey: ["admin", "attention-counts"],
    queryFn: () => api<AttentionCounts>("/api/admin/attention-counts"),
    refetchInterval: 30_000,
    enabled: !!user,
  });

  const badgeFor = (item: NavItem): number =>
    item.countKey && counts ? counts[item.countKey] ?? 0 : 0;

  const visibleFlatNav = FLAT_NAV.filter((item) => !item.superAdminOnly || user?.isSuperAdmin);

  return (
    <div className="flex min-h-screen w-full bg-background relative">
      <div className="admin-noise fixed inset-0 pointer-events-none z-0" />
      <aside className="admin-sidebar hidden md:flex md:flex-col w-64 shrink-0 text-sidebar-foreground relative z-10">
        <div className="px-5 py-5 flex items-center gap-2.5 border-b border-sidebar-border">
          <div className="bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))] rounded-lg w-8 h-8 flex items-center justify-center shrink-0">
            <Shield className="w-4 h-4" />
          </div>
          <div className="leading-tight min-w-0">
            <div className="font-bold text-sm text-white truncate">MyLocalTrade</div>
            <div className="text-[11px] opacity-60">Admin console</div>
          </div>
        </div>

        <div className="px-3 pt-3 pb-1">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg bg-[hsl(0_0%_100%/0.04)]">
            <div className="w-8 h-8 rounded-full bg-[hsl(0_0%_100%/0.08)] flex items-center justify-center text-xs font-bold text-white shrink-0">
              {initialsOf(user?.fullName, user?.email)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-white truncate">
                {user?.fullName || user?.email}
              </div>
              {user?.fullName && (
                <div className="text-[11px] opacity-50 truncate" title={user?.email}>
                  {user?.email}
                </div>
              )}
            </div>
            <ThemeToggle className="w-7 h-7 text-sidebar-foreground/60 hover:text-white hover:bg-[hsl(0_0%_100%/0.08)]" />
            <button
              type="button"
              className="w-7 h-7 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-[hsl(0_0%_100%/0.08)] transition-colors"
              onClick={logout}
              aria-label="Sign out"
              title="Sign out"
              data-testid="button-logout"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <nav className="admin-scrollbar flex-1 px-3 py-4 space-y-5 overflow-y-auto">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((it) => !it.superAdminOnly || user?.isSuperAdmin);
            if (items.length === 0) return null;
            return (
              <div key={group.label}>
                <div className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-wider opacity-40">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.href, location);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`admin-nav-item flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium ${
                          active ? "active" : ""
                        }`}
                        data-testid={`nav-${item.href.replace(/\//g, "") || "dashboard"}`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="flex-1 truncate">{item.label}</span>
                        {badgeFor(item) > 0 && (
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))] admin-mono"
                            data-testid={`badge-attention${item.href.replace(/\//g, "-")}`}
                          >
                            {badgeFor(item) > 99 ? "99+" : badgeFor(item)}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

      </aside>

      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-card border-b border-[hsl(var(--card-border))]">
          <div className="flex items-center gap-2 font-bold text-sm">
            <Shield className="w-4 h-4 text-primary" /> MyLocalTrade Admin
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle className="w-8 h-8 text-muted-foreground hover:text-primary" />
            <Button variant="ghost" size="sm" onClick={logout} data-testid="button-logout-mobile">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </header>
        <nav className="md:hidden flex overflow-x-auto gap-1 px-2 py-2 bg-card border-b border-[hsl(var(--card-border))]">
          {visibleFlatNav.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href, location);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs whitespace-nowrap ${
                  active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
                {badgeFor(item) > 0 && (
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      active ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {badgeFor(item) > 99 ? "99+" : badgeFor(item)}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
