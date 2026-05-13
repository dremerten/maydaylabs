"""Bridge between browser WebSocket and a Kubernetes pod TTY via exec stream."""
import asyncio
import json
import logging
import queue
import threading

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


def _run_io(
    ws_stream,
    write_q: queue.Queue,
    read_q: asyncio.Queue,
    loop: asyncio.AbstractEventLoop,
    stop: threading.Event,
) -> None:
    """Single thread that owns all ws_stream I/O — no other code may call ws_stream methods.

    Drains pending writes between reads so stdin/resize are processed promptly.
    Puts None into read_q as a sentinel when the stream closes.
    """
    try:
        while ws_stream.is_open() and not stop.is_set():
            # Drain pending writes
            while True:
                try:
                    item = write_q.get_nowait()
                    if item[0] == "stdin":
                        ws_stream.write_stdin(item[1])
                    elif item[0] == "resize":
                        ws_stream.write_channel(_CHANNEL_RESIZE, item[1])
                except queue.Empty:
                    break
                except Exception:
                    pass

            # Read available output
            data = ws_stream.read_stdout(timeout=0.05) or ws_stream.read_stderr(timeout=0.05)
            if data:
                loop.call_soon_threadsafe(read_q.put_nowait, data)
    except Exception as exc:
        logger.debug("io_thread exiting for %s: %s", ws_stream, exc)
    finally:
        loop.call_soon_threadsafe(read_q.put_nowait, None)


async def bridge_terminal(ws: WebSocket, namespace: str, pod_name: str) -> None:
    """Bidirectional bridge: browser WebSocket ↔ pod TTY."""
    await ws.accept()

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

    read_q: asyncio.Queue[str | None] = asyncio.Queue()
    write_q: queue.Queue = queue.Queue()
    stop_event = threading.Event()

    io_thread = threading.Thread(
        target=_run_io,
        args=(ws_stream, write_q, read_q, loop, stop_event),
        daemon=True,
    )
    io_thread.start()

    async def pod_to_browser():
        try:
            while True:
                data = await read_q.get()
                if data is None:
                    logger.info("Exec stream closed for %s/%s", namespace, pod_name)
                    break
                await ws.send_bytes(data.encode("utf-8", errors="replace"))
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    async def browser_to_pod():
        try:
            while True:
                msg = await ws.receive()
                if msg["type"] == "websocket.disconnect":
                    break
                if "bytes" in msg and msg["bytes"]:
                    write_q.put(("stdin", msg["bytes"]))
                elif "text" in msg and msg["text"]:
                    try:
                        ctrl = json.loads(msg["text"])
                        if ctrl.get("type") == "resize":
                            cols = ctrl.get("cols", 80)
                            rows = ctrl.get("rows", 24)
                            write_q.put(("resize", json.dumps({"Width": cols, "Height": rows})))
                    except Exception:
                        pass
        except (WebSocketDisconnect, BrokenPipeError, OSError):
            pass
        except Exception as exc:
            logger.warning("browser_to_pod error for %s: %s", pod_name, exc)

    try:
        await asyncio.gather(pod_to_browser(), browser_to_pod())
    finally:
        stop_event.set()
        ws_stream.close()
        io_thread.join(timeout=2)
