"use client";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

export default function UserChip() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!user) return null;

  const firstName = user.name.split(" ")[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-white/10 transition-colors"
      >
        <img src={user.picture} alt={firstName} className="w-7 h-7 rounded-full" />
        <span className="font-mono text-sm text-cyber-text">{firstName}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-36 bg-cyber-surface border border-cyber-border rounded-lg shadow-lg z-50">
          <button
            onClick={signOut}
            className="w-full text-left px-4 py-2 text-sm font-mono text-cyber-text hover:bg-white/10 rounded-lg"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
