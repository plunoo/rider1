import React, { createContext, useContext, useMemo, useState } from "react";
import { api } from "../api/client";

type Role = "admin" | "rider" | "captain";
type User = { id: string; name: string; role: Role; store?: string | null };

type AuthState = {
  user: User | null;
  token: string | null;
  login: (username: string, password: string, coords?: { lat: number; lng: number }) => Promise<User>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem("user");
    return raw ? (JSON.parse(raw) as User) : null;
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));

  const login = async (username: string, password: string, coords?: { lat: number; lng: number }) => {
    const normalizedUsername = username.trim();
    // BACKEND EXPECTATION (you can match this in FastAPI):
    // POST /auth/login -> { token, user: {id,name,role,store?} }
    const payload: { username: string; password: string; lat?: number; lng?: number } = {
      username: normalizedUsername,
      password,
    };
    if (coords) {
      payload.lat = coords.lat;
      payload.lng = coords.lng;
    }
    const res = await api.post("/auth/login", payload);
    const { token: t, user: u } = res.data as { token: string; user: User };

    localStorage.setItem("token", t);
    localStorage.setItem("user", JSON.stringify(u));
    setToken(t);
    setUser(u);
    return u;
  };

  const logout = () => {
    api.post("/auth/logout").catch(() => undefined);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
  };

  const value = useMemo(() => ({ user, token, login, logout }), [user, token]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
