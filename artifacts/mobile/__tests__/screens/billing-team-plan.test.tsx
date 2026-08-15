/**
 * BillingScreen – Phase C Team plan label tests
 *
 * Contract under test:
 * 1. An owner on a Team plan sees the tier label ("Team 10 Annual"), the seat
 *    summary (owner + up to N employees, owner uses no seat, pending invites
 *    reserve seats), and a "Change plan" action alongside Manage subscription.
 * 2. A Solo subscriber keeps the cadence-based label and gets NO team seat
 *    summary line.
 * 3. An old provider shape without team fields falls back to the cadence
 *    label without crashing.
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

function setupOwnerPremium(subscriptionOverrides: Record<string, unknown> = {}) {
  mockUseTeamContext.mockReturnValue({
    isEmployee: false,
    isTeamOwner: true,
    roleUnknown: false,
  } as unknown as ReturnType<typeof useTeamContext>);

  mockUseGetSubscriptionStatus.mockReturnValue({
    data: {
      plan: 'premium',
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: '2027-08-01T00:00:00.000Z',
    },
    isLoading: false,
    refetch: jest.fn(),
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
    isSupported: true,
    hasTraderSubscription: true,
    isReady: true,
    monthlyPackage: null,
    annualPackage: null,
    team5Package: null,
    team10Package: null,
    team20Package: null,
    activeTeamTier: null,
    activeProductId: null,
    activeCadence: 'annual',
    willRenew: true,
    expiresAt: null,
    refresh: jest.fn(),
    purchase: jest.fn(),
    restore: jest.fn(),
    presentCustomerCenter: jest.fn(),
    manageSubscriptions: jest.fn(),
    ...subscriptionOverrides,
  } as unknown as ReturnType<typeof useSubscription>);
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('BillingScreen Phase C team plan label', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('owner on Team 10 sees the tier label, seat summary and Change plan action', () => {
    setupOwnerPremium({
      activeTeamTier: 'team10',
      activeProductId: 'com.mylocaltrade.app.trader.team10.yearly',
      activeCadence: 'annual',
    });

    render(<BillingScreen />, { wrapper: freshWrapper() });

    expect(screen.getByText('Team 10 Annual')).toBeTruthy();
    expect(screen.getByText(/up to 10 employees/i)).toBeTruthy();
    expect(screen.getByText(/owner doesn't use a seat/i)).toBeTruthy();
    expect(screen.getByText(/pending invitations reserve seats/i)).toBeTruthy();
    // Button label also appears inside the action hint copy → getAllByText.
    expect(screen.getAllByText(/change plan/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Manage subscription')).toBeTruthy();
  });

  it('solo yearly subscriber keeps the cadence label and gets no seat summary', () => {
    setupOwnerPremium({
      activeTeamTier: null,
      activeProductId: 'com.mylocaltrade.app.trader.yearly',
      activeCadence: 'annual',
    });

    render(<BillingScreen />, { wrapper: freshWrapper() });

    expect(screen.getByText('Premium Yearly')).toBeTruthy();
    expect(screen.queryByText(/up to \d+ employees/i)).toBeNull();
    expect(screen.queryByText(/pending invitations reserve seats/i)).toBeNull();
  });

  it('old provider shape without team fields falls back to the cadence label', () => {
    setupOwnerPremium({
      activeTeamTier: undefined,
      activeProductId: undefined,
      activeCadence: 'monthly',
    });

    render(<BillingScreen />, { wrapper: freshWrapper() });

    expect(screen.getByText('Premium Monthly')).toBeTruthy();
    expect(screen.queryByText(/up to \d+ employees/i)).toBeNull();
  });
});
