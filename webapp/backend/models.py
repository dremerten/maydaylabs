from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class LevelInfo(BaseModel):
    id: str
    name: str
    world: str
    world_number: int
    difficulty: str
    xp: int
    concepts: list[str]
    expected_time: str
    available_in_web: bool
    description: str = ""
    objective: str = ""


class SessionCreate(BaseModel):
    level: str
    player_name: str = "explorer"
    progress: dict | None = None  # optional prior progress to seed the engine pod


class SessionStatus(BaseModel):
    session_id: str
    level: str
    namespace: str
    status: Literal["provisioning", "ready", "expired"]
    expires_at: datetime
    created_at: datetime
    client_ip: str = Field(default="", exclude=True)  # stored for accurate rate-limit decrement, never serialized
