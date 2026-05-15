import asyncio
import json
import logging

import httpx
import redis.asyncio as aioredis
import websockets as ws_lib
from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response

import k8s_client as k8s
import session as session_manager
from auth import router as auth_router, get_current_user
from levels import get_level, get_levels
from models import SessionCreate, SessionStatus
from config import settings
from rate_limit import RateLimitExceeded
from terminal import bridge_terminal

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="K8sQuest API", version="1.0.0")

app.include_router(auth_router)


@app.on_event("startup")
async def startup_event():
    app.state.redis = aioredis.from_url(settings.redis_url, decode_responses=True)


@app.on_event("shutdown")
async def shutdown_event():
    await app.state.redis.aclose()


_cors_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _wait_for_pod_ip(namespace: str, pod_name: str, timeout: int = 60) -> str | None:
    for _ in range(timeout):
        ip = k8s.get_pod_ip(namespace, pod_name)
        if ip:
            return ip
        await asyncio.sleep(1)
    return None


# ── REST ──────────────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/levels")
async def list_levels():
    return get_levels()


@app.post("/api/sessions", response_model=SessionStatus, status_code=201)
async def create_session(body: SessionCreate, request: Request, user: dict = Depends(get_current_user)):
    level = get_level(body.level)
    if level is None:
        raise HTTPException(status_code=422, detail=f"Unknown level: {body.level}")
    if not level.available_in_web:
        raise HTTPException(
            status_code=422,
            detail=f"Level '{body.level}' requires local installation (node operations not supported in web mode).",
        )

    if body.progress and len(json.dumps(body.progress)) > 10_000:
        raise HTTPException(status_code=422, detail="Progress data too large")

    try:
        sess = await session_manager.create_session(body.level, user["sub"], body.player_name, body.progress)
    except RateLimitExceeded as e:
        return JSONResponse(
            status_code=429,
            content={"detail": e.reason},
            headers={"Retry-After": str(settings.session_ttl_seconds)},
        )
    except Exception as e:
        logger.exception("Failed to create session")
        raise HTTPException(status_code=500, detail=str(e))

    return sess


