/**
 * useTeamContext – unit tests
 *
 * Guards verified here:
 * 1. Query is disabled when the user is not an authenticated trader.
 * 2. roleUnknown is true while the query is pending (no data yet).
 * 3. roleUnknown stays true when the server returns a 4xx or 5xx, preventing
 *    any owner-only surface from flashing open during a server hiccup.
 * 4. isEmployee / isTeamOwner resolve correctly on a successful response.
 * 5. The query key is scoped per user identity so switching accounts starts a
 *    fresh fetch (stale-role flash is impossible on a shared device).
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── module mocks ────────────────────────────────────────────────────────────

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/lib/api-url', () => ({
  getApiUrl: () => 'http://test-api',
}));

// ─── imports after mocks ─────────────────────────────────────────────────────

import { useTeamContext } from '../useTeamContext';
import { useAuth } from '@/contexts/AuthContext';

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Build a QueryClientProvider wrapper that disables retries for fast tests. */
function makeWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

function freshClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

/** Trader auth stub – optionally override individual fields. */
function traderAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  return {
    isAuthenticated: true,
    isTrader: true,
    token: 'tok-abc',
    user: { id: 'user-1', role: 'trader' as const, email: 'trader@test.com' },
    isLoading: false,
    login: jest.fn(),
    logout: jest.fn(),
    registerCustomer: jest.fn(),
    registerTrader: jest.fn(),
    resendVerification: jest.fn(),
    verifyEmailCode: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    applyToken: jest.fn(),
    refreshUser: jest.fn(),
    isCustomer: false,
    isAdmin: false,
    ...overrides,
  } as ReturnType<typeof useAuth>;
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('useTeamContext', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('keeps roleUnknown false and query disabled when user is not authenticated', () => {
    mockUseAuth.mockReturnValue(
      traderAuth({ isAuthenticated: false, isTrader: false, token: null, user: null }),
    );
    const qc = freshClient();
    const { result } = renderHook(() => useTeamContext(), {
      wrapper: makeWrapper(qc),
    });

    // Not authenticated → query never fires → data stays undefined.
    // But roleUnknown predicate requires isAuthenticated && isTrader, so it's false.
    expect(result.current.roleUnknown).toBe(false);
    expect(result.current.isEmployee).toBe(false);
    expect(result.current.isTeamOwner).toBe(false);
  });

  it('roleUnknown is true while the query has not resolved (loading state)', async () => {
    // Never resolve the fetch so the query stays "pending".
    global.fetch = jest.fn(() => new Promise(() => {})) as jest.Mock;

    mockUseAuth.mockReturnValue(traderAuth());

    const qc = freshClient();
    const { result } = renderHook(() => useTeamContext(), {
      wrapper: makeWrapper(qc),
    });

    // Immediately after mounting: query is pending → roleUnknown must be true.
    expect(result.current.roleUnknown).toBe(true);
    expect(result.current.isEmployee).toBe(false);
    expect(result.current.isTeamOwner).toBe(false);
  });

  it('roleUnknown stays true after a 4xx response (fail-closed)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    }) as jest.Mock;

    mockUseAuth.mockReturnValue(traderAuth());

    const qc = freshClient();
    const { result } = renderHook(() => useTeamContext(), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // After a 4xx the query errors – data stays undefined, so roleUnknown is true.
    expect(result.current.roleUnknown).toBe(true);
    expect(result.current.isEmployee).toBe(false);
    expect(result.current.isTeamOwner).toBe(false);
  });

  it('roleUnknown stays true after a 5xx response (fail-closed)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal Server Error' }),
    }) as jest.Mock;

    mockUseAuth.mockReturnValue(traderAuth());

    const qc = freshClient();
    const { result } = renderHook(() => useTeamContext(), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.roleUnknown).toBe(true);
  });

  it('resolves isEmployee when the server returns EMPLOYEE role', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ enabled: true, role: 'EMPLOYEE' }),
    }) as jest.Mock;

    mockUseAuth.mockReturnValue(traderAuth());

    const qc = freshClient();
    const { result } = renderHook(() => useTeamContext(), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.isEmployee).toBe(true);
    expect(result.current.isTeamOwner).toBe(false);
    expect(result.current.roleUnknown).toBe(false);
  });

  it('resolves isTeamOwner when the server returns OWNER role', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ enabled: true, role: 'OWNER' }),
    }) as jest.Mock;

    mockUseAuth.mockReturnValue(traderAuth());

    const qc = freshClient();
    const { result } = renderHook(() => useTeamContext(), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.isTeamOwner).toBe(true);
    expect(result.current.isEmployee).toBe(false);
    expect(result.current.roleUnknown).toBe(false);
  });

  it('scopes the query key per user identity so a newly logged-in user starts with roleUnknown=true', async () => {
    // First user resolves as OWNER (gets cached under user-1).
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ enabled: true, role: 'OWNER' }),
    }) as jest.Mock;

    mockUseAuth.mockReturnValue(
      traderAuth({ user: { id: 1, role: 'trader', email: 'owner@test.com', fullName: 'Owner', isActive: true } }),
    );

    const qc = freshClient();
    const { result, rerender } = renderHook(() => useTeamContext(), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => expect(result.current.isTeamOwner).toBe(true));

    // Switch to a different user — the new id has no cached entry.
    // Hang the new fetch so the loading state stays visible.
    global.fetch = jest.fn(() => new Promise(() => {})) as jest.Mock;
    mockUseAuth.mockReturnValue(
      traderAuth({ user: { id: 2, role: 'trader', email: 'employee@test.com', fullName: 'Employee', isActive: true } }),
    );

    rerender({});

    // New identity → no cached data → roleUnknown must be true immediately.
    expect(result.current.roleUnknown).toBe(true);
    expect(result.current.isTeamOwner).toBe(false);

    // Confirm there are now two distinct cache entries (one per user id).
    const cacheKeys = qc
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey);
    const teamContextKeys = cacheKeys.filter(
      (k) => Array.isArray(k) && k[0] === 'company' && k[1] === 'team-context',
    );
    expect(teamContextKeys.length).toBe(2);
    expect(teamContextKeys[0][2]).toBe(1);
    expect(teamContextKeys[1][2]).toBe(2);
  });
});
