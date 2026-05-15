"use client";

import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, deleteSession, type SessionStatus } from "@/lib/api";
import CountdownTimer from "@/components/CountdownTimer";
import { useAuth } from "@/contexts/AuthContext";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import UserChip from "@/components/UserChip";
import ConfirmModal from "@/components/ConfirmModal";
import type { ProgressData } from "@/lib/progress";

const SESSION_KEY = "k8squest_session_id";
const PLAYER_KEY = "k8squest_player_name";
const PROGRESS_KEY = "k8squest_progress";

const LOGO = `
██╗  ██╗ █████╗ ███████╗ ██████╗ ██╗   ██╗███████╗███████╗████████╗
██║ ██╔╝██╔══██╗██╔════╝██╔═══██╗██║   ██║██╔════╝██╔════╝╚══██╔══╝
█████╔╝ ╚█████╔╝███████╗██║   ██║██║   ██║█████╗  ███████╗   ██║
██╔═██╗ ██╔══██╗╚════██║██║▄▄ ██║██║   ██║██╔══╝  ╚════██║   ██║
██║  ██╗╚█████╔╝███████║╚██████╔╝╚██████╔╝███████╗███████║   ██║
╚═╝  ╚═╝ ╚════╝ ╚══════╝ ╚══▀▀═╝  ╚═════╝ ╚══════╝╚══════╝   ╚═╝
`.trim();

const FEATURES = [
  { icon: "⎈", title: "50 Live Challenges", desc: "Real Kubernetes clusters, real kubectl commands" },
  { icon: "⚓", title: "Fully Isolated", desc: "Your own namespace, auto-cleaned after 15 minutes" },
  { icon: "🧭", title: "Learn by Doing", desc: "Hint system + deep debriefs after every level" },
  { icon: "🌊", title: "Zero Setup", desc: "No install needed — runs entirely in your browser" },
];

type FlowState = "choose" | "new" | "resume";

