import { useState, useCallback, useEffect } from "react";
import { type UserRole } from "@/lib/authConfig";
import { apiClient } from "@/services/apiClient";

interface AuthState {
  isAuthenticated: boolean;
  role: UserRole | null;
  name: string | null;
  email: string | null;
}

function getStorage(): Storage {
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
      const res = await apiClient.post("/auth/login", { email, password });
      const { user } = res.data;
      const s = rememberMe ? localStorage : sessionStorage;
      // Clear both first
      localStorage.removeItem("isAuthenticated");
      localStorage.removeItem("role");
      localStorage.removeItem("name");
      localStorage.removeItem("email");
      sessionStorage.removeItem("isAuthenticated");
      sessionStorage.removeItem("role");
      sessionStorage.removeItem("name");
      sessionStorage.removeItem("email");
      // Set in chosen storage
      s.setItem("isAuthenticated", "true");
      s.setItem("role", user.role);
      s.setItem("name", user.name);
      s.setItem("email", user.email);
      setAuth({ isAuthenticated: true, role: user.role as UserRole, name: user.name, email: user.email });
      return null;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Invalid email or password";
      return msg;
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("isAuthenticated");
    localStorage.removeItem("role");
    localStorage.removeItem("name");
    localStorage.removeItem("email");
    sessionStorage.removeItem("isAuthenticated");
    sessionStorage.removeItem("role");
    sessionStorage.removeItem("name");
    sessionStorage.removeItem("email");
    setAuth({ isAuthenticated: false, role: null, name: null, email: null });
  }, []);

  return { ...auth, login, logout };
}
