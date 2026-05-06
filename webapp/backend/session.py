"""Session lifecycle: create, monitor, and delete per-user game sessions."""
import asyncio
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import yaml
from kubernetes import client

import k8s_client as k8s
import rate_limit
from config import NAMESPACE_PREFIX, settings
from models import SessionStatus

_WORLDS_ROOT = Path(settings.worlds_path)

# In-memory session map: session_id → SessionStatus
# Redis is used for rate limiting; this dict is the fast path for status lookups.
_sessions: dict[str, SessionStatus] = {}


def _session_ns(session_id: str) -> str:
    return f"{NAMESPACE_PREFIX}{session_id}"


def _assert_maydaylabs_ns(namespace: str) -> None:
    """Raise if namespace is not a maydaylabs-* namespace — hard safety guard."""
    if not namespace.startswith(NAMESPACE_PREFIX):
        raise ValueError(
            f"SAFETY: refusing to touch namespace '{namespace}' — "
            f"only '{NAMESPACE_PREFIX}*' namespaces are allowed"
        )


def _substitute_namespace(text: str, session_id: str) -> str:
    """Replace 'k8squest' placeholder in manifest templates with the session namespace."""
    ns = _session_ns(session_id)
    return text.replace("k8squest", ns)


def _find_level_dir(level_id: str) -> Path | None:
    for match in _WORLDS_ROOT.rglob(level_id):
        if match.is_dir():
            return match
    return None


def _create_level_configmap(namespace: str, level_id: str, level_dir: Path, session_id: str) -> str:
    """Create a ConfigMap with all level files; return the ConfigMap name."""
    cm_name = f"level-files-{level_id}"
    data: dict[str, str] = {}
    for f in sorted(level_dir.iterdir()):
        if f.is_file():
            try:
                content = f.read_text(errors="replace")
                data[f.name] = _substitute_namespace(content, session_id)
            except Exception:
                pass
    k8s.core().create_namespaced_config_map(
        namespace=namespace,
        body=client.V1ConfigMap(
            metadata=client.V1ObjectMeta(name=cm_name, namespace=namespace),
            data=data,
        ),
    )
    return cm_name


def _build_engine_pod(session_id: str, level_id: str) -> client.V1Pod:
    ns = _session_ns(session_id)
    return client.V1Pod(
        metadata=client.V1ObjectMeta(
            name=f"engine-{session_id}",
            namespace=ns,
            labels={"app": "maydaylabs-engine", "session": session_id},
        ),
        spec=client.V1PodSpec(
            restart_policy="Never",
            service_account_name=settings.engine_sa,
            security_context=client.V1PodSecurityContext(
                run_as_non_root=True,
                run_as_user=1000,
            ),
            containers=[
                client.V1Container(
                    name="engine",
                    image=settings.engine_image,
                    image_pull_policy="Never",
                    stdin=True,
                    tty=True,
                    env=[
                        client.V1EnvVar(name="K8SQUEST_NAMESPACE", value=ns),
                        client.V1EnvVar(name="K8SQUEST_WEB", value="true"),
                        client.V1EnvVar(name="K8SQUEST_LEVEL", value=level_id),
                        client.V1EnvVar(name="NAMESPACE", value=ns),
                    ],
                    security_context=client.V1SecurityContext(
                        allow_privilege_escalation=False,
                        capabilities=client.V1Capabilities(drop=["ALL"]),
                    ),
                    resources=client.V1ResourceRequirements(
                        requests={"cpu": "100m", "memory": "128Mi"},
                        limits={"cpu": "250m", "memory": "256Mi"},
                    ),
                )
            ],
            volumes=[],
        ),
    )


