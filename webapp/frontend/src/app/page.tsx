"use client";

import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getSession, deleteSession, type SessionStatus } from "@/lib/api";
import CountdownTimer from "@/components/CountdownTimer";

const SESSION_KEY = "k8squest_session_id";

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
  { icon: "⚓", title: "Fully Isolated", desc: "Your own namespace, auto-cleaned after 45 minutes" },
  { icon: "🧭", title: "Learn by Doing", desc: "Hint system + deep debriefs after every level" },
  { icon: "🌊", title: "Zero Setup", desc: "No install needed — runs entirely in your browser" },
];

function ActiveSessionBanner() {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedId = localStorage.getItem(SESSION_KEY);
    if (!savedId) {
      setLoading(false);
      return;
    }
    getSession(savedId)
      .then((s) => {
        if (s.status !== "expired") {
          setSession(s);
        } else {
          localStorage.removeItem(SESSION_KEY);
        }
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
            <p className="font-mono text-[10px] uppercase tracking-widest text-cyber-muted mb-0.5">
              Active Session
            </p>
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

export default function HomePage() {
  return (
    <main className="relative min-h-screen grid-bg flex flex-col items-center justify-center px-4 overflow-hidden">
      {/* Deep ocean radial glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-[32rem] h-[32rem] rounded-full bg-cyber-cyan/5 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[32rem] h-[32rem] rounded-full bg-cyber-violet/4 blur-3xl" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/20 to-transparent" />
      </div>

      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="text-center mb-12"
      >
        <pre className="text-cyber-cyan text-glow-cyan text-[6px] sm:text-[8px] md:text-[10px] font-mono leading-tight select-none">
          {LOGO}
        </pre>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="mt-4 text-cyber-muted font-mono text-sm tracking-widest uppercase"
        >
          ⎈ &nbsp; Navigate the Cluster. Master the Helm. &nbsp; ⎈
        </motion.p>
      </motion.div>

      {/* Feature grid */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.6 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12 max-w-4xl w-full"
      >
        {FEATURES.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 + i * 0.1 }}
            className="glass rounded-xl p-4 text-center"
          >
            <div className="text-2xl mb-2">{f.icon}</div>
            <div className="text-cyber-cyan font-mono text-xs font-semibold mb-1">{f.title}</div>
            <div className="text-cyber-muted text-xs">{f.desc}</div>
          </motion.div>
        ))}
      </motion.div>

      {/* Active session banner */}
      <ActiveSessionBanner />

      {/* CTA */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1.1, duration: 0.4 }}
        className="flex gap-4"
      >
        <Link
          href="/play"
          className="relative group px-8 py-4 bg-cyber-cyan text-cyber-bg font-mono font-bold text-sm rounded-lg uppercase tracking-widest transition-all duration-200 hover:bg-cyber-cyan/90 hover:shadow-cyan"
        >
          <span className="relative z-10">⎈ All Hands on Deck</span>
        </Link>
        <a
          href="https://github.com/your-org/k8squest"
          target="_blank"
          rel="noopener noreferrer"
          className="px-8 py-4 glass border border-cyber-cyan/20 font-mono font-bold text-sm rounded-lg uppercase tracking-widest text-cyber-cyan transition-all hover:border-cyber-cyan/50 hover:glow-cyan"
        >
          GitHub ↗
        </a>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4 }}
        className="mt-8 text-cyber-muted font-mono text-xs"
      >
        Sessions auto-expire after 45 minutes · No account required
      </motion.p>
    </main>
  );
}