function ActiveSessionBanner() {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedId = localStorage.getItem(SESSION_KEY);
    if (!savedId) { setLoading(false); return; }
    getSession(savedId)
      .then((s) => {
        if (s.status !== "expired") setSession(s);
        else localStorage.removeItem(SESSION_KEY);
      })
      .catch(() => localStorage.removeItem(SESSION_KEY))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = useCallback(async () => {
    if (!session) return;
    await deleteSession(session.session_id).catch(() => {});
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  }, [session]);

  const handleExpired = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  }, []);

  if (loading || !session) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="session-banner"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.25 }}
        className="mb-8 w-full max-w-lg"
      >
        <div className="glass border border-cyber-cyan/25 rounded-xl px-5 py-3 flex items-center gap-4">
          <div className="w-2 h-2 rounded-full bg-cyber-cyan animate-pulse shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-widest text-cyber-muted mb-0.5">Active Session</p>
            <p className="font-mono text-xs text-cyber-fg truncate">
              {session.level}
              <span className="text-cyber-muted ml-2">{session.session_id}</span>
            </p>
          </div>
          <CountdownTimer expiresAt={session.expires_at} onExpired={handleExpired} />
          <Link
            href="/play"
            className="font-mono text-xs text-cyber-cyan border border-cyber-cyan/30 rounded px-2.5 py-1 hover:bg-cyber-cyan/10 transition-colors shrink-0"
          >
            Resume
          </Link>
          <button
            onClick={handleDelete}
            aria-label="End session"
            className="font-mono text-xs text-cyber-red border border-cyber-red/30 rounded px-2.5 py-1 hover:bg-cyber-red/10 transition-colors shrink-0"
          >
            ✕
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function ProgressStats({ progress }: { progress: ProgressData }) {
  const pct = Math.round((progress.completed_levels.length / 50) * 100);
  const bar = Math.round(pct / 5);
  return (
    <div className="glass border border-cyber-violet/30 rounded-xl p-4 space-y-2 text-left w-full">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1.5 h-1.5 rounded-full bg-cyber-violet" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-cyber-muted">Loaded Progress</span>
      </div>
      <div className="flex justify-between font-mono text-xs">
        <span className="text-cyber-muted">Callsign</span>
        <span className="text-cyber-fg">{progress.player_name}</span>
      </div>
      <div className="flex justify-between font-mono text-xs">
        <span className="text-cyber-muted">Levels cleared</span>
        <span className="text-cyber-cyan">{progress.completed_levels.length}/50</span>
      </div>
      <div className="flex justify-between font-mono text-xs">
        <span className="text-cyber-muted">Total XP</span>
        <span className="text-cyber-cyan">{progress.total_xp.toLocaleString()}</span>
      </div>
      <div className="pt-1">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-cyber-border rounded-full overflow-hidden">
            <div
              className="h-full bg-cyber-cyan transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="font-mono text-[10px] text-cyber-muted shrink-0">{pct}%</span>
        </div>
        <p className="font-mono text-[9px] text-cyber-muted/50 mt-1">
          {"█".repeat(bar)}{"░".repeat(20 - bar)}
        </p>
      </div>
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { user, progress, loading, clearProgress } = useAuth();
  const [flowState, setFlowState] = useState<FlowState>("choose");
  const [callsign, setCallsign] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => {
    const savedName = localStorage.getItem(PLAYER_KEY);
    if (savedName) setCallsign(savedName);
  }, []);

  // Seed callsign from Google name when user loads
  useEffect(() => {
    if (user && !callsign) {
      setCallsign(user.name.split(" ")[0]);
    }
  }, [user, callsign]);

  // Auto-switch to resume state if progress exists
  useEffect(() => {
    if (progress) {
      setFlowState("resume");
    }
  }, [progress]);

  const handleNewMission = () => {
    if (progress) {
      setShowResetConfirm(true);
    } else {
      setFlowState("new");
    }
  };

  const handleConfirmReset = async () => {
    setShowResetConfirm(false);
    await clearProgress();
    setFlowState("new");
  };

  const handleResume = () => {
    setFlowState("resume");
  };

  const handleBegin = () => {
    const name = callsign.trim() || "Explorer";
    localStorage.setItem(PLAYER_KEY, name);
    localStorage.removeItem(PROGRESS_KEY);
    router.push("/play");
  };

  const handleContinue = () => {
    if (!progress) return;
    localStorage.setItem(PLAYER_KEY, progress.player_name);
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    router.push("/play");
  };

  return (
    <main className="relative min-h-screen grid-bg flex flex-col items-center justify-center px-4 overflow-hidden">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-[32rem] h-[32rem] rounded-full bg-cyber-cyan/5 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[32rem] h-[32rem] rounded-full bg-cyber-violet/4 blur-3xl" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/20 to-transparent" />
      </div>

      {/* User chip — top right */}
      <div className="fixed top-4 right-4 z-40">
        <UserChip />
      </div>

      {/* Confirm reset modal */}
      {showResetConfirm && progress && (
        <ConfirmModal
          title="Start New Journey?"
          message={`Starting a new journey will erase your ${progress.completed_levels.length} completed levels and ${progress.total_xp} XP. Are you sure?`}
          confirmLabel="Reset & Start Fresh"
          onConfirm={handleConfirmReset}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}

      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="text-center mb-10"
      >
        {/* "Maydaylabs presents" label */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.5 }}
          className="mb-4 font-mono text-base sm:text-lg uppercase tracking-[0.3em] text-cyber-muted/80 font-semibold"
        >
          Maydaylabs presents
        </motion.p>

        {/* Game title */}
        <pre className="text-cyber-cyan text-glow-cyan text-[6px] sm:text-[8px] md:text-[10px] font-mono leading-tight select-none">
          {LOGO}
        </pre>

        {/* Tagline */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="mt-4 mb-6 text-cyber-muted font-mono text-xs sm:text-sm tracking-wide max-w-md mx-auto"
        >
          Real life practical labs for solving production Kubernetes issues.{" "}
          <span className="neon-flicker font-semibold">Learn by Doing.</span>
        </motion.p>

        {/* Maydaylabs logo image */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.7 }}
          className="flex justify-center mb-0"
        >
          <Image
            src="/maydaylabs.png"
            alt="Maydaylabs"
            width={660}
            height={352}
            className="w-full max-w-[660px] h-auto heartbeat"
            priority
          />
        </motion.div>

        {/* Feature list — tight under circuit board */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.5 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto mt-3"
        >
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.75 + i * 0.07 }}
              className="flex flex-col items-center text-center gap-1.5"
            >
              <span className="text-xl">{f.icon}</span>
              <span className="text-cyber-cyan font-mono text-[11px] font-semibold">{f.title}</span>
              <span className="text-cyber-muted text-[10px] leading-relaxed">{f.desc}</span>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>

      {/* Active session banner */}
      <ActiveSessionBanner />

      {/* Mission flow */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1.0, duration: 0.4 }}
        className="w-full max-w-lg"
      >
        {/* Auth loading */}
        {loading && (
          <div className="flex justify-center py-8">
            <div className="font-mono text-xs text-cyber-muted animate-pulse">Loading…</div>
          </div>
        )}

        {/* Not authenticated — show sign-in button */}
        {!loading && !user && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="font-mono text-sm text-cyber-muted">Sign in to start your journey</p>
            <GoogleSignInButton />
          </div>
        )}

        {/* Authenticated — show mission flow */}
        {!loading && user && (
          <AnimatePresence mode="wait">

            {/* Choose path */}
            {flowState === "choose" && (
              <motion.div
                key="choose"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="grid grid-cols-2 gap-4"
              >
                {/* New Journey — red alarm pulse */}
                <button
                  onClick={handleNewMission}
                  className="alarm-pulse relative overflow-hidden rounded-xl p-6 text-center bg-cyber-red/10 border-2 border-cyber-red/70 hover:bg-cyber-red/20 transition-colors"
                >
                  <div className="text-3xl mb-3">⎈</div>
                  <div className="font-mono text-sm font-bold text-cyber-red mb-1 tracking-wide">New Journey</div>
                  <div className="font-mono text-[11px] text-cyber-fg/60">Set your callsign and start from level 1</div>
                </button>

                {/* Resume Journey — white halo sparkle */}
                <button
                  onClick={handleResume}
                  className="halo-glow relative overflow-hidden rounded-xl p-6 text-center glass border border-white/20 hover:bg-white/5 transition-colors"
                >
                  <span className="sparkle-1" style={{ top: '10%', right: '15%' }}>✦</span>
                  <span className="sparkle-2" style={{ top: '60%', right: '8%' }}>✧</span>
                  <span className="sparkle-3" style={{ top: '25%', right: '30%' }}>✦</span>
                  <div className="text-3xl mb-3">⚓</div>
                  <div className="font-mono text-sm font-bold text-white/90 mb-1 tracking-wide">Resume Journey</div>
                  <div className="font-mono text-[11px] text-cyber-muted">Continue from your saved progress</div>
                </button>
              </motion.div>
            )}

            {/* New mission — callsign entry */}
            {flowState === "new" && (
              <motion.div
                key="new"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="glass border border-cyber-cyan/25 rounded-xl p-6 space-y-4"
              >
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-cyber-muted mb-3">New Mission — Set Your Callsign</p>
                  <input
                    type="text"
                    value={callsign}
                    onChange={(e) => setCallsign(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleBegin()}
                    placeholder="e.g. Alpha, Kube-Rookie, Helm-Star…"
                    maxLength={30}
                    className="w-full px-3 py-2.5 bg-cyber-bg border border-cyber-border rounded font-mono text-sm text-cyber-fg placeholder:text-cyber-muted/40 focus:outline-none focus:border-cyber-cyan/50"
                    autoFocus
                  />
                </div>
                <button
                  onClick={handleBegin}
                  className="w-full py-3 bg-cyber-cyan text-cyber-bg font-mono font-bold text-sm rounded-lg uppercase tracking-widest hover:bg-cyber-cyan/90 hover:shadow-cyan transition-all"
                >
                  ▶ Begin Mission
                </button>
                <button
                  onClick={() => setFlowState("choose")}
                  className="w-full font-mono text-xs text-cyber-muted hover:text-cyber-fg transition-colors"
                >
                  ← Back
                </button>
              </motion.div>
            )}

            {/* Resume journey — show stats from AuthContext */}
            {flowState === "resume" && (
              <motion.div
                key="resume"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="glass border border-cyber-violet/25 rounded-xl p-6 space-y-4"
              >
                <p className="font-mono text-[10px] uppercase tracking-widest text-cyber-muted">Resume Journey</p>

                {progress ? (
                  <>
                    <ProgressStats progress={progress} />
                    <button
                      onClick={handleContinue}
                      className="w-full py-3 bg-cyber-violet text-cyber-bg font-mono font-bold text-sm rounded-lg uppercase tracking-widest hover:bg-cyber-violet/90 transition-all"
                    >
                      ⚓ Continue Journey
                    </button>
                  </>
                ) : (
                  <p className="font-mono text-sm text-cyber-muted text-center py-4">
                    No saved progress yet. Complete a level to save your progress.
                  </p>
                )}

                <button
                  onClick={() => setFlowState("choose")}
                  className="w-full font-mono text-xs text-cyber-muted hover:text-cyber-fg transition-colors"
                >
                  ← Back
                </button>
              </motion.div>
            )}

          </AnimatePresence>
        )}
      </motion.div>

      {/* Footer */}
      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.3 }}
        className="mt-10 pb-8 flex flex-col items-center gap-2 text-center"
      >
        <p className="font-mono text-[11px] text-cyber-muted/70">
          Web version implementation designed and created by Andreas Merten · 2026
        </p>
        <div className="flex items-center gap-2 font-mono text-[11px] text-cyber-muted/50">
          <span>k8squest originally created by</span>
          <a
            href="https://github.com/dremerten/k8squest"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-cyber-border/60 text-cyber-muted hover:text-cyber-fg hover:border-cyber-cyan/40 hover:bg-cyber-cyan/5 transition-all"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            dremerten/k8squest
          </a>
        </div>
      </motion.footer>
    </main>
  );
}
