import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { getApiUrl } from '@/lib/api-url';

export type TeamContext = { enabled: boolean; role: 'OWNER' | 'EMPLOYEE' | null };

// Company Teams: which role the signed-in trader plays for their company.
// Server-derived (GET /api/company/team-context) — never inferred from the
// caller's personal RevenueCat entitlement. Flag off (the default) → the
// server answers { enabled: false } and every consumer keeps the exact
// legacy single-login behaviour.
//
// Shares one query key across screens (Home, Account, Pricing, Billing) so
// the answer is fetched once and stays consistent.
export function useTeamContext() {
  const { isAuthenticated, isTrader, token, user } = useAuth();
  const query = useQuery({
    // Scoped PER IDENTITY: a global key would hand the previous user's
    // resolved role to the next login on the same device (owner → employee
    // switch would briefly render owner surfaces while refetching). Each
    // user id gets its own cache entry, so a fresh identity starts at
    // "unknown" and fails closed.
    queryKey: ['company', 'team-context', user?.id ?? null],
    enabled: isAuthenticated && isTrader && !!token && user?.id != null,
    queryFn: async (): Promise<TeamContext> => {
      const res = await fetch(`${getApiUrl()}/api/company/team-context`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // A non-OK answer (401/403/500, network hiccup) is NOT evidence the
      // caller isn't an employee — throw so the role stays UNKNOWN and
      // owner-only surfaces stay hidden, instead of silently defaulting to
      // the legacy (owner-ish) shape.
      if (!res.ok) throw new Error('Failed to load team context');
      return res.json();
    },
  });

  const teamContext = query.data;
  const isEmployee = teamContext?.enabled === true && teamContext.role === 'EMPLOYEE';
  const isTeamOwner = teamContext?.enabled === true && teamContext.role === 'OWNER';
  // True while we don't positively know an authenticated trader's role —
  // loading, errored, or user object not hydrated yet. Owner-only surfaces
  // must fail closed (stay hidden / refuse purchase) while this is true so
  // an Employee never sees a paywall flash on a cold start or during a
  // server hiccup.
  const roleUnknown =
    isAuthenticated && isTrader && !!token && query.data === undefined;

  return { ...query, teamContext, isEmployee, isTeamOwner, roleUnknown };
}
