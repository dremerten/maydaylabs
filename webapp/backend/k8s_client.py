"""Thin wrapper around the kubernetes Python client."""
import time

from kubernetes import client, config as k8s_config
from kubernetes.client.exceptions import ApiException

_loaded = False


def _load():
    global _loaded
    if not _loaded:
        try:
            k8s_config.load_incluster_config()
        except k8s_config.ConfigException:
            from config import settings
            k8s_config.load_kube_config(context=settings.kube_context)
        _loaded = True


def core() -> client.CoreV1Api:
    _load()
    return client.CoreV1Api()


def apps() -> client.AppsV1Api:
    _load()
    return client.AppsV1Api()


def rbac() -> client.RbacAuthorizationV1Api:
    _load()
    return client.RbacAuthorizationV1Api()


def dynamic():
    from kubernetes import dynamic as dyn
    from kubernetes.client import api_client
    _load()
    return dyn.DynamicClient(api_client.ApiClient())


def create_namespace(name: str, labels: dict | None = None) -> None:
    ns_body = client.V1Namespace(
        metadata=client.V1ObjectMeta(name=name, labels=labels or {})
    )
    try:
        core().create_namespace(ns_body)
        return
    except ApiException as e:
        if e.status != 409:
            raise

    # 409: namespace exists — it's likely Terminating from a previous session cleanup.
    # Poll until it disappears (404), then create fresh.
    for _ in range(30):
        try:
            ns = core().read_namespace(name)
        except ApiException as inner:
            if inner.status == 404:
                break  # fully gone
            raise
        if ns.status.phase != "Terminating":
            raise RuntimeError(f"Namespace '{name}' already exists and is Active — cannot overwrite")
        time.sleep(1)
    else:
        raise RuntimeError(f"Namespace '{name}' stuck in Terminating for 30s")

    core().create_namespace(ns_body)


def delete_namespace(name: str) -> None:
    try:
        core().delete_namespace(name)
    except ApiException as e:
        if e.status != 404:
            raise


def apply_manifest_dict(namespace: str, manifest: dict) -> None:
    """Apply a single parsed YAML manifest dict to the cluster."""
    from kubernetes.utils import create_from_dict
    _load()
    api = client.ApiClient()
    create_from_dict(api, manifest, namespace=namespace)


def create_pod(namespace: str, pod: client.V1Pod) -> None:
    core().create_namespaced_pod(namespace=namespace, body=pod)


def wait_for_pod_deleted(namespace: str, name: str, timeout: int = 30) -> None:
    """Poll until the named pod is fully gone (404). Returns immediately if already absent."""
    for _ in range(timeout):
        try:
            core().read_namespaced_pod(name=name, namespace=namespace)
        except ApiException as e:
            if e.status == 404:
                return
            raise
        time.sleep(1)
    raise RuntimeError(f"Pod '{namespace}/{name}' still Terminating after {timeout}s")


def pod_exists(namespace: str, name: str) -> bool:
    try:
        core().read_namespaced_pod(name=name, namespace=namespace)
        return True
    except ApiException as e:
        if e.status == 404:
            return False
        raise


def get_pod_phase(namespace: str, name: str) -> str | None:
    try:
        pod = core().read_namespaced_pod(name=name, namespace=namespace)
        return pod.status.phase
    except ApiException:
        return None


def exec_in_pod(namespace: str, pod_name: str, command: list[str]) -> str:
    """Execute a command in a running pod and return stdout (no tty)."""
    from kubernetes.stream import stream
    _load()
    resp = stream(
        core().connect_get_namespaced_pod_exec,
        pod_name,
        namespace,
        command=command,
        stderr=False,
        stdin=False,
        stdout=True,
        tty=False,
        _preload_content=False,
    )
    resp.run_forever(timeout=10)
    return resp.read_stdout()


def get_pod_ip(namespace: str, name: str) -> str | None:
    try:
        pod = core().read_namespaced_pod(name=name, namespace=namespace)
        if pod.status and pod.status.phase == "Running" and pod.status.pod_ip:
            return pod.status.pod_ip
        return None
    except ApiException:
        return None
