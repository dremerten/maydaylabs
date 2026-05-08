export interface ProgressData {
  total_xp: number;
  completed_levels: string[];
  current_world: string;
  current_level: string | null;
  player_name: string;
}

const VALID_WORLDS = new Set([
  "world-1-basics",
  "world-2-deployments",
  "world-3-networking",
  "world-4-storage",
  "world-5-security",
]);

const LEVEL_PATTERN = /^level-\d+-[a-z0-9-]+$/;
const NAME_PATTERN = /^[a-zA-Z0-9 _-]{1,30}$/;
const EXPECTED_KEYS = ["total_xp", "completed_levels", "current_world", "current_level", "player_name"] as const;
const MAX_FILE_BYTES = 10_000;

export function validateProgress(raw: unknown): ProgressData {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Progress must be a JSON object");
  }

  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);

  for (const key of keys) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Unexpected field: "${key}"`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in obj)) {
      throw new Error(`Missing required field: "${key}"`);
    }
  }

  const totalXp = obj.total_xp;
  if (!Number.isInteger(totalXp) || (totalXp as number) < 0 || (totalXp as number) > 50_000) {
    throw new Error("total_xp must be an integer between 0 and 50000");
  }

  const levels = obj.completed_levels;
  if (!Array.isArray(levels) || levels.length > 50) {
    throw new Error("completed_levels must be an array of up to 50 items");
  }
  const levelSet = new Set<string>();
  for (const l of levels) {
    if (typeof l !== "string" || !LEVEL_PATTERN.test(l)) {
      throw new Error(`Invalid level ID: "${l}"`);
    }
    if (levelSet.has(l)) {
      throw new Error(`Duplicate level: "${l}"`);
    }
    levelSet.add(l);
  }

  const world = obj.current_world;
  if (typeof world !== "string" || !VALID_WORLDS.has(world)) {
    throw new Error(`current_world must be one of: ${[...VALID_WORLDS].join(", ")}`);
  }

  const currentLevel = obj.current_level;
  if (currentLevel !== null && (typeof currentLevel !== "string" || !LEVEL_PATTERN.test(currentLevel as string))) {
    throw new Error("current_level must be null or a valid level ID");
  }

  const playerName = obj.player_name;
  if (typeof playerName !== "string" || !NAME_PATTERN.test(playerName)) {
    throw new Error("player_name must be 1–30 characters (letters, numbers, spaces, _ or -)");
  }

  return {
    total_xp: totalXp as number,
    completed_levels: levels as string[],
    current_world: world,
    current_level: currentLevel as string | null,
    player_name: playerName,
  };
}

export async function parseProgressFile(file: File): Promise<ProgressData> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("File too large (max 10 KB)");
  }
  if (!file.name.endsWith(".json")) {
    throw new Error("File must be a .json file");
  }
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON");
  }
  return validateProgress(parsed);
}
