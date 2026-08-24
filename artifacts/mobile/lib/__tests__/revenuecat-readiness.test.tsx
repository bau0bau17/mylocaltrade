import React from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockUseAuth = jest.fn();
const mockQueryClient = {
  invalidateQueries: jest.fn().mockResolvedValue(undefined),
  refetchQueries: jest.fn().mockResolvedValue(undefined),
};
const mockPurchases = {
  configure: jest.fn(),
  setLogLevel: jest.fn(),
  setLogHandler: jest.fn(),
  getOfferings: jest.fn(),
  getCustomerInfo: jest.fn(),
  logIn: jest.fn(),
  logOut: jest.fn(),
};

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mockQueryClient,
}));

jest.mock('expo-constants', () => ({
  default: { executionEnvironment: 'standalone' },
}));

jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('react-native-purchases', () => ({
  default: mockPurchases,
  LOG_LEVEL: { ERROR: 'ERROR', WARN: 'WARN', VERBOSE: 'VERBOSE' },
}));

jest.mock('@/lib/api-url', () => ({
  getApiUrl: () => 'http://test-api',
}));

// The module reads this when it is first required below. A native iOS key is
// sufficient to exercise the provider's lifecycle; no RevenueCat request leaves
// Jest because every SDK call is mocked above.
process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY = 'appl_test_key';

const { SubscriptionProvider, useSubscription } = require('@/lib/revenuecat') as typeof import('@/lib/revenuecat');

const customerInfo = {
  entitlements: { active: {}, all: {} },
  activeSubscriptions: [],
  allPurchasedProductIdentifiers: [],
  managementURL: null,
};

const offering = {
  identifier: 'default',
  availablePackages: [
    {
      identifier: 'team_5_annual',
      packageType: 'ANNUAL',
      product: {
        identifier: 'com.mylocaltrade.app.trader.team5.yearly',
        priceString: '£123.45',
      },
    },
  ],
};

function ReadinessProbe() {
  const subscription = useSubscription();
  return (
    <>
      <Text testID="readiness-state">
        {[
          subscription.offeringsState,
          subscription.isReady ? 'ready' : 'not-ready',
          subscription.isLoading ? 'loading' : 'not-loading',
          subscription.isIdentityTransitioning ? 'transitioning' : 'stable',
        ].join(':')}
      </Text>
      <Text testID="offering-state">
        {subscription.team5Package ? 'has-offering' : 'no-offering'}
      </Text>
      <Pressable testID="retry-readiness" onPress={() => void subscription.refresh()}>
        <Text>Retry readiness</Text>
      </Pressable>
    </>
  );
}

function renderProvider() {
  return render(
    <SubscriptionProvider>
      <ReadinessProbe />
    </SubscriptionProvider>,
  );
}