@app.get("/api/sessions/{session_id}", response_model=SessionStatus)
async def get_session(session_id: str):
    sess = session_manager.get_session(session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    if sess.status == "expired":
        asyncio.create_task(session_manager.delete_session(session_id))
    return sess


@app.get("/api/sessions/{session_id}/progress", include_in_schema=True)
async def get_session_progress(session_id: str):
    sess = session_manager.get_session(session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    if sess.status != "ready":
        raise HTTPException(status_code=409, detail="Session not ready yet")

    loop = asyncio.get_event_loop()
    try:
        content = await loop.run_in_executor(
            None,
            lambda: k8s.exec_in_pod(sess.namespace, f"engine-{session_id}", ["cat", "/app/progress.json"]),
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Progress not available yet")

    if not content or not content.strip():
        raise HTTPException(status_code=404, detail="No progress yet — complete a level first")

    return Response(content=content, media_type="application/json")


@app.delete("/api/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str):
    sess = session_manager.get_session(session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    await session_manager.delete_session(session_id)


@app.post("/api/sessions/{session_id}/checkpoint")
async def checkpoint_progress(session_id: str, progress: dict, request: Request):
    sess = session_manager.get_session(session_id)
    if not sess or not sess.user_sub:
        raise HTTPException(status_code=404, detail="Session not found")
    await request.app.state.redis.set(
        f"progress:{sess.user_sub}", json.dumps(progress)
    )
    return {"ok": True}


# ── WebSockets (engine terminal — xterm.js relay) ─────────────────────────────

_SESSION_EXPIRED_MSG = (
    b"\r\n\x1b[31m\xe2\x97\x8f Session not found or expired.\x1b[0m\r\n"
    b"\x1b[33mStart a new session from the Play page.\x1b[0m\r\n"
)


@app.websocket("/ws/{session_id}/engine")
async def ws_engine(websocket: WebSocket, session_id: str):
    sess = session_manager.get_session(session_id)
    if sess is None:
        await websocket.accept()
        await websocket.send_bytes(_SESSION_EXPIRED_MSG)
        await websocket.close(code=4404)
        return
    await bridge_terminal(websocket, sess.namespace, f"engine-{session_id}")


@app.websocket("/ws/{session_id}/shell")
async def ws_shell(websocket: WebSocket, session_id: str):
    sess = session_manager.get_session(session_id)
    if sess is None:
        await websocket.accept()
        await websocket.send_bytes(_SESSION_EXPIRED_MSG)
        await websocket.close(code=4404)
        return
    await bridge_terminal(websocket, sess.namespace, f"shell-{session_id}")


# ── Shell terminal proxy (ttyd running inside the shell pod) ─────────────────
#
# The shell pod runs ttyd with --base-path /shell/<session_id>/.
# The browser opens /shell/<session_id>/ which routes here via the HTTPRoute.
# We proxy:
#   GET  /shell/{id}/{path}  →  http://pod_ip:7681/shell/{id}/{path}   (HTML/JS/assets/token)
#   WS   /shell/{id}/ws      →  ws://pod_ip:7681/shell/{id}/ws          (terminal stream)
#
# This is a transparent pass-through — ttyd handles everything including auth tokens.

@app.get("/shell/{session_id}", include_in_schema=False)
async def shell_redirect(session_id: str):
    return RedirectResponse(f"/shell/{session_id}/", status_code=301)


@app.websocket("/shell/{session_id}/ws")
async def shell_ws_proxy(ws_browser: WebSocket, session_id: str):
    sess = session_manager.get_session(session_id)
    if sess is None:
        await ws_browser.close(code=4404, reason="Session not found")
        return

    pod_ip = await _wait_for_pod_ip(sess.namespace, f"shell-{session_id}", timeout=60)
    if not pod_ip:
        await ws_browser.close(code=4503, reason="Shell pod not ready")
        return

    # Pass the token query param through if present
    token = ws_browser.query_params.get("token", "")
    target = f"ws://{pod_ip}:7681/shell/{session_id}/ws"
    if token:
        target += f"?token={token}"

    await ws_browser.accept()
    try:
        async with ws_lib.connect(
            target,
            additional_headers={"Origin": f"http://{pod_ip}:7681"},
            open_timeout=30,
        ) as ws_pod:
            async def _browser_to_pod():
                try:
                    async for msg in ws_browser.iter_bytes():
                        await ws_pod.send(msg)
                except Exception:
                    pass

            async def _pod_to_browser():
                try:
                    async for msg in ws_pod:
                        if isinstance(msg, bytes):
                            await ws_browser.send_bytes(msg)
                        else:
                            await ws_browser.send_text(msg)
                except Exception:
                    pass

            await asyncio.gather(_browser_to_pod(), _pod_to_browser())
    except Exception as e:
        logger.warning("Shell WS proxy error for %s: %s", session_id, e)
    finally:
        try:
            await ws_browser.close()
        except Exception:
            pass


@app.api_route(
    "/shell/{session_id}/{path:path}",
    methods=["GET", "HEAD"],
    include_in_schema=False,
)
async def shell_http_proxy(session_id: str, path: str, request: Request):
    sess = session_manager.get_session(session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="Session not found or expired")

    pod_ip = await _wait_for_pod_ip(sess.namespace, f"shell-{session_id}", timeout=60)
    if not pod_ip:
        raise HTTPException(status_code=503, detail="Shell pod not ready")

    qs = request.url.query
    target = f"http://{pod_ip}:7681/shell/{session_id}/{path}"
    if qs:
        target += f"?{qs}"

    # Strip hop-by-hop headers before forwarding
    skip = {"host", "connection", "transfer-encoding", "upgrade"}
    fwd_headers = {k: v for k, v in request.headers.items() if k.lower() not in skip}

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.request(request.method, target, headers=fwd_headers)

    # Strip hop-by-hop headers from response
    resp_headers = {
        k: v for k, v in resp.headers.items()
        if k.lower() not in ("transfer-encoding", "connection")
    }
    return Response(content=resp.content, status_code=resp.status_code, headers=resp_headers)
