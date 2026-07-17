import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  UserProfile,
  LoginRequest,
  RegisterCustomerRequest,
  RegisterTraderRequest,
} from '@workspace/api-client-react';
import {
  setUnauthorizedHandler,
  getMe as apiGetMe,
  ApiError,
  login as apiLogin,
  registerCustomer as apiRegisterCustomer,
  registerTrader as apiRegisterTrader,
  resendVerificationEmail as apiResendVerificationEmail,
  verifyEmailCode as apiVerifyEmailCode,
  forgotPassword as apiForgotPassword,
  resetPassword as apiResetPassword,
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
  /**
   * Verify an email address with the 6-digit code from the verification email.
   * On success the server returns a full session, so the user is signed in
   * immediately (no bounce out to the browser). Returns the signed-in profile
   * so callers can route by role.
   */
  verifyEmailCode: (email: string, code: string) => Promise<UserProfile>;
  /**
   * Request a 6-digit password reset code by email. Always resolves (the
   * server responds generically whether or not the email is registered).
   */
  forgotPassword: (email: string) => Promise<void>;
  /**
   * Complete a password reset with the 6-digit code and a new password. On
   * success the server returns a full session, so the user is signed in
   * immediately. Returns the signed-in profile so callers can route by role.
   */
  resetPassword: (email: string, code: string, newPassword: string) => Promise<UserProfile>;
  logout: () => Promise<void>;
  /**
   * Swap the active bearer token (and optionally the cached user) without
   * a logout/login round-trip. Used by the GDPR account-deletion flow:
   * after a successful deletion request the server bumps `tokenVersion`
   * (revoking every other device) and returns a fresh JWT bound to the
   * new version so this device stays signed in and can reach the cancel
   * route.
   */
  applyToken: (token: string, user?: UserProfile) => Promise<void>;
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
  // Mirror of `token` readable from long-lived listeners registered once.
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;
  // Token-rotation guard: while a rotation (applyToken) is committing, an
  // in-flight request that left with the OLD token can come back 401. That
  // 401 is expected and must not sign this device out.
  const suppressUnauthorizedUntilRef = useRef(0);

  // Clear local auth state without the server round-trips of a normal
  // logout. Used when the server has already killed the session (401):
  // the push-token unregister call would itself 401, so skip it.
  const forceLogout = async () => {
    try {
      await AsyncStorage.removeItem('auth_token');
      await AsyncStorage.removeItem('auth_user');
    } catch {
      // Storage failures must not stop the in-memory sign-out.
    }
    setToken(null);
    setUser(null);
  };

  useEffect(() => {
    // Any API call that carries our session token and comes back 401 means
    // the session is dead server-side (account deleted/anonymised by an
    // admin, sessions revoked, token expired). Sign this device out
    // immediately instead of leaving a ghost session on screen.
    setUnauthorizedHandler(() => {
      if (Date.now() < suppressUnauthorizedUntilRef.current) return;
      void forceLogout();
    });
    loadStoredAuth();
    // Re-validate the session whenever the app comes back to the foreground,
    // so a device left open on a deleted account signs out without needing
    // the user to tap anything that fires an API call.
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !tokenRef.current) return;
      void (async () => {
        try {
          const fresh = await apiGetMe();
          await AsyncStorage.setItem('auth_user', JSON.stringify(fresh));
          setUser(fresh);
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            await forceLogout();
          }
          // Ignore network/server errors — keep the cached session.
        }
      })();
    });
    return () => {
      setUnauthorizedHandler(null);
      sub.remove();
    };
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
        // Validate the stored session against the server in the background.
        // If the account was deleted or the session revoked while the app
        // was closed, this is what signs the device out on next open.
        void (async () => {
          try {
            const fresh = await apiGetMe();
            await AsyncStorage.setItem('auth_user', JSON.stringify(fresh));
            setUser(fresh);
          } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
              await forceLogout();
            }
            // Network errors / 5xx: keep the cached session; the global
            // 401 handler will catch a genuinely dead session later.
          }
        })();
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

  const verifyEmailCode = async (email: string, code: string): Promise<UserProfile> => {
    try {
      const response = await apiVerifyEmailCode({ email, code });
      await AsyncStorage.setItem('auth_token', response.token);
      await AsyncStorage.setItem('auth_user', JSON.stringify(response.user));
      setToken(response.token);
      setUser(response.user);
      void registerForPushNotificationsAsync();
      return response.user;
    } catch (err) {
      throw extractApiError(err, 'Verification failed');
    }
  };

  const forgotPassword = async (email: string): Promise<void> => {
    try {
      await apiForgotPassword({ email });
    } catch (err) {
      throw extractApiError(err, 'Could not send reset code');
    }
  };

  const resetPassword = async (
    email: string,
    code: string,
    newPassword: string,
  ): Promise<UserProfile> => {
    try {
      const response = await apiResetPassword({ email, code, newPassword });
      await AsyncStorage.setItem('auth_token', response.token);
      await AsyncStorage.setItem('auth_user', JSON.stringify(response.user));
      setToken(response.token);
      setUser(response.user);
      void registerForPushNotificationsAsync();
      return response.user;
    } catch (err) {
      throw extractApiError(err, 'Password reset failed');
    }
  };

  const applyToken = async (newToken: string, newUser?: UserProfile) => {
    // Requests already in flight with the old (now-revoked) token may 401
    // while we persist the new one; ignore those for a short window.
    suppressUnauthorizedUntilRef.current = Date.now() + 10_000;
    await AsyncStorage.setItem('auth_token', newToken);
    setToken(newToken);
    if (newUser) {
      await AsyncStorage.setItem('auth_user', JSON.stringify(newUser));
      setUser(newUser);
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
        verifyEmailCode,
        forgotPassword,
        resetPassword,
        logout,
        applyToken,
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
