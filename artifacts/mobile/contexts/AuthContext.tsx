import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UserProfile, LoginRequest, RegisterCustomerRequest, RegisterTraderRequest } from '@workspace/api-client-react';
import { login as apiLogin } from '@workspace/api-client-react';
import { getApiUrl } from '@/lib/api-url';

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

  const registerCustomer = async (data: RegisterCustomerRequest): Promise<{ email: string; pollToken: string }> => {
    const base = getApiUrl();
    const res = await fetch(`${base}/api/auth/register/customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Registration failed');
    return { email: json.email as string, pollToken: json.pollToken as string };
  };

  const registerTrader = async (data: RegisterTraderRequest): Promise<{ email: string; pollToken: string }> => {
    const base = getApiUrl();
    const res = await fetch(`${base}/api/auth/register/trader`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Registration failed');
    return { email: json.email as string, pollToken: json.pollToken as string };
  };

  const resendVerification = async (email: string): Promise<void> => {
    const base = getApiUrl();
    const res = await fetch(`${base}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Failed to resend email');
  };

  const logout = async () => {
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