describe('SubscriptionProvider RevenueCat readiness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    mockUseAuth.mockReturnValue({
      user: { id: 1, revenuecatId: 'rc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      token: 'token',
    });
    mockPurchases.getCustomerInfo.mockResolvedValue(customerInfo);
    mockPurchases.logIn.mockResolvedValue({ customerInfo });
    mockPurchases.logOut.mockResolvedValue(customerInfo);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lets the newer identity cycle settle after startup becomes stale', async () => {
    mockPurchases.getOfferings.mockResolvedValue({ current: offering });

    renderProvider();

    await waitFor(() => {
      expect(mockPurchases.logIn).toHaveBeenCalledWith('rc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    });
    await waitFor(() => {
      expect(screen.getByTestId('readiness-state').props.children).toBe(
        'ready:ready:not-loading:stable',
      );
    });
    expect(mockPurchases.getOfferings).toHaveBeenCalled();
  });

  it('settles a failed offerings read into a retryable error and reruns the current identity cycle', async () => {
    mockPurchases.getOfferings
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({ current: offering });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('readiness-state').props.children).toBe(
        'offerings-error:ready:not-loading:stable',
      );
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('retry-readiness'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('readiness-state').props.children).toBe(
        'ready:ready:not-loading:stable',
      );
    });
    expect(mockPurchases.getOfferings).toHaveBeenCalledTimes(2);
  });

  it('settles an empty offering explicitly instead of retaining the loading state', async () => {
    mockPurchases.getOfferings.mockResolvedValue({
      current: { identifier: 'default', availablePackages: [] },
    });

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('readiness-state').props.children).toBe(
        'offerings-empty:ready:not-loading:stable',
      );
    });
  });

  it('clears the prior offering and waits for a new canonical login before Retry reads it', async () => {
    mockPurchases.getOfferings.mockResolvedValue({ current: offering });
    const initial = renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('readiness-state').props.children).toBe(
        'ready:ready:not-loading:stable',
      );
    });
    expect(screen.getByTestId('offering-state').props.children).toBe('has-offering');

    let resolveNewIdentity:
      | ((value: { customerInfo: typeof customerInfo }) => void)
      | undefined;
    const newIdentity = new Promise<{ customerInfo: typeof customerInfo }>((resolve) => {
      resolveNewIdentity = resolve;
    });
    mockPurchases.logIn.mockImplementationOnce(() => newIdentity);
    mockUseAuth.mockReturnValue({
      user: { id: 2, revenuecatId: 'rc_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      token: 'token',
    });

    initial.rerender(
      <SubscriptionProvider>
        <ReadinessProbe />
      </SubscriptionProvider>,
    );

    await waitFor(() => {
      expect(mockPurchases.logIn).toHaveBeenLastCalledWith(
        'rc_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      );
    });
    expect(screen.getByTestId('offering-state').props.children).toBe('no-offering');

    const offeringCallsBeforeRetry = mockPurchases.getOfferings.mock.calls.length;
    fireEvent.press(screen.getByTestId('retry-readiness'));
    await act(async () => {});
    expect(mockPurchases.getOfferings).toHaveBeenCalledTimes(offeringCallsBeforeRetry);

    await act(async () => {
      resolveNewIdentity?.({ customerInfo });
    });

    await waitFor(() => {
      expect(screen.getByTestId('readiness-state').props.children).toBe(
        'ready:ready:not-loading:stable',
      );
    });
    expect(screen.getByTestId('offering-state').props.children).toBe('has-offering');
    expect(mockPurchases.getOfferings.mock.calls.length).toBeGreaterThan(
      offeringCallsBeforeRetry,
    );
  });

  it('keeps Retry behind the latest canonical transition when identities change twice', async () => {
    mockPurchases.getOfferings.mockResolvedValue({ current: offering });
    const initial = renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId('readiness-state').props.children).toBe(
        'ready:ready:not-loading:stable',
      );
    });

    let resolveSecondIdentity:
      | ((value: { customerInfo: typeof customerInfo }) => void)
      | undefined;
    const secondIdentity = new Promise<{ customerInfo: typeof customerInfo }>((resolve) => {
      resolveSecondIdentity = resolve;
    });
    mockPurchases.logIn.mockImplementationOnce(() => secondIdentity);
    mockUseAuth.mockReturnValue({
      user: { id: 2, revenuecatId: 'rc_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      token: 'token',
    });
    initial.rerender(
      <SubscriptionProvider>
        <ReadinessProbe />
      </SubscriptionProvider>,
    );
    await waitFor(() => {
      expect(mockPurchases.logIn).toHaveBeenLastCalledWith(
        'rc_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      );
    });
    const offeringCallsBeforeRetry = mockPurchases.getOfferings.mock.calls.length;
    fireEvent.press(screen.getByTestId('retry-readiness'));

    let resolveThirdIdentity:
      | ((value: { customerInfo: typeof customerInfo }) => void)
      | undefined;
    const thirdIdentity = new Promise<{ customerInfo: typeof customerInfo }>((resolve) => {
      resolveThirdIdentity = resolve;
    });
    mockPurchases.logIn.mockImplementationOnce(() => thirdIdentity);
    mockUseAuth.mockReturnValue({
      user: { id: 3, revenuecatId: 'rc_cccccccccccccccccccccccccccccccc' },
      token: 'token',
    });
    initial.rerender(
      <SubscriptionProvider>
        <ReadinessProbe />
      </SubscriptionProvider>,
    );
    expect(mockPurchases.logIn).toHaveBeenLastCalledWith(
      'rc_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );

    await act(async () => {
      resolveSecondIdentity?.({ customerInfo });
    });
    await waitFor(() => {
      expect(mockPurchases.logIn).toHaveBeenLastCalledWith(
        'rc_cccccccccccccccccccccccccccccccc',
      );
    });
    expect(mockPurchases.getOfferings).toHaveBeenCalledTimes(offeringCallsBeforeRetry);

    await act(async () => {
      resolveThirdIdentity?.({ customerInfo });
    });
    await waitFor(() => {
      expect(screen.getByTestId('readiness-state').props.children).toBe(
        'ready:ready:not-loading:stable',
      );
    });
    expect(mockPurchases.getOfferings.mock.calls.length).toBeGreaterThan(
      offeringCallsBeforeRetry,
    );
  });

  it('keeps the native identity lock after its UI timeout until the late login settles', async () => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    let resolveIdentity:
      | ((value: { customerInfo: typeof customerInfo }) => void)
      | undefined;
    const lateIdentity = new Promise<{ customerInfo: typeof customerInfo }>((resolve) => {
      resolveIdentity = resolve;
    });
    mockPurchases.logIn.mockImplementationOnce(() => lateIdentity);
    mockPurchases.getOfferings.mockResolvedValue({ current: offering });

    try {
      renderProvider();
      await act(async () => {});
      expect(mockPurchases.logIn).toHaveBeenCalledWith(
        'rc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      );

      await act(async () => {
        jest.advanceTimersByTime(15_000);
      });
      expect(screen.getByTestId('readiness-state').props.children).toBe(
        'provider-error:ready:not-loading:stable',
      );

      const offeringCallsBeforeRetry = mockPurchases.getOfferings.mock.calls.length;
      fireEvent.press(screen.getByTestId('retry-readiness'));
      await act(async () => {});
      expect(mockPurchases.getOfferings).toHaveBeenCalledTimes(offeringCallsBeforeRetry);

      await act(async () => {
        resolveIdentity?.({ customerInfo });
      });
      await waitFor(() => {
        expect(screen.getByTestId('readiness-state').props.children).toBe(
          'ready:ready:not-loading:stable',
        );
      });
      expect(mockPurchases.getOfferings.mock.calls.length).toBeGreaterThan(
        offeringCallsBeforeRetry,
      );
    } finally {
      jest.useRealTimers();
    }
  });
});