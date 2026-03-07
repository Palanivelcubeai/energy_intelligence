import { useState, useCallback, useEffect } from "react";
import { type UserRole } from "@/lib/authConfig";
import { apiClient } from "@/services/apiClient";

interface AuthState {
  isAuthenticated: boolean;
  role: UserRole | null;
  name: string | null;
  email: string | null;
}

const AUTH_KEYS = ["isAuthenticated", "role", "name", "email", "token"] as const;

function getStorage(): Storage {
  // If localStorage has auth, use it (remember me was on)
  if (localStorage.getItem("isAuthenticated") === "true") return localStorage;
  if (sessionStorage.getItem("isAuthenticated") === "true") return sessionStorage;
  return localStorage;
}

function loadAuth(): AuthState {
  if (typeof window === "undefined") return { isAuthenticated: false, role: null, name: null, email: null };
  const s = getStorage();
  return {
    isAuthenticated: s.getItem("isAuthenticated") === "true",
    role: s.getItem("role") as UserRole | null,
    name: s.getItem("name"),
    email: s.getItem("email"),
  };
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>(loadAuth);

  useEffect(() => {
    const handler = () => setAuth(loadAuth());
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const login = useCallback(async (email: string, password: string, rememberMe: boolean = true): Promise<string | null> => {
    try {
      const response = await apiClient.post("/auth/login", { email, password });
      const { token, user } = response.data;

      const s = rememberMe ? localStorage : sessionStorage;
      // Clear both storages first
      AUTH_KEYS.forEach((k) => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      });
      // Normalize role to lowercase to match roleAccess keys
      const role = (user.role as string).toLowerCase() as UserRole;
      s.setItem("isAuthenticated", "true");
      s.setItem("role", role);
      s.setItem("name", user.name);
      s.setItem("email", user.email);
      s.setItem("token", token);
      setAuth({ isAuthenticated: true, role, name: user.name, email: user.email });
      return null;
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      return axiosErr.response?.data?.error || "Invalid email or password";
    }
  }, []);

  const logout = useCallback(() => {
    AUTH_KEYS.forEach((k) => {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
    setAuth({ isAuthenticated: false, role: null, name: null, email: null });
  }, []);

  return { ...auth, login, logout };
}
