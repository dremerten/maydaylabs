"""Thin wrapper around the kubernetes Python client."""
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
    ns = client.V1Namespace(
        metadata=client.V1ObjectMeta(name=name, labels=labels or {})
    )
    core().create_namespace(ns)


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


def get_pod_ip(namespace: str, name: str) -> str | None:
    try:
        pod = core().read_namespaced_pod(name=name, namespace=namespace)
        if pod.status and pod.status.phase == "Running" and pod.status.pod_ip:
            return pod.status.pod_ip
        return None
    except ApiException:
        return None
