import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UserProfile, LoginRequest, RegisterCustomerRequest, RegisterTraderRequest } from '@workspace/api-client-react';
import { login as apiLogin, registerCustomer as apiRegisterCustomer, registerTrader as apiRegisterTrader } from '@workspace/api-client-react';

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  isLoading: boolean;
  login: (data: LoginRequest) => Promise<void>;
  registerCustomer: (data: RegisterCustomerRequest) => Promise<void>;
  registerTrader: (data: RegisterTraderRequest) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  isTrader: boolean;
  isCustomer: boolean;
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
    const response = await apiLogin(data);
    await AsyncStorage.setItem('auth_token', response.token);
    await AsyncStorage.setItem('auth_user', JSON.stringify(response.user));
    setToken(response.token);
    setUser(response.user);
  };

  const registerCustomer = async (data: RegisterCustomerRequest) => {
    const response = await apiRegisterCustomer(data);
    await AsyncStorage.setItem('auth_token', response.token);
    await AsyncStorage.setItem('auth_user', JSON.stringify(response.user));
    setToken(response.token);
    setUser(response.user);
  };

  const registerTrader = async (data: RegisterTraderRequest) => {
    const response = await apiRegisterTrader(data);
    await AsyncStorage.setItem('auth_token', response.token);
    await AsyncStorage.setItem('auth_user', JSON.stringify(response.user));
    setToken(response.token);
    setUser(response.user);
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
        logout,
        isAuthenticated: !!user,
        isTrader: user?.role === 'trader',
        isCustomer: user?.role === 'customer',
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
