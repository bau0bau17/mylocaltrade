import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

jest.mock('@/lib/push-notifications', () => ({
  registerForPushNotificationsAsync: jest.fn(async () => undefined),
  unregisterPushNotificationsAsync: jest.fn(async () => undefined),
}));

jest.mock('@workspace/api-client-react', () => {
  class MockApiError extends Error {
    status: number;
    constructor(status = 500) {
      super('API error');
      this.status = status;
    }
  }

  return {
    setUnauthorizedHandler: jest.fn(),
    getMe: jest.fn(),
    ApiError: MockApiError,
    login: jest.fn(),
    registerCustomer: jest.fn(),
    registerTrader: jest.fn(),
    resendVerificationEmail: jest.fn(),
    verifyEmailCode: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
  };
});

import { login as apiLogin } from '@workspace/api-client-react';
import { AuthProvider, useAuth } from '../AuthContext';

const mockApiLogin = apiLogin as jest.MockedFunction<typeof apiLogin>;

function freshClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

function makeWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(AuthProvider, null, children),
    );
}

describe('AuthProvider protected cache isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('removes Account A protected data before Account B can use the running app', async () => {
    const queryClient = freshClient();
    const accountA = {
      id: 101,
      role: 'customer' as const,
      email: 'a@example.test',
      fullName: 'Account A',
      isActive: true,
    };
    const accountB = {
      id: 202,
      role: 'customer' as const,
      email: 'b@example.test',
      fullName: 'Account B',
      isActive: true,
    };

    mockApiLogin
      .mockResolvedValueOnce({ token: 'token-account-a', user: accountA })
      .mockResolvedValueOnce({ token: 'token-account-b', user: accountB });

    const { result } = renderHook(() => useAuth(), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.login({ email: accountA.email, password: 'password' });
    });
    queryClient.setQueryData(['/api/conversations'], {
      conversations: [{ id: 1, customerName: 'Account A' }],
    });
    queryClient.setQueryData(['/api/profile'], { fullName: 'Account A' });

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(queryClient.getQueryData(['/api/conversations'])).toBeUndefined();
    expect(queryClient.getQueryData(['/api/profile'])).toBeUndefined();

    await act(async () => {
      await result.current.login({ email: accountB.email, password: 'password' });
    });

    expect(result.current.user?.id).toBe(accountB.id);
    expect(queryClient.getQueryData(['/api/conversations'])).toBeUndefined();
    expect(queryClient.getQueryData(['/api/profile'])).toBeUndefined();
  });
});