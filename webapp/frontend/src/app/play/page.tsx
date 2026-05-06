"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  fetchLevels,
  createSession,
  getSession,
  deleteSession,
  wsUrl,
  type LevelInfo,
  type SessionStatus,
} from "@/lib/api";
import LevelSelector from "@/components/LevelSelector";
import MissionCard from "@/components/MissionCard";
import SessionStatusIndicator from "@/components/SessionStatus";
import CountdownTimer from "@/components/CountdownTimer";
import TerminalPanel from "@/components/TerminalPanel";
import Link from "next/link";

type UiStatus = "idle" | "provisioning" | "ready" | "expired" | "error";

function shellUrl(sessionId: string): string {
  return `/play/terminal?session=${sessionId}&type=shell`;
}

const SESSION_KEY = "k8squest_session_id";

export default function PlayPage() {
  const [levels, setLevels] = useState<LevelInfo[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [uiStatus, setUiStatus] = useState<UiStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchLevels().then(setLevels).catch(console.error);
  }, []);

  // Recover session from localStorage on mount
  useEffect(() => {
    const savedId = localStorage.getItem(SESSION_KEY);
    if (!savedId) return;
    getSession(savedId)
      .then((s) => {
        if (s.status !== "expired") {
          setSession(s);
          setUiStatus(s.status === "ready" ? "ready" : "provisioning");
          setSelectedLevel(s.level);
        } else {
          localStorage.removeItem(SESSION_KEY);
        }
      })
      .catch(() => localStorage.removeItem(SESSION_KEY));
  }, []);

  // Poll for session readiness / expiry
  useEffect(() => {
    if (!session || (uiStatus !== "provisioning" && uiStatus !== "ready")) return;

    pollRef.current = setInterval(async () => {
      try {
        const s = await getSession(session.session_id);
        setSession(s);
        if (s.status === "ready" && uiStatus === "provisioning") {
          setUiStatus("ready");
        } else if (s.status === "expired") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          localStorage.removeItem(SESSION_KEY);
          setSession(null);
          setUiStatus("expired");
        }
      } catch {
        // 404 — session gone (TTL fired, explicit delete from shell tab close, etc.)
        clearInterval(pollRef.current!);
        pollRef.current = null;
        localStorage.removeItem(SESSION_KEY);
        setSession(null);
        setUiStatus("expired");
      }
    }, 3000);

    return () => {
      clearInterval(pollRef.current!);
      pollRef.current = null;
    };
  }, [session, uiStatus]);

  const handleStart = async () => {
    if (!selectedLevel) return;
    setErrorMsg(null);
    setUiStatus("provisioning");

    // Before creating a new session, explicitly delete any stale one lingering in
    // localStorage. The shell tab's keepalive DELETE is fire-and-forget and may not
    // have reached the backend yet, leaving the rate-limit counter stuck at 1.
    const staleId = localStorage.getItem(SESSION_KEY);
    if (staleId) {
      await deleteSession(staleId).catch(() => {});
      localStorage.removeItem(SESSION_KEY);
    }
    setSession(null);

    try {
      const s = await createSession(selectedLevel);
      setSession(s);
      localStorage.setItem(SESSION_KEY, s.session_id);
      // Shell opens in a new tab; engine terminal is embedded in this page
      window.open(shellUrl(s.session_id), "_blank", "noopener");
    } catch (e: unknown) {
      setUiStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Failed to create session");
    }
  };

  const handleStop = useCallback(async () => {
    if (!session) return;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    await deleteSession(session.session_id).catch(() => {});
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setUiStatus("idle");
  }, [session]);

  // CountdownTimer fires this when the 45-min TTL hits zero client-side
  const handleExpired = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setUiStatus("expired");
  }, []);

  const selectedLevelData = levels.find((l) => l.id === selectedLevel);
  const active = uiStatus === "provisioning" || uiStatus === "ready";

  return (
    <div className="relative min-h-screen bg-cyber-bg grid-bg flex flex-col">
      {/* Ambient blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-cyber-cyan/3 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-cyber-violet/3 blur-3xl" />
      </div>

      {/* Top bar */}
      <header className="relative z-10 flex items-center gap-4 px-6 py-3 border-b border-cyber-border glass shrink-0">
        <Link href="/" className="font-mono font-bold text-cyber-cyan text-sm tracking-widest hover:text-glow-cyan transition-all">
          K8SQUEST
        </Link>
        <div className="flex-1" />
        <SessionStatusIndicator status={uiStatus} message={errorMsg ?? undefined} />
        {session && (
          <CountdownTimer expiresAt={session.expires_at} onExpired={handleExpired} />
        )}
        {session && (
          <button
            onClick={handleStop}
            className="font-mono text-xs text-cyber-red border border-cyber-red/30 rounded px-3 py-1.5 hover:bg-cyber-red/10 transition-colors"
          >
            ✕ End Session
          </button>
        )}
      </header>

      {/* Main layout */}
      <div className="relative z-10 flex flex-1 overflow-hidden">

        {/* Left sidebar */}
        <aside className="w-80 shrink-0 flex flex-col gap-4 p-4 border-r border-cyber-border overflow-y-auto">
          <div className="space-y-2">
            <label className="font-mono text-[10px] uppercase tracking-widest text-cyber-muted">
              Select Level
            </label>
            <LevelSelector
              levels={levels}
              selectedId={selectedLevel}
              onChange={setSelectedLevel}
              disabled={active}
            />
          </div>

          <AnimatePresence mode="wait">
            {selectedLevelData && (
              <motion.div
                key={selectedLevelData.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <MissionCard level={selectedLevelData} />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-auto pt-2">
            {uiStatus === "idle" || uiStatus === "error" || uiStatus === "expired" ? (
              <button
                onClick={handleStart}
                disabled={!selectedLevel}
                className="w-full py-3 bg-cyber-cyan text-cyber-bg font-mono font-bold text-sm rounded-lg uppercase tracking-widest hover:bg-cyber-cyan/90 hover:shadow-cyan transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {uiStatus === "expired" ? "▶ Start New Session" : "▶ Launch Environment"}
              </button>
            ) : uiStatus === "provisioning" ? (
              <div className="w-full py-3 glass border border-cyber-cyan/20 rounded-lg text-center font-mono text-sm text-cyber-cyan animate-pulse">
                ⚙ Provisioning…
              </div>
            ) : null}

            {errorMsg && (
              <p className="mt-2 text-cyber-red font-mono text-xs text-center">{errorMsg}</p>
            )}
          </div>
        </aside>

        {/* Right panel — engine terminal once session exists, idle prompt otherwise */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <AnimatePresence mode="wait">
            {active && session ? (
              <motion.div
                key="terminal"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col h-full"
              >
                {/* Slim session bar */}
                <div className="flex items-center gap-3 px-4 py-2 border-b border-cyber-border shrink-0 font-mono text-xs text-cyber-muted">
                  <span className="text-cyber-fg truncate">{session.level}</span>
                  <span className="text-cyber-muted/50 hidden sm:inline truncate">
                    {session.session_id}
                  </span>
                  <div className="ml-auto shrink-0">
                    <a
                      href={shellUrl(session.session_id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-cyber-violet border border-cyber-violet/30 rounded px-2.5 py-1 hover:bg-cyber-violet/10 transition-colors"
                    >
                      ⚓ Helm Station ↗
                    </a>
                  </div>
                </div>

                {/* Engine terminal fills remaining space */}
                <div className="flex-1 min-h-0 p-3">
                  <TerminalPanel
                    wsUrl={wsUrl(session.session_id, "engine")}
                    label="⎈ Mission Control"
                    accentColor="cyan"
                  />
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex items-center justify-center p-8"
              >
                <p className="text-center font-mono text-sm text-cyber-muted">
                  {uiStatus === "expired"
                    ? "Session ended. Select a level and launch a new environment."
                    : "Select a level from the sidebar and click Launch Environment."}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
