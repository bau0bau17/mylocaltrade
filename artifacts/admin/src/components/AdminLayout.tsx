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
  Tag,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/traders", label: "Traders", icon: Users },
  { href: "/expiring-documents", label: "Expiring docs", icon: FileWarning },
  { href: "/audit-report", label: "Audit report", icon: ClipboardList },
  { href: "/enquiries", label: "Enquiries", icon: Mail },
  { href: "/reviews", label: "Reviews", icon: Star },
  { href: "/conversation-reports", label: "Conversation reports", icon: ShieldAlert },
  { href: "/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/promo-codes", label: "Promo codes", icon: Tag },
];

function isActive(itemHref: string, location: string): boolean {
  if (itemHref === "/") return location === "/" || location === "";
  return location === itemHref || location.startsWith(`${itemHref}/`);
}

export function AdminLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  const { data: pendingReviews } = useQuery({
    queryKey: ["admin", "reviews", "pending-count"],
    queryFn: () =>
      api<{ reviews: Array<{ id: number }> }>("/api/admin/reviews", {
        query: { status: "PENDING" },
      }),
    refetchInterval: 60_000,
    enabled: !!user,
  });
  const pendingCount = pendingReviews?.reviews.length ?? 0;

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
          {NAV.map((item) => {
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
                {item.href === "/reviews" && pendingCount > 0 && (
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground"
                    data-testid="badge-pending-reviews"
                  >
                    {pendingCount}
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
          {NAV.map((item) => {
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
              </Link>
            );
          })}
        </nav>
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
