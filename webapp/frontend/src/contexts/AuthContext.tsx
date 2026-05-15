"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { ProgressData } from "@/lib/progress";

interface User {
  sub: string;
  email: string;
  name: string;
  picture: string;
}

interface AuthContextValue {
  user: User | null;
  progress: ProgressData | null;
  loading: boolean;
  refreshAuth: () => Promise<void>;
  signOut: () => Promise<void>;
  clearProgress: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshAuth = async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/auth/me`,
        { credentials: "include" }
      );
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setProgress(data.progress ?? null);
      } else {
        setUser(null);
        setProgress(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    setUser(null);
    setProgress(null);
    window.location.href = "/";
  };

  const clearProgress = async () => {
    // Called when user confirms "New Journey" — wipes saved progress
    // Progress in Redis is overwritten on next checkpoint; set local state to null now
    setProgress(null);
  };

  useEffect(() => { refreshAuth(); }, []);

  return (
    <AuthContext.Provider value={{ user, progress, loading, refreshAuth, signOut, clearProgress }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