def _build_shell_pod(session_id: str, level_id: str, level_cm: str | None = None) -> client.V1Pod:
    ns = _session_ns(session_id)

    volume_mounts = [
        client.V1VolumeMount(name="tmp", mount_path="/tmp"),
        client.V1VolumeMount(name="home", mount_path="/home/k8squest"),
        client.V1VolumeMount(name="docker-sock", mount_path="/var/run/docker.sock"),
    ]
    volumes = [
        client.V1Volume(name="tmp", empty_dir=client.V1EmptyDirVolumeSource()),
        client.V1Volume(name="home", empty_dir=client.V1EmptyDirVolumeSource()),
        client.V1Volume(
            name="docker-sock",
            host_path=client.V1HostPathVolumeSource(path="/var/run/docker.sock", type="Socket"),
        ),
    ]
    init_containers = []

    if level_cm:
        # ConfigMap volumes are read-only at the kernel level; copy to a writable emptyDir
        # so players can edit manifests and YAML files as part of the exercise.
        volumes.append(client.V1Volume(
            name="level-src",
            config_map=client.V1ConfigMapVolumeSource(name=level_cm),
        ))
        volumes.append(client.V1Volume(name="level-work", empty_dir=client.V1EmptyDirVolumeSource()))
        volume_mounts.append(
            client.V1VolumeMount(name="level-work", mount_path=f"/home/k8squest/{level_id}")
        )
        init_containers.append(client.V1Container(
            name="level-init",
            image=settings.shell_image,
            image_pull_policy="Never",
            command=["sh", "-c", f"cp /level-src/* /home/k8squest/{level_id}/ && chmod u+rw /home/k8squest/{level_id}/*"],
            volume_mounts=[
                client.V1VolumeMount(name="level-src", mount_path="/level-src", read_only=True),
                client.V1VolumeMount(name="home", mount_path="/home/k8squest"),
                client.V1VolumeMount(name="level-work", mount_path=f"/home/k8squest/{level_id}"),
            ],
            security_context=client.V1SecurityContext(
                allow_privilege_escalation=False,
                capabilities=client.V1Capabilities(drop=["ALL"]),
            ),
        ))

    return client.V1Pod(
        metadata=client.V1ObjectMeta(
            name=f"shell-{session_id}",
            namespace=ns,
            labels={"app": "maydaylabs-shell", "session": session_id},
        ),
        spec=client.V1PodSpec(
            init_containers=init_containers or None,
            restart_policy="Never",
            service_account_name=f"maydaylabs-player-{session_id}",
            security_context=client.V1PodSecurityContext(
                run_as_non_root=True,
                run_as_user=1000,
                supplemental_groups=[975],
            ),
            containers=[
                client.V1Container(
                    name="shell",
                    image=settings.shell_image,
                    image_pull_policy="Never",
                    stdin=True,
                    tty=True,
                    env=[
                        client.V1EnvVar(name="NAMESPACE", value=ns),
                        client.V1EnvVar(name="KUBECTL_NAMESPACE", value=ns),
                        client.V1EnvVar(name="SESSION_ID", value=session_id),
                        client.V1EnvVar(name="TERM", value="xterm-256color"),
                    ],
                    security_context=client.V1SecurityContext(
                        allow_privilege_escalation=False,
                        read_only_root_filesystem=True,
                        capabilities=client.V1Capabilities(drop=["ALL"]),
                    ),
                    resources=client.V1ResourceRequirements(
                        requests={"cpu": "50m", "memory": "64Mi"},
                        limits={"cpu": "150m", "memory": "128Mi"},
                    ),
                    volume_mounts=volume_mounts,
                )
            ],
            volumes=volumes,
        ),
    )


def _bind_engine_to_session(session_id: str, namespace: str) -> None:
    """Create engine SA in the session namespace and bind it cluster-wide to the engine ClusterRole."""
    _assert_maydaylabs_ns(namespace)
    k8s.core().create_namespaced_service_account(
        namespace=namespace,
        body=client.V1ServiceAccount(
            metadata=client.V1ObjectMeta(name="maydaylabs-engine", namespace=namespace)
        ),
    )
    k8s.rbac().create_cluster_role_binding(
        body=client.V1ClusterRoleBinding(
            metadata=client.V1ObjectMeta(
                name=f"maydaylabs-engine-{session_id}",
                labels={"maydaylabs-session": session_id},
            ),
            subjects=[client.RbacV1Subject(
                kind="ServiceAccount",
                name="maydaylabs-engine",
                namespace=namespace,
            )],
            role_ref=client.V1RoleRef(
                api_group="rbac.authorization.k8s.io",
                kind="ClusterRole",
                name="maydaylabs-engine",
            ),
        )
    )


def _bind_backend_to_namespace(namespace: str) -> None:
    """Bind the backend SA to maydaylabs-backend-session ClusterRole in this namespace only."""
    _assert_maydaylabs_ns(namespace)
    binding = client.V1RoleBinding(
        metadata=client.V1ObjectMeta(name="maydaylabs-backend", namespace=namespace),
        subjects=[client.RbacV1Subject(
            kind="ServiceAccount",
            name="maydaylabs-backend",
            namespace="maydaylabs-system",
        )],
        role_ref=client.V1RoleRef(
            api_group="rbac.authorization.k8s.io",
            kind="ClusterRole",
            name="maydaylabs-backend-session",
        ),
    )
    k8s.rbac().create_namespaced_role_binding(namespace=namespace, body=binding)


