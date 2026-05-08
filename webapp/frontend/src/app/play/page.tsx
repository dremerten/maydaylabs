"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  fetchLevels,
  createSession,
  getSession,
  getProgress,
  deleteSession,
  wsUrl,
  ApiError,
  type LevelInfo,
  type SessionStatus,
} from "@/lib/api";
import LevelSelector from "@/components/LevelSelector";
import MissionCard from "@/components/MissionCard";
import MissionTerminal from "@/components/MissionTerminal";
import SessionStatusIndicator from "@/components/SessionStatus";
import CountdownTimer from "@/components/CountdownTimer";
import TerminalPanel from "@/components/TerminalPanel";
import Link from "next/link";
import type { ProgressData } from "@/lib/progress";

type UiStatus = "idle" | "provisioning" | "ready" | "expired" | "error";

const WORLDS = [
  { key: "world-1-basics",       label: "Basics"   },
  { key: "world-2-deployments",  label: "Deploy"   },
  { key: "world-3-networking",   label: "Network"  },
  { key: "world-4-storage",      label: "Storage"  },
  { key: "world-5-security",     label: "Security" },
] as const;

function ProgressPanel({ progress, levels }: { progress: ProgressData; levels: LevelInfo[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const completedSet = new Set(progress.completed_levels);
  const totalPct = Math.min(100, Math.round((progress.completed_levels.length / 50) * 100));

  return (
    <div className="border-b border-cyber-border/60 shrink-0 bg-cyber-bg/60">
      {/* Stats row — always visible */}
      <div className="flex items-center gap-3 px-4 py-2 font-mono text-xs">
        <span className="text-cyber-cyan shrink-0">⎈</span>
        <span className="text-cyber-fg font-semibold truncate">{progress.player_name}</span>
        <span className="text-cyber-border">|</span>
        <span className="text-cyber-cyan shrink-0">{progress.completed_levels.length}<span className="text-cyber-muted">/50</span></span>
        <span className="text-cyber-muted hidden sm:inline shrink-0">levels</span>
        <span className="text-cyber-border hidden sm:inline">|</span>
        <span className="text-cyber-cyan shrink-0">{progress.total_xp.toLocaleString()}<span className="text-cyber-muted"> XP</span></span>
        <div className="flex-1 min-w-0 flex items-center gap-2 ml-2">
          <div className="flex-1 h-1 bg-cyber-border rounded-full overflow-hidden hidden sm:block">
            <div
              className="h-full bg-cyber-cyan transition-all duration-700"
              style={{ width: `${totalPct}%` }}
            />
          </div>
          <span className="text-cyber-muted text-[10px] shrink-0">{totalPct}%</span>
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand progress" : "Collapse progress"}
          className="text-cyber-muted hover:text-cyber-fg transition-colors ml-1 shrink-0 text-[10px]"
        >
          {collapsed ? "▼" : "▲"}
        </button>
      </div>

      {/* World grid — collapsible */}
      {!collapsed && (
        <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-5 gap-x-4 gap-y-1.5">
          {WORLDS.map(({ key, label }) => {
            const worldLevels = levels.filter((l) => l.world === key && l.available_in_web);
            if (worldLevels.length === 0) return null;
            const doneCount = worldLevels.filter((l) => completedSet.has(l.id)).length;
            return (
              <div key={key} className="flex items-center gap-1.5">
                <span className="font-mono text-[9px] text-cyber-muted w-12 shrink-0 uppercase tracking-wide">
                  {label}
                </span>
                <div className="flex gap-px flex-wrap">
                  {worldLevels.map((l) => {
                    const done = completedSet.has(l.id);
                    const current = l.id === progress.current_level;
                    return (
                      <div
                        key={l.id}
                        title={`${l.name}${done ? " ✓" : current ? " ← current" : ""}`}
                        className={`w-2 h-3.5 rounded-[2px] transition-colors ${
                          done
                            ? "bg-cyber-cyan"
                            : current
                            ? "bg-cyber-cyan/25 ring-1 ring-cyber-cyan/60"
                            : "bg-cyber-border"
                        }`}
                      />
                    );
                  })}
                </div>
                <span className="font-mono text-[9px] text-cyber-muted shrink-0">
                  {doneCount}/{worldLevels.length}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function shellUrl(sessionId: string): string {
  return `/play/terminal?session=${sessionId}&type=shell`;
}

const SESSION_KEY = "k8squest_session_id";
const PLAYER_KEY = "k8squest_player_name";
const PROGRESS_KEY = "k8squest_progress";

export default function PlayPage() {
  const [levels, setLevels] = useState<LevelInfo[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState<string>("");
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [uiStatus, setUiStatus] = useState<UiStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isCapacityError, setIsCapacityError] = useState(false);
  const [storedProgress, setStoredProgress] = useState<ProgressData | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    document.title = "Mission Control — K8sQuest";
    fetchLevels().then(setLevels).catch(console.error);
    setPlayerName(localStorage.getItem(PLAYER_KEY) ?? "");
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (raw) setStoredProgress(JSON.parse(raw) as ProgressData);
    } catch { /* ignore */ }
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
    setIsCapacityError(false);
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

    let storedProgress: Record<string, unknown> | null = null;
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (raw) storedProgress = JSON.parse(raw);
    } catch { /* ignore corrupt data */ }

    try {
      const s = await createSession(selectedLevel, playerName, storedProgress);
      setSession(s);
      localStorage.setItem(SESSION_KEY, s.session_id);
      // Shell opens in a new tab; engine terminal is embedded in this page
      window.open(shellUrl(s.session_id), "_blank", "noopener");
    } catch (e: unknown) {
      setUiStatus("error");
      const isCapacity = e instanceof ApiError && e.status === 429;
      setIsCapacityError(isCapacity);
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

  // CountdownTimer fires this when the 15-min TTL hits zero client-side
  const handleExpired = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setUiStatus("expired");
  }, []);

  const handleDownloadProgress = useCallback(async () => {
    if (!session) return;
    try {
      const data = await getProgress(session.session_id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "progress.json";
      a.click();
      URL.revokeObjectURL(url);
      // Refresh localStorage + state so the panel updates immediately
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
      setStoredProgress(data as unknown as ProgressData);
    } catch {
      /* progress not available yet — user hasn't completed a level this session */
    }
  }, [session]);

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
        {session && uiStatus === "ready" && (
          <button
            onClick={handleDownloadProgress}
            title="Download progress.json — upload on the home page to resume next time"
            className="font-mono text-xs text-cyber-cyan border border-cyber-cyan/30 rounded px-3 py-1.5 hover:bg-cyber-cyan/10 transition-colors"
          >
            ↓ Progress
          </button>
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
        <aside className="w-[22rem] shrink-0 flex flex-col gap-4 p-4 border-r border-cyber-border overflow-y-auto">
          <div className="space-y-2">
            <label className="font-mono text-[10px] uppercase tracking-widest text-cyber-muted">
              Player Name
            </label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => {
                setPlayerName(e.target.value);
                localStorage.setItem(PLAYER_KEY, e.target.value);
              }}
              disabled={active}
              placeholder="Enter your callsign…"
              className="w-full px-3 py-2 bg-cyber-bg border border-cyber-border rounded font-mono text-xs text-cyber-fg placeholder:text-cyber-muted/50 focus:outline-none focus:border-cyber-cyan/50 disabled:opacity-40 disabled:cursor-not-allowed"
            />
          </div>

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
              isCapacityError ? (
                <div className="mt-2 p-2 border border-yellow-500/40 rounded bg-yellow-500/5 font-mono text-xs text-center text-yellow-400">
                  ⚠ High Demand — {errorMsg}
                </div>
              ) : (
                <p className="mt-2 text-cyber-red font-mono text-xs text-center">{errorMsg}</p>
              )
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

                {/* Two-terminal explainer */}
                <div className="flex items-start gap-3 px-4 py-2 border-b border-cyber-border/50 shrink-0 bg-cyber-cyan/5 font-mono text-[10px] text-cyber-muted">
                  <span className="text-cyber-cyan shrink-0">ℹ</span>
                  <span>
                    <span className="text-cyber-cyan">This tab</span> — Mission Control: game objectives, hints, and progress tracking.{" "}
                    <span className="text-cyber-violet">⚓ Helm Station</span> (opens automatically) — your <code className="text-cyber-fg">kubectl</code> shell for diagnosing and fixing the broken cluster.
                    Session expires in <span className="text-cyber-fg">15 min</span>.
                  </span>
                </div>

                {/* Progress panel */}
                {storedProgress && levels.length > 0 && (
                  <ProgressPanel progress={storedProgress} levels={levels} />
                )}

                {/* Engine terminal fills remaining space */}
                <div className="flex-1 min-h-0">
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
                className="flex-1 flex flex-col min-h-0"
              >
                {storedProgress && levels.length > 0 && (
                  <ProgressPanel progress={storedProgress} levels={levels} />
                )}
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-3">
                  {uiStatus === "expired" ? (
                    <p className="font-mono text-sm text-cyber-muted text-center">
                      Session ended. Select a level and launch a new environment.
                    </p>
                  ) : (
                    <MissionTerminal playerName={playerName} />
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
