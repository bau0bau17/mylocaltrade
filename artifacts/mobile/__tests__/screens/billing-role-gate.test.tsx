/**
 * BillingScreen – role-gating tests
 *
 * Guards verified here:
 * 1. When isEmployee is true the employee explainer card is shown and the
 *    /subscriptions/status query is disabled (enabled: false).
 * 2. When roleUnknown is true a spinner is shown and the status query is
 *    disabled — no premature owner-surface flash during loading.
 * 3. The useFocusEffect callback never calls refetch() when isEmployee is true
 *    (avoids firing a request the server will 403 anyway).
 * 4. The useFocusEffect callback never calls refetch() when roleUnknown is true.
 * 5. The useFocusEffect callback DOES call refetch() for a confirmed owner.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── module mocks ─────────────────────────────────────────────────────────────

jest.mock('@/hooks/useTeamContext', () => ({
  useTeamContext: jest.fn(),
}));

jest.mock('@/lib/revenuecat', () => ({
  useSubscription: jest.fn(),
}));

jest.mock('@workspace/api-client-react', () => ({
  useGetSubscriptionStatus: jest.fn(),
  useGetSubscriptionPlans: jest.fn(),
  useCancelSubscription: jest.fn(),
  useResumeSubscription: jest.fn(),
}));

jest.mock('@/hooks/usePullToRefresh', () => ({
  usePullToRefresh: jest.fn(() => ({ refreshing: false, onRefresh: jest.fn() })),
}));

jest.mock('@/lib/pricing', () => ({
  getYearlySavings: jest.fn(() => null),
}));

// useFocusEffect is mocked to immediately invoke its callback so that focus
// side-effects run synchronously during render — enabling us to assert on
// whether refetch() was called without needing navigation infrastructure.
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => (() => void) | void) => { cb(); },
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: () => 49,
}));

// ─── imports after mocks ─────────────────────────────────────────────────────

import BillingScreen from '@/app/(tabs)/trader-dashboard/billing';
import { useTeamContext } from '@/hooks/useTeamContext';
import { useSubscription } from '@/lib/revenuecat';
import {
  useGetSubscriptionStatus,
  useGetSubscriptionPlans,
  useCancelSubscription,
  useResumeSubscription,
} from '@workspace/api-client-react';

const mockUseTeamContext = useTeamContext as jest.MockedFunction<typeof useTeamContext>;
const mockUseSubscription = useSubscription as jest.MockedFunction<typeof useSubscription>;
const mockUseGetSubscriptionStatus = useGetSubscriptionStatus as jest.MockedFunction<typeof useGetSubscriptionStatus>;
const mockUseGetSubscriptionPlans = useGetSubscriptionPlans as jest.MockedFunction<typeof useGetSubscriptionPlans>;
const mockUseCancelSubscription = useCancelSubscription as jest.MockedFunction<typeof useCancelSubscription>;
const mockUseResumeSubscription = useResumeSubscription as jest.MockedFunction<typeof useResumeSubscription>;

// ─── helpers ─────────────────────────────────────────────────────────────────

function freshWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

function setupSubscriptionDefaults(mockRefetch = jest.fn()) {
  mockUseGetSubscriptionStatus.mockReturnValue({
    data: { plan: 'basic', status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: null },
    isLoading: false,
    refetch: mockRefetch,
  } as unknown as ReturnType<typeof useGetSubscriptionStatus>);

  mockUseGetSubscriptionPlans.mockReturnValue({
    data: { plans: [] },
  } as unknown as ReturnType<typeof useGetSubscriptionPlans>);

  mockUseCancelSubscription.mockReturnValue({
    mutateAsync: jest.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useCancelSubscription>);

  mockUseResumeSubscription.mockReturnValue({
    mutateAsync: jest.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useResumeSubscription>);

  mockUseSubscription.mockReturnValue({
    isSupported: false,
    hasTraderSubscription: false,
    isReady: false,
    monthlyPackage: null,
    annualPackage: null,
    activeCadence: null,
    willRenew: null,
    expiresAt: null,
    refresh: jest.fn(),
    purchase: jest.fn(),
    restore: jest.fn(),
    presentCustomerCenter: jest.fn(),
    manageSubscriptions: jest.fn(),
  } as unknown as ReturnType<typeof useSubscription>);
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('BillingScreen role gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── 1. Employee gate ────────────────────────────────────────────────────────

  it('shows the employee explainer card when isEmployee is true', () => {
    mockUseTeamContext.mockReturnValue({
      isEmployee: true,
      isTeamOwner: false,
      roleUnknown: false,
    } as unknown as ReturnType<typeof useTeamContext>);
    setupSubscriptionDefaults();

    render(<BillingScreen />, { wrapper: freshWrapper() });

    expect(screen.getByText(/managed by your business owner/i)).toBeTruthy();
    expect(screen.queryByText(/current plan/i)).toBeNull();
  });

  it('disables the /subscriptions/status query when isEmployee is true', () => {
    mockUseTeamContext.mockReturnValue({
      isEmployee: true,
      isTeamOwner: false,
      roleUnknown: false,
    } as unknown as ReturnType<typeof useTeamContext>);
    setupSubscriptionDefaults();

    render(<BillingScreen />, { wrapper: freshWrapper() });

    // useGetSubscriptionStatus must have been called with enabled: false.
    const callArg = mockUseGetSubscriptionStatus.mock.calls[0]?.[0];
    expect(callArg?.query?.enabled).toBe(false);
  });

  // ── 2. roleUnknown spinner ──────────────────────────────────────────────────

  it('shows a spinner when roleUnknown is true — no plan content', () => {
    mockUseTeamContext.mockReturnValue({
      isEmployee: false,
      isTeamOwner: false,
      roleUnknown: true,
    } as unknown as ReturnType<typeof useTeamContext>);
    setupSubscriptionDefaults();

    render(<BillingScreen />, { wrapper: freshWrapper() });

    // Spinner present; billing content absent.
    expect(
      screen.UNSAFE_queryAllByType(require('react-native').ActivityIndicator).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/current plan/i)).toBeNull();
  });

  it('disables the /subscriptions/status query when roleUnknown is true', () => {
    mockUseTeamContext.mockReturnValue({
      isEmployee: false,
      isTeamOwner: false,
      roleUnknown: true,
    } as unknown as ReturnType<typeof useTeamContext>);
    setupSubscriptionDefaults();

    render(<BillingScreen />, { wrapper: freshWrapper() });

    const callArg = mockUseGetSubscriptionStatus.mock.calls[0]?.[0];
    expect(callArg?.query?.enabled).toBe(false);
  });

  // ── 3. Focus effect: employee guard ────────────────────────────────────────

  it('focus effect does NOT call refetch when isEmployee is true', () => {
    const mockRefetch = jest.fn();

    mockUseTeamContext.mockReturnValue({
      isEmployee: true,
      isTeamOwner: false,
      roleUnknown: false,
    } as unknown as ReturnType<typeof useTeamContext>);
    setupSubscriptionDefaults(mockRefetch);

    render(<BillingScreen />, { wrapper: freshWrapper() });

    // useFocusEffect fires immediately (mocked). refetch must not have been called.
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  // ── 4. Focus effect: roleUnknown guard ─────────────────────────────────────

  it('focus effect does NOT call refetch when roleUnknown is true', () => {
    const mockRefetch = jest.fn();

    mockUseTeamContext.mockReturnValue({
      isEmployee: false,
      isTeamOwner: false,
      roleUnknown: true,
    } as unknown as ReturnType<typeof useTeamContext>);
    setupSubscriptionDefaults(mockRefetch);

    render(<BillingScreen />, { wrapper: freshWrapper() });

    expect(mockRefetch).not.toHaveBeenCalled();
  });

  // ── 5. Focus effect: owner allowed ─────────────────────────────────────────

  it('focus effect DOES call refetch for a confirmed owner', () => {
    const mockRefetch = jest.fn().mockResolvedValue({});

    mockUseTeamContext.mockReturnValue({
      isEmployee: false,
      isTeamOwner: true,
      roleUnknown: false,
    } as unknown as ReturnType<typeof useTeamContext>);
    setupSubscriptionDefaults(mockRefetch);

    render(<BillingScreen />, { wrapper: freshWrapper() });

    // useFocusEffect fires immediately (mocked). refetch must have been called once.
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});
