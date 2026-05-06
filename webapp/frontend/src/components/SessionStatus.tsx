import { motion, AnimatePresence } from "framer-motion";

type Status = "idle" | "provisioning" | "ready" | "expired" | "error";

interface Props {
  status: Status;
  message?: string;
}

const CONFIG: Record<Status, { color: string; dot: string; label: string }> = {
  idle:         { color: "text-cyber-muted",  dot: "bg-cyber-muted",  label: "Select a level to begin" },
  provisioning: { color: "text-yellow-400",   dot: "bg-yellow-400",   label: "Provisioning environment…" },
  ready:        { color: "text-cyber-green",  dot: "bg-cyber-green",  label: "Environment ready" },
  expired:      { color: "text-cyber-muted",  dot: "bg-cyber-muted",  label: "Session expired" },
  error:        { color: "text-cyber-red",    dot: "bg-cyber-red",    label: "Error" },
};

export default function SessionStatus({ status, message }: Props) {
  const cfg = CONFIG[status];
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={status}
        initial={{ opacity: 0, x: -4 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 4 }}
        className={`flex items-center gap-2 font-mono text-xs ${cfg.color}`}
      >
        <span
          className={`w-2 h-2 rounded-full ${cfg.dot} ${status === "provisioning" ? "animate-pulse" : ""}`}
        />
        <span>{message ?? cfg.label}</span>
      </motion.div>
    </AnimatePresence>
  );
}
