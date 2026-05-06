"use client";

import { useEffect, useState } from "react";

interface Props {
  expiresAt: string | null;
  onExpired?: () => void;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export default function CountdownTimer({ expiresAt, onExpired }: Props) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(null);
      return;
    }

    const target = new Date(expiresAt).getTime();

    const tick = () => {
      const diff = Math.max(0, Math.floor((target - Date.now()) / 1000));
      setRemaining(diff);
      if (diff === 0) onExpired?.();
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, onExpired]);

  if (remaining === null) return null;

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const urgent = remaining < 300; // last 5 minutes

  return (
    <div className={`flex items-center gap-2 font-mono text-xs ${urgent ? "text-cyber-red" : "text-cyber-muted"}`}>
      <span className={urgent ? "animate-pulse" : ""}>⏱</span>
      <span>
        {pad(mins)}:{pad(secs)}
      </span>
      {urgent && <span className="text-cyber-red">expiring soon</span>}
    </div>
  );
}
