"use client";

import { useMemo, useState } from "react";
import type { LevelInfo } from "@/lib/api";

const DIFFICULTY_ORDER = ["beginner", "intermediate", "advanced", "expert"];

function DifficultyBadge({ difficulty }: { difficulty: string }) {
  return (
    <span className={`badge-${difficulty} border rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider`}>
      {difficulty}
    </span>
  );
}

interface Props {
  levels: LevelInfo[];
  selectedId: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
}

export default function LevelSelector({ levels, selectedId, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const grouped = useMemo(() => {
    const map = new Map<string, LevelInfo[]>();
    for (const l of levels) {
      const key = `World ${l.world_number}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    }
    return map;
  }, [levels]);

  const filtered = useMemo(() => {
    if (!filter) return grouped;
    const q = filter.toLowerCase();
    const out = new Map<string, LevelInfo[]>();
    for (const [world, ls] of grouped) {
      const matching = ls.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.concepts.some((c) => c.toLowerCase().includes(q)) ||
          l.difficulty.includes(q)
      );
      if (matching.length) out.set(world, matching);
    }
    return out;
  }, [grouped, filter]);

  const selected = levels.find((l) => l.id === selectedId);

  return (
    <div className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 glass rounded-xl px-4 py-3 text-left transition-all hover:border-cyber-cyan/30 focus:outline-none focus:border-cyber-cyan/50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {selected ? (
          <div className="flex items-center gap-3 min-w-0">
            <DifficultyBadge difficulty={selected.difficulty} />
            <span className="font-mono text-sm text-cyber-text">{selected.name}</span>
            <span className="text-cyber-cyan font-mono text-xs shrink-0">+{selected.xp} XP</span>
          </div>
        ) : (
          <span className="font-mono text-sm text-cyber-muted">Select a level…</span>
        )}
        <span className={`text-cyber-muted transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-2 w-full glass-violet rounded-xl overflow-hidden shadow-violet border border-cyber-violet/20">
          <div className="p-2 border-b border-cyber-border">
            <input
              autoFocus
              type="text"
              placeholder="Filter levels…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full bg-transparent font-mono text-sm text-cyber-text placeholder-cyber-muted outline-none px-2 py-1"
            />
          </div>
          <div className="max-h-96 overflow-y-auto">
            {[...filtered.entries()].map(([world, ls]) => (
              <div key={world}>
                <div className="px-3 py-1.5 text-cyber-violet font-mono text-[11px] uppercase tracking-widest bg-cyber-bg/40 sticky top-0">
                  {world}
                </div>
                {ls.map((level) => (
                  <button
                    key={level.id}
                    type="button"
                    disabled={!level.available_in_web}
                    onClick={() => {
                      if (!level.available_in_web) return;
                      onChange(level.id);
                      setOpen(false);
                      setFilter("");
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-cyber-cyan/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <DifficultyBadge difficulty={level.difficulty} />
                    <span className="font-mono text-sm text-cyber-text flex-1">
                      {level.name}
                    </span>
                    {!level.available_in_web ? (
                      <span className="text-cyber-muted font-mono text-[10px] border border-current rounded px-1.5 py-0.5 shrink-0">
                        Local Only
                      </span>
                    ) : (
                      <span className="text-cyber-cyan font-mono text-xs shrink-0">
                        +{level.xp} XP
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}
            {filtered.size === 0 && (
              <div className="px-4 py-6 text-center text-cyber-muted font-mono text-sm">
                No levels match "{filter}"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
