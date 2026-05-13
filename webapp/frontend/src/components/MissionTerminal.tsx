"use client";

import { useEffect, useRef, useState } from "react";

const CMD = "kubectl describe pod mission-briefing -n k8squest";

function buildLines(playerName: string): { text: string; color: string }[] {
  const name = playerName.trim();
  return [
  { text: "", color: "" },
  { text: "────────────────────────────────────────────────────────", color: "text-cyber-cyan/40" },
  { text: "  ⚡  INCOMING TRANSMISSION — MAYDAYLABS MISSION CONTROL  ⚡", color: "text-cyber-cyan" },
  { text: "────────────────────────────────────────────────────────", color: "text-cyber-cyan/40" },
  { text: " ", color: "" },
  { text: `  Your mission${name ? `, ${name}` : ""}, should you choose to accept it:`, color: "text-cyber-fg/90" },
  { text: " ", color: "" },
  { text: "  ⎈  This tab is Mission Control.", color: "text-cyber-cyan" },
  { text: "     Objectives, hints, and progress tracking live here.", color: "text-gray-400" },
  { text: " ", color: "" },
  { text: "  ⚓  A second tab will open — your Helm Station.", color: "text-cyber-violet" },
  { text: "     That's your kubectl shell. Use it to diagnose and", color: "text-gray-400" },
  { text: "     fix the broken cluster.", color: "text-gray-400" },
  { text: " ", color: "" },
  { text: "  ⎈  Each tab opens a UNIQUE k8s namespace sandbox.", color: "text-cyber-violet" },
  { text: "     Closing either tab TERMINATES the namespace.", color: "text-cyber-red/80" },
  { text: " ", color: "" },
  { text: "  💡  k9s is pre-installed in your Helm Station.", color: "text-cyber-cyan" },
  { text: "     TIP: Duplicate the shell tab — use one for kubectl", color: "text-gray-400" },
  { text: "     commands and one for k9s. Both share the same", color: "text-gray-400" },
  { text: "     namespace, but closing EITHER tab ends the session.", color: "text-cyber-red/80" },
  { text: " ", color: "" },
  { text: "  MISSION PARAMETERS:", color: "text-cyber-fg/60" },
  { text: "    Session TTL .............. 15 minutes", color: "text-gray-400" },
  { text: "    Max concurrent ops ...... 20 operators", color: "text-gray-400" },
  { text: "    Hints available ......... 3 per level", color: "text-gray-400" },
  { text: "    XP on completion ........ varies by level", color: "text-gray-400" },
  { text: " ", color: "" },
  { text: "  Select a level from the sidebar.", color: "text-cyber-fg" },
  { text: "  Click  ▶ Launch Environment  to begin.", color: "text-cyber-fg" },
  { text: " ", color: "" },
  { text: `  Good luck, ${name || "operator"}. The cluster is counting on you.`, color: "text-cyber-cyan/80" },
  { text: " ", color: "" },
  { text: "────────────────────────────────────────────────────────", color: "text-cyber-cyan/40" },
  ];
}

export default function MissionTerminal({ playerName = "" }: { playerName?: string }) {
  const [typedCmd, setTypedCmd] = useState("");
  const [cmdDone, setCmdDone] = useState(false);
  const [visibleLines, setVisibleLines] = useState<ReturnType<typeof buildLines>>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const playerNameRef = useRef(playerName);
  playerNameRef.current = playerName;
  const lines = buildLines(playerName);

  useEffect(() => {
    let ci = 0;
    const typeTimer = setInterval(() => {
      ci++;
      setTypedCmd(CMD.slice(0, ci));
      if (ci >= CMD.length) {
        clearInterval(typeTimer);
        const t = setTimeout(() => {
          setCmdDone(true);
          // Build lines here so playerNameRef.current is fresh (localStorage loads async)
          const resolved = buildLines(playerNameRef.current);
          resolved.forEach((line, i) => {
            const id = setTimeout(() => {
              setVisibleLines((prev) => [...prev, line]);
            }, i * 60);
            timersRef.current.push(id);
          });
        }, 400);
        timersRef.current.push(t);
      }
    }, 38);

    return () => {
      clearInterval(typeTimer);
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleLines]);

  return (
    <div className="w-full h-full flex flex-col rounded-xl overflow-hidden border border-cyber-border/60 bg-[#050f1a] shadow-[0_0_40px_rgba(0,150,199,0.08)]">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-cyber-surface border-b border-cyber-border/50 shrink-0">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <div className="w-3 h-3 rounded-full bg-green-500/80" />
        </div>
        <span className="ml-2 font-mono text-[13px] text-cyber-muted">kubectl — mission-control</span>
      </div>

      <div className="p-4 font-mono text-[11px] leading-relaxed flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {/* prompt + typed command */}
        <div className="flex flex-wrap mb-1">
          <span className="text-cyber-cyan shrink-0">operator@k8squest</span>
          <span className="text-cyber-fg/50 shrink-0">:</span>
          <span className="text-cyber-violet shrink-0">~</span>
          <span className="text-cyber-fg/50 shrink-0">$ </span>
          <span className="text-cyber-fg">{typedCmd}</span>
          {!cmdDone && (
            <span className="inline-block w-[7px] h-[13px] bg-cyber-cyan ml-0.5 animate-pulse" />
          )}
        </div>

        {/* mission content lines */}
        {visibleLines.map((line, i) => (
          <div key={i} className={`whitespace-pre ${line.color}`}>{line.text}</div>
        ))}

        {/* blinking cursor once all lines are shown */}
        {visibleLines.length === lines.length && (
          <div className="flex mt-1">
            <span className="text-cyber-cyan">operator@k8squest</span>
            <span className="text-cyber-fg/50">:</span>
            <span className="text-cyber-violet">~</span>
            <span className="text-cyber-fg/50">$ </span>
            <span className="inline-block w-[7px] h-[13px] bg-cyber-cyan ml-0.5 animate-pulse" />
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