def _apply_session_rbac(session_id: str, namespace: str) -> None:
    """Create the player ServiceAccount, Role, and RoleBinding for the shell pod."""
    _assert_maydaylabs_ns(namespace)
    sa_name = f"maydaylabs-player-{session_id}"

    k8s.core().create_namespaced_service_account(
        namespace=namespace,
        body=client.V1ServiceAccount(
            metadata=client.V1ObjectMeta(name=sa_name, namespace=namespace)
        ),
    )

    role = client.V1Role(
        metadata=client.V1ObjectMeta(name=sa_name, namespace=namespace),
        rules=[
            client.V1PolicyRule(
                api_groups=[""],
                resources=[
                    "pods", "pods/log", "pods/exec", "pods/status",
                    "services", "endpoints", "configmaps", "secrets",
                    "persistentvolumeclaims", "events", "serviceaccounts",
                ],
                verbs=["get", "list", "watch", "create", "update", "patch", "delete"],
            ),
            client.V1PolicyRule(
                api_groups=["apps"],
                resources=[
                    "deployments", "replicasets", "statefulsets", "daemonsets",
                ],
                verbs=["get", "list", "watch", "create", "update", "patch", "delete"],
            ),
            client.V1PolicyRule(
                api_groups=["batch"],
                resources=["jobs", "cronjobs"],
                verbs=["get", "list", "watch", "create", "update", "patch", "delete"],
            ),
            client.V1PolicyRule(
                api_groups=["networking.k8s.io"],
                resources=["ingresses", "networkpolicies"],
                verbs=["get", "list", "watch", "create", "update", "patch", "delete"],
            ),
            client.V1PolicyRule(
                api_groups=["rbac.authorization.k8s.io"],
                resources=["roles", "rolebindings"],
                verbs=["get", "list", "watch", "create", "update", "patch", "delete"],
            ),
            client.V1PolicyRule(
                api_groups=[""],
                resources=["resourcequotas", "limitranges"],
                verbs=["get", "list", "watch"],
            ),
        ],
    )
    k8s.rbac().create_namespaced_role(namespace=namespace, body=role)

    binding = client.V1RoleBinding(
        metadata=client.V1ObjectMeta(name=sa_name, namespace=namespace),
        subjects=[client.RbacV1Subject(kind="ServiceAccount", name=sa_name, namespace=namespace)],
        role_ref=client.V1RoleRef(
            api_group="rbac.authorization.k8s.io",
            kind="Role",
            name=sa_name,
        ),
    )
    k8s.rbac().create_namespaced_role_binding(namespace=namespace, body=binding)

    # Cluster-level read-only binding so the player can `kubectl get nodes/namespaces/storageclasses`
    k8s.rbac().create_cluster_role_binding(
        body=client.V1ClusterRoleBinding(
            metadata=client.V1ObjectMeta(
                name=f"maydaylabs-player-{session_id}",
                labels={"maydaylabs-session": session_id},
            ),
            subjects=[client.RbacV1Subject(
                kind="ServiceAccount",
                name=sa_name,
                namespace=namespace,
            )],
            role_ref=client.V1RoleRef(
                api_group="rbac.authorization.k8s.io",
                kind="ClusterRole",
                name="maydaylabs-player-viewer",
            ),
        )
    )


