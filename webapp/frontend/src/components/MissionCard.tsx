import type { LevelInfo } from "@/lib/api";

const DIFF_ICONS: Record<string, string> = {
  beginner: "⚡",
  intermediate: "⚡⚡",
  advanced: "⚡⚡⚡",
  expert: "⚡⚡⚡⚡",
};

interface Props {
  level: LevelInfo;
}

export default function MissionCard({ level }: Props) {
  return (
    <div className="glass rounded-xl p-5 border border-cyber-cyan/10 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-mono font-bold text-cyber-cyan text-base leading-tight">{level.name}</h2>
          <p className="text-cyber-muted font-mono text-xs mt-0.5">{level.world.replace(/-/g, " ")}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`badge-${level.difficulty} border rounded px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider`}>
            {level.difficulty}
          </span>
          <span className="text-cyber-cyan font-mono text-xs">+{level.xp} XP</span>
        </div>
      </div>

      {level.objective && (
        <div>
          <div className="text-cyber-muted font-mono text-[10px] uppercase tracking-widest mb-1">Objective</div>
          <p className="text-cyber-text text-sm leading-relaxed">{level.objective}</p>
        </div>
      )}

      {level.concepts.length > 0 && (
        <div>
          <div className="text-cyber-muted font-mono text-[10px] uppercase tracking-widest mb-2">Concepts</div>
          <div className="flex flex-wrap gap-1.5">
            {level.concepts.map((c) => (
              <span
                key={c}
                className="border border-cyber-violet/30 text-cyber-violet font-mono text-[10px] rounded px-1.5 py-0.5"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 pt-1 border-t border-cyber-border">
        <div className="flex items-center gap-1 text-cyber-muted font-mono text-xs">
          <span>⏱</span>
          <span>{level.expected_time}</span>
        </div>
        <div className="flex items-center gap-1 text-cyber-muted font-mono text-xs">
          <span>{DIFF_ICONS[level.difficulty] ?? "⚡"}</span>
          <span>Difficulty</span>
        </div>
      </div>
    </div>
  );
}
