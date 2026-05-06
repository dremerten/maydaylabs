import re
from pathlib import Path

import yaml

from config import settings
from models import LevelInfo


_WORLD_ORDER = [
    "world-1-basics",
    "world-2-deployments",
    "world-3-networking",
    "world-4-storage",
    "world-5-security",
]


def _natural_key(path: Path) -> list:
    parts = re.split(r"(\d+)", path.name)
    return [int(p) if p.isdigit() else p for p in parts]


def load_levels() -> list[LevelInfo]:
    worlds_root = Path(settings.worlds_path)
    levels: list[LevelInfo] = []

    for world_dir in sorted(worlds_root.iterdir(), key=_natural_key):
        if not world_dir.is_dir() or world_dir.name not in _WORLD_ORDER:
            continue
        world_number = _WORLD_ORDER.index(world_dir.name) + 1

        for level_dir in sorted(world_dir.iterdir(), key=_natural_key):
            mission_file = level_dir / "mission.yaml"
            if not mission_file.exists():
                continue

            data = yaml.safe_load(mission_file.read_text())
            level_id = level_dir.name
            levels.append(
                LevelInfo(
                    id=level_id,
                    name=data.get("name", level_id),
                    world=world_dir.name,
                    world_number=world_number,
                    difficulty=data.get("difficulty", "beginner"),
                    xp=data.get("xp", 100),
                    concepts=data.get("concepts", []),
                    expected_time=data.get("expected_time", "15m"),
                    available_in_web=level_id not in settings.disabled_levels,
                    description=data.get("description", ""),
                    objective=data.get("objective", ""),
                )
            )

    return levels


# Cache at module load — levels don't change at runtime
_LEVEL_CACHE: list[LevelInfo] = []


def get_levels() -> list[LevelInfo]:
    global _LEVEL_CACHE
    if not _LEVEL_CACHE:
        _LEVEL_CACHE = load_levels()
    return _LEVEL_CACHE


def get_level(level_id: str) -> LevelInfo | None:
    return next((l for l in get_levels() if l.id == level_id), None)
