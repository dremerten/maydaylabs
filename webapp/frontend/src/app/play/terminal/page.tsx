"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { wsUrl } from "@/lib/api";
import TerminalPanel from "@/components/TerminalPanel";
import Link from "next/link";

function TerminalView() {
  const params = useSearchParams();
  const sessionId = params.get("session") ?? "";
  const type = (params.get("type") ?? "shell") as "engine" | "shell";

  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    setEndpoint(wsUrl(sessionId, type));
  }, [sessionId, type]);

  // Only the shell tab closing ends the session — engine tab close is non-destructive.
  // keepalive ensures the DELETE reaches the backend even as the tab is closing.
  useEffect(() => {
    if (!sessionId || type !== "shell") return;
    const onUnload = () => {
      fetch(`/api/sessions/${sessionId}`, { method: "DELETE", keepalive: true });
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [sessionId, type]);

  const handleDisconnect = useCallback(() => setEnded(true), []);

  const isEngine = type === "engine";

  useEffect(() => {
    document.title = isEngine ? "Mission Control — K8sQuest" : "Helm Station — K8sQuest";
  }, [isEngine]);
  const accentColor = isEngine ? "cyan" : "teal";
  const accentHex = isEngine ? "#0096c7" : "#2ec4b6";
  const label = isEngine ? "⎈ Mission Control" : "⚓ Helm Station";

  if (!sessionId) {
    return (
      <div className="h-screen bg-black flex items-center justify-center font-mono text-red-500 text-sm">
        Missing session ID.{" "}
        <Link href="/play" className="ml-2 underline" style={{ color: accentHex }}>
          Back to Play
        </Link>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "#000000" }}>
      {/* Slim top bar */}
      <header
        className="flex items-center gap-3 px-4 py-2 border-b shrink-0"
        style={{ background: "#0a0a0a", borderColor: `${accentHex}30` }}
      >
        <div
          className="w-2 h-2 rounded-full animate-pulse-slow"
          style={{ backgroundColor: ended ? "#cc0000" : accentHex }}
        />
        <span
          className="font-mono text-xs uppercase tracking-widest"
          style={{ color: accentHex }}
        >
          {label}
        </span>
        <span className="font-mono text-[10px] text-gray-500 ml-1">
          {sessionId}
        </span>
        {ended && (
          <span className="ml-auto font-mono text-[10px] text-red-500">
            session ended — you may close this tab
          </span>
        )}
      </header>

      {/* Full-screen terminal — no inner title bar, page header handles that */}
      <div className="flex-1 min-h-0">
        <TerminalPanel
          wsUrl={endpoint}
          label={label}
          accentColor={accentColor}
          onDisconnect={handleDisconnect}
          showTitleBar={false}
        />
      </div>
    </div>
  );
}

export default function TerminalPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen bg-black flex items-center justify-center font-mono text-gray-500 text-sm animate-pulse">
          Loading terminal…
        </div>
      }
    >
      <TerminalView />
    </Suspense>
  );
}
