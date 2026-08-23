import type { QueryClient } from '@tanstack/react-query';

/**
 * Identity-scoped cache keys for billing and Company Teams server state.
 *
 * Billing data must never be shared across app accounts on the same device:
 * an owner signing out followed by an employee (or another owner) must begin
 * with a distinct cache entry and wait for its own server-authorized response.
 */
export type TeamBillingUserId = string | number | null | undefined;

export function subscriptionStatusQueryKey(userId: TeamBillingUserId) {
  // Keep the generated client's legacy key during the brief unauthenticated /
  // auth-hydration state. Once an identity exists, billing is always scoped.
  return userId == null
    ? ['/api/subscriptions/status']
    : ['/api/subscriptions/status', userId];
}

export function teamContextQueryKey(userId: TeamBillingUserId) {
  return ['company', 'team-context', userId ?? null];
}

export function teamQueryKey(userId: TeamBillingUserId) {
  return ['company', 'team', userId ?? null];
}

/**
 * Atomically refresh the authenticated business owner's server state after
 * the API has confirmed a RevenueCat change. Inactive routes remain stale;
 * already-mounted Billing, Pricing, and Team consumers update immediately.
 */
export async function refreshTeamBillingQueries(
  queryClient: QueryClient,
  userId: Exclude<TeamBillingUserId, null | undefined>,
) {
  const statusKey = subscriptionStatusQueryKey(userId);
  const contextKey = teamContextQueryKey(userId);
  const teamKey = teamQueryKey(userId);

  await Promise.all([
    queryClient.invalidateQueries({ queryKey: statusKey, refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: contextKey, refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: teamKey, refetchType: 'none' }),
  ]);

  await Promise.all([
    queryClient.refetchQueries({ queryKey: statusKey, type: 'active' }),
    queryClient.refetchQueries({ queryKey: contextKey, type: 'active' }),
    queryClient.refetchQueries({ queryKey: teamKey, type: 'active' }),
  ]);
}