const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export interface LevelInfo {
  id: string;
  name: string;
  world: string;
  world_number: number;
  difficulty: string;
  xp: number;
  concepts: string[];
  expected_time: string;
  available_in_web: boolean;
  description: string;
  objective: string;
}

export interface SessionStatus {
  session_id: string;
  level: string;
  namespace: string;
  status: "provisioning" | "ready" | "expired";
  expires_at: string;
  created_at: string;
}

export async function fetchLevels(): Promise<LevelInfo[]> {
  const res = await fetch(`${BASE}/api/levels`);
  if (!res.ok) throw new Error("Failed to fetch levels");
  return res.json();
}

export async function createSession(levelId: string): Promise<SessionStatus> {
  const res = await fetch(`${BASE}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level: levelId }),
  });
  if (res.status === 429) {
    const data = await res.json();
    throw new Error(data.detail ?? "Too many active sessions. Please try again later.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail ?? "Failed to create session");
  }
  return res.json();
}

export async function getSession(sessionId: string): Promise<SessionStatus> {
  const res = await fetch(`${BASE}/api/sessions/${sessionId}`);
  if (!res.ok) throw new Error("Session not found");
  return res.json();
}

export async function deleteSession(sessionId: string): Promise<void> {
  await fetch(`${BASE}/api/sessions/${sessionId}`, { method: "DELETE" });
}

export function wsUrl(sessionId: string, terminal: "engine" | "shell"): string {
  const base = (process.env.NEXT_PUBLIC_WS_URL ?? BASE)
    .replace(/^http/, "ws")
    .replace(/^https/, "wss");
  return `${base}/ws/${sessionId}/${terminal}`;
}
