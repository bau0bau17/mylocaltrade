import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  UserProfile,
  LoginRequest,
  RegisterCustomerRequest,
  RegisterTraderRequest,
} from '@workspace/api-client-react';
import {
  login as apiLogin,
  registerCustomer as apiRegisterCustomer,
  registerTrader as apiRegisterTrader,
  resendVerificationEmail as apiResendVerificationEmail,
} from '@workspace/api-client-react';
import {
  registerForPushNotificationsAsync,
  unregisterPushNotificationsAsync,
} from '@/lib/push-notifications';

export class EmailNotVerifiedError extends Error {
  readonly code = 'EMAIL_NOT_VERIFIED';
  readonly email: string;
  constructor(email: string) {
    super('Please verify your email address before logging in.');
    this.name = 'EmailNotVerifiedError';
    this.email = email;
  }
}

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  isLoading: boolean;
  login: (data: LoginRequest) => Promise<void>;
  registerCustomer: (data: RegisterCustomerRequest) => Promise<{ email: string; pollToken: string }>;
  registerTrader: (data: RegisterTraderRequest) => Promise<{ email: string; pollToken: string }>;
  resendVerification: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  isTrader: boolean;
  isCustomer: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface ApiErrorLike {
  status?: number;
  data?: { error?: string; code?: string; email?: string };
}

function extractApiError(err: unknown, fallback: string): Error {
  if (err && typeof err === 'object') {
    const e = err as ApiErrorLike;
    if (e.data?.error) return new Error(e.data.error);
  }
  if (err instanceof Error) return err;
  return new Error(fallback);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStoredAuth();
  }, []);

  const loadStoredAuth = async () => {
    try {
      const storedToken = await AsyncStorage.getItem('auth_token');
      const storedUser = await AsyncStorage.getItem('auth_user');
      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        // Refresh the push token in the background so server has the latest.
        void registerForPushNotificationsAsync();
      }
    } catch (e) {
      console.error('Failed to load auth state', e);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (data: LoginRequest) => {
    try {
      const response = await apiLogin(data);
      await AsyncStorage.setItem('auth_token', response.token);
      await AsyncStorage.setItem('auth_user', JSON.stringify(response.user));
      setToken(response.token);
      setUser(response.user);
      void registerForPushNotificationsAsync();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 403) {
        const apiErr = err as { data?: { code?: string; email?: string } };
        if (apiErr.data?.code === 'EMAIL_NOT_VERIFIED') {
          throw new EmailNotVerifiedError(apiErr.data?.email ?? data.email);
        }
      }
      throw err;
    }
  };

  const registerCustomer = async (
    data: RegisterCustomerRequest,
  ): Promise<{ email: string; pollToken: string }> => {
    try {
      const json = await apiRegisterCustomer(data);
      return { email: json.email, pollToken: json.pollToken };
    } catch (err) {
      throw extractApiError(err, 'Registration failed');
    }
  };

  const registerTrader = async (
    data: RegisterTraderRequest,
  ): Promise<{ email: string; pollToken: string }> => {
    try {
      const json = await apiRegisterTrader(data);
      return { email: json.email, pollToken: json.pollToken };
    } catch (err) {
      throw extractApiError(err, 'Registration failed');
    }
  };

  const resendVerification = async (email: string): Promise<void> => {
    try {
      await apiResendVerificationEmail({ email });
    } catch (err) {
      throw extractApiError(err, 'Failed to resend email');
    }
  };

  const logout = async () => {
    await unregisterPushNotificationsAsync();
    await AsyncStorage.removeItem('auth_token');
    await AsyncStorage.removeItem('auth_user');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        registerCustomer,
        registerTrader,
        resendVerification,
        logout,
        isAuthenticated: !!user,
        isTrader: user?.role === 'trader',
        isCustomer: user?.role === 'customer',
        isAdmin: user?.role === 'admin',
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
