import hashlib

import redis.asyncio as aioredis

from config import settings

_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def _ip_key(ip: str) -> str:
    return f"maydaylabs:sessions:ip:{hashlib.sha256(ip.encode()).hexdigest()[:16]}"


def _level_key(level_id: str) -> str:
    return f"maydaylabs:sessions:level:{level_id}"


GLOBAL_KEY = "maydaylabs:sessions:total"
# Key TTL slightly longer than session so crashes don't leak counters forever
_TTL = settings.session_ttl_seconds + 120


class RateLimitExceeded(Exception):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


async def check_and_increment(level_id: str, client_ip: str) -> None:
    """Atomically check all three limits then increment. Raises RateLimitExceeded on breach."""
    r = get_redis()
    async with r.pipeline(transaction=True) as pipe:
        await pipe.get(GLOBAL_KEY)
        await pipe.get(_level_key(level_id))
        await pipe.get(_ip_key(client_ip))
        results = await pipe.execute()

    total = int(results[0] or 0)
    per_level = int(results[1] or 0)
    per_ip = int(results[2] or 0)

    if total >= settings.max_sessions_total:
        raise RateLimitExceeded(f"Server is at capacity ({settings.max_sessions_total} active sessions). Try again later.")
    if per_level >= settings.max_sessions_per_level:
        raise RateLimitExceeded(f"This level already has {settings.max_sessions_per_level} active sessions. Try again later.")
    if per_ip >= settings.max_sessions_per_ip:
        raise RateLimitExceeded(f"You already have {settings.max_sessions_per_ip} active sessions. Close one first.")

    # All checks passed — increment
    r2 = get_redis()
    async with r2.pipeline(transaction=True) as pipe:
        pipe.incr(GLOBAL_KEY)
        pipe.expire(GLOBAL_KEY, _TTL)
        pipe.incr(_level_key(level_id))
        pipe.expire(_level_key(level_id), _TTL)
        pipe.incr(_ip_key(client_ip))
        pipe.expire(_ip_key(client_ip), _TTL)
        await pipe.execute()


async def decrement(level_id: str, client_ip: str) -> None:
    r = get_redis()
    async with r.pipeline(transaction=False) as pipe:
        pipe.decr(GLOBAL_KEY)
        pipe.decr(_level_key(level_id))
        if client_ip:
            pipe.decr(_ip_key(client_ip))
        await pipe.execute()
