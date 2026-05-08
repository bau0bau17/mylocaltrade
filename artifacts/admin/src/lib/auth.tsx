import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";

export interface AdminUser {
  id: number;
  email: string;
  fullName: string;
  role: "customer" | "trader" | "admin";
  isActive: boolean;
  createdAt: string;
}

interface AuthContextValue {
  user: AdminUser | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState<boolean>(!!getToken());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
    };
    window.addEventListener("mlt-admin:unauthorized", onUnauthorized);
    return () => window.removeEventListener("mlt-admin:unauthorized", onUnauthorized);
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    api<AdminUser>("/api/auth/me")
      .then((u) => {
        if (cancelled) return;
        if (u.role !== "admin") {
          setToken(null);
          setError("This account does not have admin access.");
          setUser(null);
        } else {
          setUser(u);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setToken(null);
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    const result = await api<{ token: string; user: AdminUser }>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    if (result.user.role !== "admin") {
      throw new Error("This account does not have admin access.");
    }
    setToken(result.token);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, error, login, logout }),
    [user, loading, error, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
