/**
 * PricingScreen – role-gating tests
 *
 * Guards verified here:
 * 1. While roleUnknown is true (team-context pending / 4xx / 5xx), only a
 *    spinner is rendered — no plan cards, no subscribe buttons, no restore button.
 * 2. When isEmployee is true the employee gate explainer is rendered and no
 *    plan cards, subscribe buttons, or restore button are visible.
 * 3. When isEmployee is false and roleUnknown is false (confirmed owner or
 *    flag-off) the pricing content is accessible.
 * 4. A confirmed owner can press "Restore purchases" and it calls through to
 *    RevenueCat (the role guard does not fire for an owner).
 *
 * Note on defense-in-depth guards: handlePurchase and handleRestore contain
 * an additional isEmployee || roleUnknown bail-out that fires if the component
 * somehow has stale state while a button is pressed. These are only reachable
 * through the screen when the screen-level gate already blocks rendering the
 * buttons — so the screen-level gate tests below are the primary behavioral
 * assertions, and the guard itself is verified by checking that the subscribe /
 * restore buttons are absent from the DOM.
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

import PricingScreen from '../pricing';
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

// ─── helpers ─────────────────────────────────────────────────────────────────

function freshWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

/** Put the screen in "confirmed owner, verified, IAP supported with both packages" state. */
function setupOwnerIAPDefaults(mockPurchase = jest.fn(), mockRestore = jest.fn()) {
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

  mockUseTeamContext.mockReturnValue({
    isEmployee: false,
    isTeamOwner: true,
    roleUnknown: false,
    teamContext: { enabled: true, role: 'OWNER' },
    isLoading: false,
    isError: false,
    isSuccess: true,
  } as unknown as ReturnType<typeof useTeamContext>);

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

  mockUseSubscription.mockReturnValue({
    isSupported: true,
    hasTraderSubscription: false,
    isReady: true,
    monthlyPackage: { product: { price: 4.99, priceString: '£4.99' } },
    annualPackage: { product: { price: 49.99, priceString: '£49.99' } },
    purchase: mockPurchase,
    restore: mockRestore,
    refresh: jest.fn(),
    presentCustomerCenter: jest.fn(),
    manageSubscriptions: jest.fn(),
    activeCadence: null,
    willRenew: null,
    expiresAt: null,
  } as unknown as ReturnType<typeof useSubscription>);
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('PricingScreen role gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── 1. roleUnknown → spinner gate ──────────────────────────────────────────

  it('shows a spinner (only) while roleUnknown is true — no plan or subscribe content', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isTrader: true,
      token: 'tok',
      user: { id: 1, role: 'trader', email: 't@t.com' },
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

    mockUseTeamContext.mockReturnValue({
      isEmployee: false,
      isTeamOwner: false,
      roleUnknown: true,
      teamContext: undefined,
      isLoading: true,
      isError: false,
      isSuccess: false,
    } as unknown as ReturnType<typeof useTeamContext>);

    mockUseGetSubscriptionPlans.mockReturnValue({
      data: undefined,
      isLoading: true,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useGetSubscriptionPlans>);

    mockUseGetTraderOnboardingStatus.mockReturnValue({
      data: undefined,
      isLoading: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useGetTraderOnboardingStatus>);

    mockUseSubscription.mockReturnValue({
      isSupported: false,
    } as unknown as ReturnType<typeof useSubscription>);

    render(<PricingScreen />, { wrapper: freshWrapper() });

    // Spinner must be present.
    expect(
      screen.UNSAFE_queryAllByType(require('react-native').ActivityIndicator).length,
    ).toBeGreaterThan(0);

    // No subscribe or restore buttons — the screen gate prevents rendering them.
    expect(screen.queryByText(/subscribe monthly/i)).toBeNull();
    expect(screen.queryByText(/subscribe yearly/i)).toBeNull();
    expect(screen.queryByText(/restore purchases/i)).toBeNull();
    expect(screen.queryByText(/choose your plan/i)).toBeNull();
  });

  // ── 2. isEmployee → employee gate ──────────────────────────────────────────

  it('shows employee gate when isEmployee is true — no plan, subscribe, or restore content', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isTrader: true,
      token: 'tok',
      user: { id: 2, role: 'trader', email: 'emp@test.com' },
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

    mockUseTeamContext.mockReturnValue({
      isEmployee: true,
      isTeamOwner: false,
      roleUnknown: false,
      teamContext: { enabled: true, role: 'EMPLOYEE' },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as unknown as ReturnType<typeof useTeamContext>);

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

    mockUseSubscription.mockReturnValue({
      isSupported: false,
    } as unknown as ReturnType<typeof useSubscription>);

    render(<PricingScreen />, { wrapper: freshWrapper() });

    // Employee explainer must be visible.
    expect(screen.getByText(/managed by your business owner/i)).toBeTruthy();

    // No subscribe or restore buttons.
    expect(screen.queryByText(/subscribe monthly/i)).toBeNull();
    expect(screen.queryByText(/subscribe yearly/i)).toBeNull();
    expect(screen.queryByText(/restore purchases/i)).toBeNull();
  });

  // ── 3. Confirmed owner sees plan content ───────────────────────────────────

  it('renders plan content when the caller is a confirmed owner', () => {
    setupOwnerIAPDefaults();

    render(<PricingScreen />, { wrapper: freshWrapper() });

    // The screen-level gate messages must not appear.
    expect(screen.queryByText(/managed by your business owner/i)).toBeNull();

    // Pricing screen header is visible (appears at least once — hero + IAP section both use it).
    expect(screen.getAllByText(/choose your plan/i).length).toBeGreaterThan(0);
  });

  // ── 4 & 5. IAP packages absent from DOM when gates are active ──────────────

  it('subscribe buttons are absent when roleUnknown is true even with IAP packages available', () => {
    // Deliberately configure IAP packages — the gate should still hide them.
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

    mockUseTeamContext.mockReturnValue({
      isEmployee: false,
      isTeamOwner: false,
      roleUnknown: true,
      teamContext: undefined,
      isLoading: true,
      isError: false,
      isSuccess: false,
    } as unknown as ReturnType<typeof useTeamContext>);

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

    const mockPurchase = jest.fn();
    mockUseSubscription.mockReturnValue({
      isSupported: true,
      hasTraderSubscription: false,
      isReady: true,
      monthlyPackage: { product: { price: 4.99, priceString: '£4.99' } },
      annualPackage: null,
      purchase: mockPurchase,
      restore: jest.fn(),
      refresh: jest.fn(),
    } as unknown as ReturnType<typeof useSubscription>);

    render(<PricingScreen />, { wrapper: freshWrapper() });

    // Spinner gate — no subscribe buttons.
    expect(screen.queryByText(/subscribe monthly/i)).toBeNull();
    // RevenueCat was never invoked.
    expect(mockPurchase).not.toHaveBeenCalled();
  });

  it('subscribe and restore buttons are absent from DOM when isEmployee is true', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isTrader: true,
      token: 'tok',
      user: { id: 2, role: 'trader', email: 'emp@test.com' },
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

    mockUseTeamContext.mockReturnValue({
      isEmployee: true,
      isTeamOwner: false,
      roleUnknown: false,
      teamContext: { enabled: true, role: 'EMPLOYEE' },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as unknown as ReturnType<typeof useTeamContext>);

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

    const mockPurchase = jest.fn();
    const mockRestore = jest.fn();
    mockUseSubscription.mockReturnValue({
      isSupported: true,
      hasTraderSubscription: false,
      isReady: true,
      monthlyPackage: { product: { price: 4.99, priceString: '£4.99' } },
      annualPackage: null,
      purchase: mockPurchase,
      restore: mockRestore,
      refresh: jest.fn(),
      presentCustomerCenter: jest.fn(),
      manageSubscriptions: jest.fn(),
      activeCadence: null,
      willRenew: null,
      expiresAt: null,
    } as unknown as ReturnType<typeof useSubscription>);

    render(<PricingScreen />, { wrapper: freshWrapper() });

    // Employee gate is shown.
    expect(screen.getByText(/managed by your business owner/i)).toBeTruthy();

    // Neither subscribe nor restore buttons are present.
    expect(screen.queryByText(/subscribe monthly/i)).toBeNull();
    expect(screen.queryByText(/restore purchases/i)).toBeNull();

    // RevenueCat was never invoked.
    expect(mockPurchase).not.toHaveBeenCalled();
    expect(mockRestore).not.toHaveBeenCalled();
  });

  // ── 6. Confirmed owner can press Restore → calls RevenueCat ──────────────

  it('owner can press "Restore purchases" and RevenueCat restore is called (guard does not block owners)', async () => {
    const mockRestore = jest.fn().mockResolvedValue(false);
    setupOwnerIAPDefaults(jest.fn(), mockRestore);

    render(<PricingScreen />, { wrapper: freshWrapper() });

    const restoreBtn = screen.getByText(/restore purchases/i);
    fireEvent.press(restoreBtn);

    // Owner-only Alert must NOT have fired.
    expect(Alert.alert).not.toHaveBeenCalledWith('Owner only', expect.any(String));
    // RevenueCat restore was invoked.
    expect(mockRestore).toHaveBeenCalledTimes(1);
  });
});
