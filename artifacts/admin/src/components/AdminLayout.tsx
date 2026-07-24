import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
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
  cancellationRequests: number;
  accountDeletions: number;
  profileChangeRequests: number;
}

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/traders", label: "Traders", icon: Users, countKey: "traders" },
  { href: "/expiring-documents", label: "Expiring docs", icon: FileWarning, countKey: "expiringDocuments" },
  { href: "/audit-report", label: "Audit report", icon: ClipboardList, superAdminOnly: true },
  { href: "/enquiries", label: "Enquiries", icon: Mail },
  { href: "/reviews", label: "Reviews", icon: Star, countKey: "reviews" },
  { href: "/conversation-reports", label: "Conversation reports", icon: ShieldAlert, countKey: "conversationReports" },
  { href: "/user-reports", label: "User reports", icon: Flag, countKey: "userReports" },
  { href: "/cancellation-requests", label: "Cancellations", icon: Ban, countKey: "cancellationRequests" },
  { href: "/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/promo-codes", label: "Promo codes", icon: Tag },
  { href: "/account-deletions", label: "Account deletions", icon: Trash2, countKey: "accountDeletions" },
  { href: "/profile-change-requests", label: "Profile changes", icon: UserCog, countKey: "profileChangeRequests" },
  { href: "/notification-health", label: "Notification health", icon: BellOff },
  { href: "/team", label: "Admin team", icon: UsersRound, superAdminOnly: true },
];

function isActive(itemHref: string, location: string): boolean {
  if (itemHref === "/") return location === "/" || location === "";
  return location === itemHref || location.startsWith(`${itemHref}/`);
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

  const visibleNav = NAV.filter((item) => !item.superAdminOnly || user?.isSuperAdmin);

  return (
    <div className="flex min-h-screen w-full bg-secondary/30">
      <aside className="hidden md:flex md:flex-col w-64 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="px-5 py-5 flex items-center gap-2">
          <div className="bg-primary text-primary-foreground rounded-md w-8 h-8 flex items-center justify-center">
            <Shield className="w-4 h-4" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold text-sm">MyLocalTrade</div>
            <div className="text-xs opacity-70">Admin console</div>
          </div>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-1">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href, location);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/60 text-sidebar-foreground/90"
                }`}
                data-testid={`nav-${item.href.replace(/\//g, "") || "dashboard"}`}
              >
                <Icon className="w-4 h-4" />
                <span className="flex-1">{item.label}</span>
                {badgeFor(item) > 0 && (
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground"
                    data-testid={`badge-attention${item.href.replace(/\//g, "-")}`}
                  >
                    {badgeFor(item) > 99 ? "99+" : badgeFor(item)}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <div className="text-xs opacity-80 mb-2 truncate" title={user?.email}>
            {user?.fullName || user?.email}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={logout}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4 mr-2" /> Sign out
          </Button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-card border-b">
          <div className="flex items-center gap-2 font-semibold">
            <Shield className="w-4 h-4 text-primary" /> MyLocalTrade Admin
          </div>
          <Button variant="ghost" size="sm" onClick={logout} data-testid="button-logout-mobile">
            <LogOut className="w-4 h-4" />
          </Button>
        </header>
        <nav className="md:hidden flex overflow-x-auto gap-1 px-2 py-2 bg-card border-b">
          {visibleNav.map((item) => {
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
