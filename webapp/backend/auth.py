import json
import secrets

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from pydantic import BaseModel

from config import settings

router = APIRouter()

COOKIE_NAME = "k8squest_session"
SESSION_PREFIX = "auth_session:"
PROGRESS_PREFIX = "progress:"
SESSION_TTL = 3600  # 1 hour, sliding


class GoogleAuthRequest(BaseModel):
    code: str
    redirect_uri: str


def _cookie_kwargs() -> dict:
    """Return kwargs for set_cookie — Secure only on HTTPS."""
    return {
        "key": COOKIE_NAME,
        "httponly": True,
        "samesite": "lax",
        "max_age": SESSION_TTL,
        "secure": settings.app_url.startswith("https"),
    }


async def get_current_user(request: Request) -> dict:
    """FastAPI dependency — validates session cookie and slides TTL. Raises 401 if invalid."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    redis = request.app.state.redis
    raw = await redis.get(f"{SESSION_PREFIX}{token}")
    if not raw:
        raise HTTPException(status_code=401, detail="Session expired")
    await redis.expire(f"{SESSION_PREFIX}{token}", SESSION_TTL)
    return json.loads(raw)


@router.post("/api/auth/google")
async def google_auth(body: GoogleAuthRequest, request: Request, response: Response):
    """Exchange GIS authorization code for a session cookie."""
    # Exchange code for tokens
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": body.code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": body.redirect_uri,
                "grant_type": "authorization_code",
            },
        )
    token_data = token_resp.json()
    if "id_token" not in token_data:
        raise HTTPException(status_code=400, detail="Token exchange failed")

    # Verify id_token
    try:
        id_info = id_token.verify_oauth2_token(
            token_data["id_token"],
            google_requests.Request(),
            settings.google_client_id,
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid id_token")

    user = {
        "sub": id_info["sub"],
        "email": id_info.get("email", ""),
        "name": id_info.get("name", ""),
        "picture": id_info.get("picture", ""),
    }

    # Create Redis session
    token = secrets.token_hex(32)
    redis = request.app.state.redis
    await redis.set(f"{SESSION_PREFIX}{token}", json.dumps(user), ex=SESSION_TTL)

    # Load existing progress if any
    raw_progress = await redis.get(f"{PROGRESS_PREFIX}{user['sub']}")
    progress = json.loads(raw_progress) if raw_progress else None

    response.set_cookie(value=token, **_cookie_kwargs())
    return {"user": user, "progress": progress}


@router.get("/api/auth/me")
async def get_me(request: Request, user: dict = Depends(get_current_user)):
    """Return current user info and saved progress. Slides session TTL."""
    redis = request.app.state.redis
    raw_progress = await redis.get(f"{PROGRESS_PREFIX}{user['sub']}")
    progress = json.loads(raw_progress) if raw_progress else None
    return {"user": user, "progress": progress}


@router.post("/api/auth/logout")
async def logout(request: Request, response: Response):
    """Delete the Redis session and clear the cookie."""
    token = request.cookies.get(COOKIE_NAME)
    if token:
        redis = request.app.state.redis
        await redis.delete(f"{SESSION_PREFIX}{token}")
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}
