/**
 * PricingScreen – Phase C Team plan tests
 *
 * Contract under test:
 * 1. A confirmed owner sees all FIVE plans (Solo Monthly/Yearly + Team 5/10/20
 *    Annual) with prices taken from the live package objects — never hardcoded.
 * 2. Seat rules are shown: Solo cards say no employee seats; Team cards state
 *    the employee limit, and the section note explains that the owner uses no
 *    seat and pending invites reserve seats.
 * 3. Missing Team packages fail safely: the Solo cards render alone, no crash,
 *    no Team section, no invented prices.
 * 4. With an ACTIVE subscription the screen becomes a change-plan list: the
 *    current plan is marked (no buy button for it) and pressing another plan
 *    passes THAT package to RevenueCat (Apple upgrade/downgrade in-group).
 * 5. Shared-device role change: after a rerender where the team context now
 *    reports EMPLOYEE, all plan/purchase UI disappears in favour of the
 *    employee explainer.
 * 6. Employees never see Team packages even when they are loaded.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── module mocks (declared before any imports from the module tree) ──────────

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/hooks/useTeamContext', () => ({
  useTeamContext: jest.fn(),
}));

jest.mock('@/lib/revenuecat', () => ({
  useSubscription: jest.fn(),
  isUserCancelledError: jest.fn(() => false),
}));

jest.mock('@workspace/api-client-react', () => ({
  useGetSubscriptionPlans: jest.fn(),
  useGetTraderOnboardingStatus: jest.fn(),
}));

jest.mock('@/hooks/usePullToRefresh', () => ({
  usePullToRefresh: jest.fn(() => ({ refreshing: false, onRefresh: jest.fn() })),
}));

jest.mock('@/lib/api-url', () => ({
  getApiUrl: () => 'http://test-api',
}));

jest.mock('@/lib/pricing', () => ({
  getYearlySavings: jest.fn(() => null),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: () => 49,
}));

// ─── imports after mocks ─────────────────────────────────────────────────────

import PricingScreen from '@/app/(tabs)/pricing';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamContext } from '@/hooks/useTeamContext';
import { useSubscription } from '@/lib/revenuecat';
import {
  useGetSubscriptionPlans,
  useGetTraderOnboardingStatus,
} from '@workspace/api-client-react';

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseTeamContext = useTeamContext as jest.MockedFunction<typeof useTeamContext>;
const mockUseSubscription = useSubscription as jest.MockedFunction<typeof useSubscription>;
const mockUseGetSubscriptionPlans = useGetSubscriptionPlans as jest.MockedFunction<typeof useGetSubscriptionPlans>;
const mockUseGetTraderOnboardingStatus = useGetTraderOnboardingStatus as jest.MockedFunction<typeof useGetTraderOnboardingStatus>;

// ─── fixtures ─────────────────────────────────────────────────────────────────

// Prices deliberately unusual so any hardcoded fallback in the UI would fail
// the assertions — the ONLY source of truth is the package object.
const PKG_MONTHLY = {
  identifier: '$rc_monthly',
  product: { identifier: 'com.mylocaltrade.app.trader.monthly', price: 4.99, priceString: '£4.99' },
};
const PKG_ANNUAL = {
  identifier: '$rc_annual',
  product: { identifier: 'com.mylocaltrade.app.trader.yearly', price: 49.99, priceString: '£49.99' },
};
const PKG_TEAM5 = {
  identifier: 'team_5_annual',
  product: { identifier: 'com.mylocaltrade.app.trader.team5.yearly', price: 123.45, priceString: '£123.45' },
};
const PKG_TEAM10 = {
  identifier: 'team_10_annual',
  product: { identifier: 'com.mylocaltrade.app.trader.team10.yearly', price: 234.56, priceString: '£234.56' },
};
const PKG_TEAM20 = {
  identifier: 'team_20_annual',
  product: { identifier: 'com.mylocaltrade.app.trader.team20.yearly', price: 345.67, priceString: '£345.67' },
};

function freshWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

function mockOwnerAuth() {
  mockUseAuth.mockReturnValue({
    isAuthenticated: true,
    isTrader: true,
    token: 'tok',
    user: { id: 1, role: 'trader', email: 'owner@test.com' },
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
  } as unknown as ReturnType<typeof useAuth>);
}

function mockOwnerTeamContext() {
  mockUseTeamContext.mockReturnValue({
    isEmployee: false,
    isTeamOwner: true,
    roleUnknown: false,
    teamContext: { enabled: true, role: 'OWNER' },
    isLoading: false,
    isError: false,
    isSuccess: true,
  } as unknown as ReturnType<typeof useTeamContext>);
}

function mockEmployeeTeamContext() {
  mockUseTeamContext.mockReturnValue({
    isEmployee: true,
    isTeamOwner: false,
    roleUnknown: false,
    teamContext: { enabled: true, role: 'EMPLOYEE' },
    isLoading: false,
    isError: false,
    isSuccess: true,
  } as unknown as ReturnType<typeof useTeamContext>);
}

function mockQueries() {
  mockUseGetSubscriptionPlans.mockReturnValue({
    data: { plans: [] },
    isLoading: false,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useGetSubscriptionPlans>);
  mockUseGetTraderOnboardingStatus.mockReturnValue({
    data: { verificationStatus: 'VERIFIED' },
    isLoading: false,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useGetTraderOnboardingStatus>);
}

interface SubscriptionOverrides {
  [key: string]: unknown;
}

function mockSubscriptionValue(overrides: SubscriptionOverrides = {}) {
  const value = {
    isSupported: true,
    hasTraderSubscription: false,
    isReady: true,
    monthlyPackage: PKG_MONTHLY,
    annualPackage: PKG_ANNUAL,
    team5Package: PKG_TEAM5,
    team10Package: PKG_TEAM10,
    team20Package: PKG_TEAM20,
    activeTeamTier: null,
    activeProductId: null,
    activeCadence: null,
    willRenew: null,
    expiresAt: null,
    purchase: jest.fn(),
    restore: jest.fn(),
    refresh: jest.fn(),
    presentCustomerCenter: jest.fn(),
    manageSubscriptions: jest.fn(),
    ...overrides,
  };
  mockUseSubscription.mockReturnValue(value as unknown as ReturnType<typeof useSubscription>);
  return value;
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('PricingScreen Phase C team plans', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockOwnerAuth();
    mockOwnerTeamContext();
    mockQueries();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('owner sees all five plans with live package prices and seat rules', () => {
    mockSubscriptionValue();

    render(<PricingScreen />, { wrapper: freshWrapper() });

    // All five plan names.
    expect(screen.getByText('Premium Monthly')).toBeTruthy();
    expect(screen.getByText('Premium Yearly')).toBeTruthy();
    expect(screen.getByText('Team 5 Annual')).toBeTruthy();
    expect(screen.getByText('Team 10 Annual')).toBeTruthy();
    expect(screen.getByText('Team 20 Annual')).toBeTruthy();

    // Prices come from the package objects, not hardcoded copy.
    expect(screen.getByText(/£4\.99/)).toBeTruthy();
    expect(screen.getByText(/£49\.99/)).toBeTruthy();
    expect(screen.getByText(/£123\.45/)).toBeTruthy();
    expect(screen.getByText(/£234\.56/)).toBeTruthy();
    expect(screen.getByText(/£345\.67/)).toBeTruthy();

    // Seat rules: Solo = no employee seats (both Solo cards)…
    expect(screen.getAllByText(/no employee seats/i).length).toBe(2);
    // …Team tags + descriptions state the per-tier employee limit…
    expect(screen.getAllByText(/up to 5 employees/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/up to 10 employees/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/up to 20 employees/i).length).toBeGreaterThan(0);
    // …and the Team section explains owner-no-seat + invite reservation.
    expect(screen.getByText(/owner never uses a seat/i)).toBeTruthy();
    expect(screen.getByText(/pending invitations reserve seats/i)).toBeTruthy();

    // Purchase buttons: monthly + yearly (annual card + 3 team cards).
    expect(screen.getByText(/subscribe monthly/i)).toBeTruthy();
    expect(screen.getAllByText(/subscribe yearly/i).length).toBe(4);
  });

  it('missing Team packages fail safely — Solo cards only, no Team section, no crash', () => {
    mockSubscriptionValue({
      team5Package: null,
      team10Package: null,
      team20Package: null,
    });

    render(<PricingScreen />, { wrapper: freshWrapper() });

    expect(screen.getByText('Premium Monthly')).toBeTruthy();
    expect(screen.getByText('Premium Yearly')).toBeTruthy();
    expect(screen.queryByText(/team plans/i)).toBeNull();
    expect(screen.queryByText(/team 5 annual/i)).toBeNull();
    expect(screen.queryByText(/team 10 annual/i)).toBeNull();
    expect(screen.queryByText(/team 20 annual/i)).toBeNull();
  });

  it('old provider shape (no team fields) renders Solo-only without crashing', () => {
    // Simulates a stale/partial context: team fields entirely undefined.
    mockUseSubscription.mockReturnValue({
      isSupported: true,
      hasTraderSubscription: false,
      isReady: true,
      monthlyPackage: PKG_MONTHLY,
      annualPackage: PKG_ANNUAL,
      purchase: jest.fn(),
      restore: jest.fn(),
      refresh: jest.fn(),
      presentCustomerCenter: jest.fn(),
      manageSubscriptions: jest.fn(),
      activeCadence: null,
      willRenew: null,
      expiresAt: null,
    } as unknown as ReturnType<typeof useSubscription>);

    render(<PricingScreen />, { wrapper: freshWrapper() });

    expect(screen.getByText('Premium Monthly')).toBeTruthy();
    expect(screen.queryByText(/team plans/i)).toBeNull();
  });

  it('active subscriber sees a change-plan list with the current plan marked', () => {
    mockSubscriptionValue({
      hasTraderSubscription: true,
      activeProductId: PKG_TEAM10.product.identifier,
      activeTeamTier: 'team10',
      activeCadence: 'annual',
    });

    render(<PricingScreen />, { wrapper: freshWrapper() });

    // Active card + change-plan heading (no "Choose your plan" IAP heading).
    expect(screen.getByText(/trader subscription active/i)).toBeTruthy();
    expect(screen.getByText(/team 10 annual is active/i)).toBeTruthy();
    expect(screen.getByText(/change your plan/i)).toBeTruthy();

    // The current plan is marked, not purchasable again.
    expect(screen.getByText(/current plan/i)).toBeTruthy();

    // Other plans offer a switch (Apple in-group upgrade/downgrade).
    expect(screen.getAllByText(/switch to this plan/i).length).toBe(4);

    // The free Basic card is not offered to an active subscriber.
    expect(screen.queryByText('Basic')).toBeNull();
  });

  it('switching passes the SELECTED package to RevenueCat purchase', () => {
    const purchase = jest.fn().mockResolvedValue(true);
    mockSubscriptionValue({
      hasTraderSubscription: true,
      activeProductId: PKG_TEAM10.product.identifier,
      activeTeamTier: 'team10',
      activeCadence: 'annual',
      // Only team10 (current) and team20 (upgrade target) available: exactly
      // one switch button, so the press target is unambiguous.
      monthlyPackage: null,
      annualPackage: null,
      team5Package: null,
      purchase,
    });

    render(<PricingScreen />, { wrapper: freshWrapper() });

    const switchButtons = screen.getAllByText(/switch to this plan/i);
    expect(switchButtons.length).toBe(1);
    fireEvent.press(switchButtons[0]);

    expect(purchase).toHaveBeenCalledTimes(1);
    expect(purchase).toHaveBeenCalledWith(PKG_TEAM20);
  });

  it('active product unknown/absent from offering: generic Premium label, nothing falsely marked current', () => {
    mockSubscriptionValue({
      hasTraderSubscription: true,
      activeProductId: 'com.mylocaltrade.app.trader.team50.yearly', // unknown id
      activeTeamTier: null,
      activeCadence: null,
    });

    render(<PricingScreen />, { wrapper: freshWrapper() });

    // Generic label — never a borrowed tier name.
    expect(screen.getByText(/premium is active/i)).toBeTruthy();
    expect(screen.queryByText(/team 50/i)).toBeNull();
    // No offered card is falsely marked current; all five stay switchable.
    expect(screen.queryByText(/current plan/i)).toBeNull();
    expect(screen.getAllByText(/switch to this plan/i).length).toBe(5);
  });

  it('cancelled-but-active subscriber still gets the change-plan list with current marked', () => {
    mockSubscriptionValue({
      hasTraderSubscription: true,
      activeProductId: PKG_ANNUAL.product.identifier,
      activeTeamTier: null,
      activeCadence: 'annual',
      willRenew: false,
    });

    render(<PricingScreen />, { wrapper: freshWrapper() });

    expect(screen.getByText(/change your plan/i)).toBeTruthy();
    expect(screen.getByText(/current plan/i)).toBeTruthy();
    expect(screen.getAllByText(/switch to this plan/i).length).toBe(4);
  });

  it('shared device: role change to EMPLOYEE on rerender hides all plans and purchase UI', () => {
    mockSubscriptionValue();

    const { rerender } = render(<PricingScreen />, { wrapper: freshWrapper() });
    expect(screen.getByText('Team 5 Annual')).toBeTruthy();

    // Same mounted screen, new team-context: an employee logged in.
    mockEmployeeTeamContext();
    rerender(<PricingScreen />);

    expect(screen.getByText(/managed by your business owner/i)).toBeTruthy();
    expect(screen.queryByText('Team 5 Annual')).toBeNull();
    expect(screen.queryByText(/subscribe monthly/i)).toBeNull();
    expect(screen.queryByText(/subscribe yearly/i)).toBeNull();
    expect(screen.queryByText(/switch to this plan/i)).toBeNull();
    expect(screen.queryByText(/restore purchases/i)).toBeNull();
  });

  it('employee never sees Team packages even when the offering has them loaded', () => {
    mockEmployeeTeamContext();
    const value = mockSubscriptionValue();

    render(<PricingScreen />, { wrapper: freshWrapper() });

    expect(screen.getByText(/managed by your business owner/i)).toBeTruthy();
    expect(screen.queryByText(/team 5 annual/i)).toBeNull();
    expect(screen.queryByText(/team 10 annual/i)).toBeNull();
    expect(screen.queryByText(/team 20 annual/i)).toBeNull();
    expect(value.purchase).not.toHaveBeenCalled();
    expect(value.restore).not.toHaveBeenCalled();
  });
});
