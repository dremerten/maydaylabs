"""Bridge between browser WebSocket and a Kubernetes pod TTY via exec stream."""
import asyncio
import json
import logging

from fastapi import WebSocket, WebSocketDisconnect
from kubernetes import client, config as k8s_config
from kubernetes.stream import stream

logger = logging.getLogger(__name__)

_CHANNEL_STDIN = 0
_CHANNEL_STDOUT = 1
_CHANNEL_STDERR = 2
_CHANNEL_RESIZE = 4


def _k8s_exec_stream(namespace: str, pod_name: str, container: str = ""):
    """Open a Kubernetes interactive exec stream to a pod."""
    try:
        k8s_config.load_incluster_config()
    except Exception:
        k8s_config.load_kube_config()

    kwargs = dict(
        namespace=namespace,
        name=pod_name,
        command=["/bin/bash"] if "shell" in pod_name else ["python", "/app/engine/engine.py"],
        stdin=True,
        stdout=True,
        stderr=True,
        tty=True,
        _preload_content=False,
    )
    if container:
        kwargs["container"] = container

    return stream(client.CoreV1Api().connect_get_namespaced_pod_exec, **kwargs)


async def bridge_terminal(ws: WebSocket, namespace: str, pod_name: str) -> None:
    """Bidirectional bridge: browser WebSocket ↔ pod TTY."""
    await ws.accept()

    # Wait until pod is running before attempting exec
    for _ in range(60):
        from k8s_client import get_pod_phase
        phase = get_pod_phase(namespace, pod_name)
        if phase == "Running":
            break
        await asyncio.sleep(1)
    else:
        await ws.send_text("\r\n\x1b[31mPod did not become ready in time.\x1b[0m\r\n")
        await ws.close()
        return

    loop = asyncio.get_event_loop()
    ws_stream = await loop.run_in_executor(None, _k8s_exec_stream, namespace, pod_name)

    async def pod_to_browser():
        while ws_stream.is_open():
            # Read from stdout/stderr (non-blocking)
            data = await loop.run_in_executor(
                None,
                lambda: ws_stream.read_stdout(timeout=0.05) or ws_stream.read_stderr(timeout=0.05),
            )
            if data:
                try:
                    await ws.send_bytes(data.encode("utf-8", errors="replace"))
                except Exception:
                    break
            await asyncio.sleep(0)

    async def browser_to_pod():
        try:
            while True:
                msg = await ws.receive()
                if msg["type"] == "websocket.disconnect":
                    break
                if "bytes" in msg and msg["bytes"]:
                    raw = msg["bytes"]
                elif "text" in msg and msg["text"]:
                    # Control frame — check for resize
                    try:
                        ctrl = json.loads(msg["text"])
                        if ctrl.get("type") == "resize":
                            cols = ctrl.get("cols", 80)
                            rows = ctrl.get("rows", 24)
                            resize_msg = json.dumps({"Width": cols, "Height": rows})
                            ws_stream.write_channel(_CHANNEL_RESIZE, resize_msg)
                        continue
                    except (json.JSONDecodeError, Exception):
                        raw = msg["text"].encode("utf-8")
                else:
                    continue
                await loop.run_in_executor(None, ws_stream.write_stdin, raw)
        except WebSocketDisconnect:
            pass

    try:
        await asyncio.gather(pod_to_browser(), browser_to_pod())
    finally:
        ws_stream.close()