async def create_session(level_id: str, client_ip: str) -> SessionStatus:
    session_id = uuid.uuid4().hex[:8]
    ns = _session_ns(session_id)
    now = datetime.now(timezone.utc)
    expires_at = datetime.fromtimestamp(now.timestamp() + settings.session_ttl_seconds, tz=timezone.utc)

    # Check + increment rate limit counters
    await rate_limit.check_and_increment(level_id, client_ip)

    try:
        # Create namespace with PSS baseline enforcement
        _assert_maydaylabs_ns(ns)
        k8s.create_namespace(ns, labels={
            "pod-security.kubernetes.io/enforce": "privileged",
            "maydaylabs-session": session_id,
            "maydaylabs-level": level_id,
        })

        # Bind the backend SA into this namespace (ClusterRole + RoleBinding pattern)
        # Must happen before _apply_namespace_quotas — the RoleBinding is what grants
        # the backend SA permission to create resourcequotas in this namespace.
        _bind_backend_to_namespace(ns)

        # Apply ResourceQuota and LimitRange
        _apply_namespace_quotas(ns)

        # Create engine SA + cluster-wide binding (engine pod needs cross-ns resource access)
        _bind_engine_to_session(session_id, ns)

        # Create player RBAC
        _apply_session_rbac(session_id, ns)

        # Apply broken.yaml (with namespace substituted)
        level_dir = _find_level_dir(level_id)
        if level_dir:
            broken_yaml = level_dir / "broken.yaml"
            if broken_yaml.exists():
                raw = broken_yaml.read_text()
                subst = _substitute_namespace(raw, session_id)
                for doc in yaml.safe_load_all(subst):
                    if doc:
                        k8s.apply_manifest_dict(ns, doc)

        # Create ConfigMap with level files so the shell pod has them at ~/level/
        level_cm = None
        if level_dir:
            level_cm = _create_level_configmap(ns, level_id, level_dir, session_id)

        # Launch engine and shell pods
        k8s.create_pod(ns, _build_engine_pod(session_id, level_id))
        k8s.create_pod(ns, _build_shell_pod(session_id, level_id, level_cm))

    except Exception:
        # Roll back namespace and counters on any failure
        k8s.delete_namespace(ns)
        await rate_limit.decrement(level_id, client_ip)
        raise

    session = SessionStatus(
        session_id=session_id,
        level=level_id,
        namespace=ns,
        status="provisioning",
        expires_at=expires_at,
        created_at=now,
        client_ip=client_ip,
    )
    _sessions[session_id] = session

    # Schedule hard-cap expiry
    asyncio.create_task(_expire_after(session_id, settings.session_ttl_seconds))

    return session


async def _expire_after(session_id: str, delay: int) -> None:
    await asyncio.sleep(delay)
    await delete_session(session_id)


async def delete_session(session_id: str) -> None:
    session = _sessions.pop(session_id, None)
    if session is None:
        return
    _assert_maydaylabs_ns(session.namespace)
    # ClusterRoleBindings are cluster-scoped and not deleted by namespace deletion
    for crb in (f"maydaylabs-engine-{session_id}", f"maydaylabs-player-{session_id}"):
        try:
            k8s.rbac().delete_cluster_role_binding(crb)
        except Exception:
            pass
    k8s.delete_namespace(session.namespace)
    await rate_limit.decrement(session.level, session.client_ip)


def get_session(session_id: str) -> SessionStatus | None:
    session = _sessions.get(session_id)
    if session is None:
        return None

    # Update status based on pod readiness
    engine_phase = k8s.get_pod_phase(session.namespace, f"engine-{session_id}")
    if engine_phase == "Running":
        session.status = "ready"
    elif engine_phase in ("Succeeded", "Failed"):
        session.status = "expired"
    elif engine_phase is None and session.status == "ready":
        # Pod was running but is now gone — treat as expired.
        # None during "provisioning" just means the pod isn't visible yet.
        session.status = "expired"
    return session


def _apply_namespace_quotas(namespace: str) -> None:
    _assert_maydaylabs_ns(namespace)
    quota = client.V1ResourceQuota(
        metadata=client.V1ObjectMeta(name="maydaylabs-quota", namespace=namespace),
        spec=client.V1ResourceQuotaSpec(
            hard={
                "pods": "15",
                "requests.cpu": "1500m",
                "requests.memory": "2Gi",
                "limits.cpu": "5",
                "limits.memory": "5Gi",
            }
        ),
    )
    k8s.core().create_namespaced_resource_quota(namespace=namespace, body=quota)

    limit_range = client.V1LimitRange(
        metadata=client.V1ObjectMeta(name="maydaylabs-limits", namespace=namespace),
        spec=client.V1LimitRangeSpec(
            limits=[
                client.V1LimitRangeItem(
                    type="Container",
                    default={"cpu": "200m", "memory": "192Mi"},
                    default_request={"cpu": "50m", "memory": "64Mi"},
                    max={"cpu": "500m", "memory": "512Mi"},
                )
            ]
        ),
    )
    k8s.core().create_namespaced_limit_range(namespace=namespace, body=limit_range)
