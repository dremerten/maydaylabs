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

_NETWORK_POLICY_TEMPLATE = """
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: isolate-session
  namespace: SESSION_NS
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector: {}
  egress:
    - to:
        - podSelector: {}
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    - ports:
        - protocol: TCP
          port: 6443
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: maydaylabs-system
          podSelector:
            matchLabels:
              app: maydaylabs-api
      ports:
        - protocol: TCP
          port: 8000
"""

# In-memory session map: session_id → SessionStatus
# Redis is used for rate limiting; this dict is the fast path for status lookups.
_sessions: dict[str, SessionStatus] = {}

# Module-level redis reference wired in at startup for TTL-expiry flush path.
_redis = None


def set_redis(redis_client) -> None:
    global _redis
    _redis = redis_client


def _make_namespace(session_id: str, player_name: str, level_id: str) -> str:
    safe_name = re.sub(r'[^a-z0-9]+', '-', player_name.lower().strip())[:10].strip('-') or "player"
    m = re.match(r'(level-\d+)', level_id)
    safe_level = m.group(1) if m else re.sub(r'[^a-z0-9]+', '-', level_id)[:10].strip('-')
    return f"{NAMESPACE_PREFIX}{safe_name}-{safe_level}-{session_id[:6]}"


def _assert_maydaylabs_ns(namespace: str) -> None:
    """Raise if namespace is not a maydaylabs-* namespace — hard safety guard."""
    if not namespace.startswith(NAMESPACE_PREFIX):
        raise ValueError(
            f"SAFETY: refusing to touch namespace '{namespace}' — "
            f"only '{NAMESPACE_PREFIX}*' namespaces are allowed"
        )


def _substitute_namespace(text: str, ns: str) -> str:
    """Replace 'k8squest' placeholder in manifest templates with the session namespace."""
    return text.replace("k8squest", ns)


def _find_level_dir(level_id: str) -> Path | None:
    for match in _WORLDS_ROOT.rglob(level_id):
        if match.is_dir():
            return match
    return None


def _create_level_configmap(namespace: str, level_id: str, level_dir: Path, ns: str) -> str:
    """Create a ConfigMap with all level files; return the ConfigMap name."""
    cm_name = f"level-files-{level_id}"
    data: dict[str, str] = {}
    for f in sorted(level_dir.iterdir()):
        if f.is_file():
            try:
                content = f.read_text(errors="replace")
                data[f.name] = _substitute_namespace(content, ns)
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


def _build_engine_pod(session_id: str, ns: str, level_id: str, progress_json: str | None = None) -> client.V1Pod:
    env_vars = [
        client.V1EnvVar(name="K8SQUEST_NAMESPACE", value=ns),
        client.V1EnvVar(name="K8SQUEST_WEB", value="true"),
        client.V1EnvVar(name="K8SQUEST_LEVEL", value=level_id),
        client.V1EnvVar(name="NAMESPACE", value=ns),
        client.V1EnvVar(name="K8SQUEST_SESSION_ID", value=session_id),
        client.V1EnvVar(
            name="K8SQUEST_API_URL",
            value="http://maydaylabs-api.maydaylabs-system.svc.cluster.local:8000",
        ),
    ]
    if progress_json:
        env_vars.append(client.V1EnvVar(name="K8SQUEST_INITIAL_PROGRESS", value=progress_json))

    return client.V1Pod(
        metadata=client.V1ObjectMeta(
            name=f"engine-{session_id}",
            namespace=ns,
            labels={"app": "maydaylabs-engine", "session": session_id, "component": "engine"},
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
                    image_pull_policy="Always",
                    stdin=True,
                    tty=True,
                    env=env_vars,
                    security_context=client.V1SecurityContext(
                        allow_privilege_escalation=False,
                        capabilities=client.V1Capabilities(drop=["ALL"]),
                    ),
                    resources=client.V1ResourceRequirements(
                        requests={"cpu": "100m", "memory": "128Mi"},
                        limits={"cpu": "250m", "memory": "256Mi"},
                    ),
                    liveness_probe=client.V1Probe(
                        _exec=client.V1ExecAction(command=["/bin/true"]),
                        initial_delay_seconds=5,
                        period_seconds=30,
                        failure_threshold=3,
                    ),
                )
            ],
            volumes=[],
        ),
    )


def _build_shell_pod(session_id: str, ns: str, level_id: str, level_cm: str | None = None) -> client.V1Pod:

    volume_mounts = [
        client.V1VolumeMount(name="tmp", mount_path="/tmp"),
        client.V1VolumeMount(name="home", mount_path="/home/k8squest"),
    ]
    volumes = [
        client.V1Volume(name="tmp", empty_dir=client.V1EmptyDirVolumeSource()),
        client.V1Volume(name="home", empty_dir=client.V1EmptyDirVolumeSource()),
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
            image_pull_policy="Always",
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
            ),
            containers=[
                client.V1Container(
                    name="shell",
                    image=settings.shell_image,
                    image_pull_policy="Always",
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
                    readiness_probe=client.V1Probe(
                        tcp_socket=client.V1TCPSocketAction(port=7681),
                        initial_delay_seconds=8,
                        period_seconds=5,
                        failure_threshold=6,
                    ),
                    # No liveness probe — with restartPolicy=Never, a failed liveness probe
                    # terminates the container permanently. The NetworkPolicy's ingress rule
                    # can block the kubelet's TCP probe on port 7681, causing spurious failures
                    # that would kill the container and drop the player's exec session.
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
                api_groups=["autoscaling"],
                resources=["horizontalpodautoscalers"],
                verbs=["get", "list", "watch", "create", "update", "patch", "delete"],
            ),
            client.V1PolicyRule(
                api_groups=["policy"],
                resources=["poddisruptionbudgets"],
                verbs=["get", "list", "watch", "create", "update", "patch", "delete"],
            ),
            client.V1PolicyRule(
                api_groups=["events.k8s.io"],
                resources=["events"],
                verbs=["get", "list", "watch"],
            ),
            client.V1PolicyRule(
                api_groups=["discovery.k8s.io"],
                resources=["endpointslices"],
                verbs=["get", "list", "watch"],
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

    # Cluster-level read-only binding so the player can `kubectl get namespaces/storageclasses`
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


def _apply_network_policy(namespace: str) -> None:
    _assert_maydaylabs_ns(namespace)
    raw = _NETWORK_POLICY_TEMPLATE.replace("SESSION_NS", namespace)
    doc = yaml.safe_load(raw)
    k8s.apply_manifest_dict(namespace, doc)


def _bind_backend_to_extra_namespace(namespace: str, session_id: str) -> None:
    """Bind the backend SA to maydaylabs-backend-default-ns ClusterRole in an arbitrary namespace.

    Used for levels where broken.yaml creates resources outside the session namespace
    (e.g. level-10 creates pods/services in 'default', level-27 creates them in 'backend-ns').
    Does NOT call _assert_maydaylabs_ns — this is intentionally cross-namespace.
    The RoleBinding carries a session label so it can be found and deleted at teardown.
    """
    binding = client.V1RoleBinding(
        metadata=client.V1ObjectMeta(
            name=f"maydaylabs-backend-{session_id}",
            namespace=namespace,
            labels={"maydaylabs-session": session_id},
        ),
        subjects=[client.RbacV1Subject(
            kind="ServiceAccount",
            name="maydaylabs-backend",
            namespace="maydaylabs-system",
        )],
        role_ref=client.V1RoleRef(
            api_group="rbac.authorization.k8s.io",
            kind="ClusterRole",
            name="maydaylabs-backend-default-ns",
        ),
    )
    k8s.rbac().create_namespaced_role_binding(namespace=namespace, body=binding)


def _bind_player_to_extra_namespace(session_id: str, player_sa_ns: str, target_namespace: str) -> None:
    """Bind the player SA to maydaylabs-player-default-ns ClusterRole in an arbitrary namespace.

    Used alongside _bind_backend_to_extra_namespace so the player shell pod can also
    interact with resources in non-session namespaces (e.g. delete from default in level-10,
    or read/write backend-ns in level-27).
    Does NOT call _assert_maydaylabs_ns.
    """
    sa_name = f"maydaylabs-player-{session_id}"
    binding = client.V1RoleBinding(
        metadata=client.V1ObjectMeta(
            name=f"maydaylabs-player-{session_id}",
            namespace=target_namespace,
            labels={"maydaylabs-session": session_id},
        ),
        subjects=[client.RbacV1Subject(
            kind="ServiceAccount",
            name=sa_name,
            namespace=player_sa_ns,
        )],
        role_ref=client.V1RoleRef(
            api_group="rbac.authorization.k8s.io",
            kind="ClusterRole",
            name="maydaylabs-player-default-ns",
        ),
    )
    k8s.rbac().create_namespaced_role_binding(namespace=target_namespace, body=binding)


async def create_session(level_id: str, user_sub: str, player_name: str = "explorer", progress: dict | None = None) -> SessionStatus:
    # Seed player_name so the engine skips the interactive CLI name prompt.
    if progress is None:
        progress = {
            "total_xp": 0,
            "completed_levels": [],
            "current_world": "world-1-basics",
            "current_level": None,
            "player_name": player_name,
        }
    elif progress.get("player_name", "Padawan") == "Padawan":
        progress = {**progress, "player_name": player_name}

    session_id = uuid.uuid4().hex[:8]
    ns = _make_namespace(session_id, player_name, level_id)
    now = datetime.now(timezone.utc)
    expires_at = datetime.fromtimestamp(now.timestamp() + settings.session_ttl_seconds, tz=timezone.utc)

    # Check per-user session limit
    user_active = sum(1 for s in _sessions.values() if s.user_sub == user_sub)
    if user_active >= settings.max_sessions_per_user:
        from rate_limit import RateLimitExceeded
        raise RateLimitExceeded(f"You already have {settings.max_sessions_per_user} active session(s). Close it first.")

    # Check + increment rate limit counters (total and per-level only)
    await rate_limit.check_and_increment(level_id, user_sub)

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
        _apply_namespace_quotas(ns, level_id)

        # Create engine SA + cluster-wide binding (engine pod needs cross-ns resource access)
        _bind_engine_to_session(session_id, ns)

        # Create player RBAC
        _apply_session_rbac(session_id, ns)

        # Apply per-session NetworkPolicy (blocks internet egress, allows intra-ns + DNS + k8s API)
        _apply_network_policy(ns)

        # Level-specific extra-namespace bindings.
        # These must be created BEFORE applying broken.yaml so the backend SA has permission
        # to create resources in the target namespace.
        if level_id == "level-10-namespace":
            # broken.yaml places a Pod and Service in 'default' (intentionally wrong namespace).
            # Bind backend SA first so it has permission to delete + poll in 'default'.
            _bind_backend_to_extra_namespace("default", session_id)
            # Pre-delete any orphaned resources from a previous session that wasn't cleaned up —
            # these have fixed names so a 409 would abort session creation otherwise.
            for _pod in ("client-app",):
                try:
                    k8s.core().delete_namespaced_pod(_pod, "default")
                except Exception:
                    pass
                k8s.wait_for_pod_deleted("default", _pod)
            for _svc in ("backend-service",):
                try:
                    k8s.core().delete_namespaced_service(_svc, "default")
                except Exception:
                    pass
            _bind_player_to_extra_namespace(session_id, ns, "default")
        elif level_id == "level-27-crossnamespace":
            # broken.yaml creates the 'backend-ns' namespace and places a Pod + Service there.
            # The namespace itself is created by create_from_dict (cluster-scoped; already
            # permitted by maydaylabs-backend-cluster). We need to bind both SAs into it
            # so resources can be created and the player can manage them.
            # We use a best-effort approach: the namespace may not exist yet when we run
            # create_from_dict, so we create the namespace explicitly first, then bind.
            k8s.create_namespace("backend-ns", labels={"maydaylabs-session": session_id})
            _bind_backend_to_extra_namespace("backend-ns", session_id)
            _bind_player_to_extra_namespace(session_id, ns, "backend-ns")

        # Apply broken.yaml (with namespace substituted)
        level_dir = _find_level_dir(level_id)
        if level_dir:
            broken_yaml = level_dir / "broken.yaml"
            if broken_yaml.exists():
                raw = broken_yaml.read_text()
                subst = _substitute_namespace(raw, ns)
                for doc in yaml.safe_load_all(subst):
                    if doc:
                        # Skip Namespace docs for level-27 — backend-ns is pre-created
                        # above so the bindings can be established before resources land.
                        if level_id == "level-27-crossnamespace" and doc.get("kind") == "Namespace":
                            continue
                        k8s.apply_manifest_dict(ns, doc)

        # Create ConfigMap with level files so the shell pod has them at ~/level/
        level_cm = None
        if level_dir:
            level_cm = _create_level_configmap(ns, level_id, level_dir, ns)

        # Launch engine and shell pods
        progress_json = json.dumps(progress) if progress else None
        k8s.create_pod(ns, _build_engine_pod(session_id, ns, level_id, progress_json))
        k8s.create_pod(ns, _build_shell_pod(session_id, ns, level_id, level_cm))

    except Exception:
        # Roll back namespace and counters on any failure
        k8s.delete_namespace(ns)
        # For level-27, also clean up the pre-created backend-ns
        if level_id == "level-27-crossnamespace":
            k8s.delete_namespace("backend-ns")
        await rate_limit.decrement(level_id, user_sub)
        raise

    session = SessionStatus(
        session_id=session_id,
        level=level_id,
        namespace=ns,
        status="provisioning",
        expires_at=expires_at,
        created_at=now,
        user_sub=user_sub,
    )
    _sessions[session_id] = session

    # Schedule hard-cap expiry
    asyncio.create_task(_expire_after(session_id, settings.session_ttl_seconds))

    return session


async def _expire_after(session_id: str, delay: int) -> None:
    await asyncio.sleep(delay)
    # Flush engine progress to Redis before tearing down the session namespace.
    # Uses the module-level _redis ref wired in by set_redis() at startup.
    if _redis is not None:
        sess = _sessions.get(session_id)
        if sess is not None and sess.user_sub and sess.status == "ready":
            try:
                loop = asyncio.get_event_loop()
                content = await loop.run_in_executor(
                    None,
                    lambda: k8s.exec_in_pod(sess.namespace, f"engine-{session_id}", ["cat", "/app/progress.json"]),
                )
                if content and content.strip():
                    data = json.loads(content)
                    if "completed_levels" in data and "total_xp" in data:
                        await _redis.set(f"progress:{sess.user_sub}", json.dumps(data))
            except Exception:
                pass
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

    # Clean up extra-namespace RoleBindings created for levels that operate outside
    # the session namespace (level-10: default, level-27: backend-ns).
    if session.level == "level-10-namespace":
        for rb_name in (f"maydaylabs-backend-{session_id}", f"maydaylabs-player-{session_id}"):
            try:
                k8s.rbac().delete_namespaced_role_binding(rb_name, "default")
            except Exception:
                pass
        # Delete the pod and service placed in 'default' by broken.yaml — they are not
        # cleaned up by namespace deletion (which only removes the session namespace).
        for pod_name in ("client-app",):
            try:
                k8s.core().delete_namespaced_pod(pod_name, "default")
            except Exception:
                pass
        for svc_name in ("backend-service",):
            try:
                k8s.core().delete_namespaced_service(svc_name, "default")
            except Exception:
                pass
    elif session.level == "level-27-crossnamespace":
        for rb_name in (f"maydaylabs-backend-{session_id}", f"maydaylabs-player-{session_id}"):
            try:
                k8s.rbac().delete_namespaced_role_binding(rb_name, "backend-ns")
            except Exception:
                pass
        # Delete the backend-ns namespace — it is not a maydaylabs-* namespace so
        # _assert_maydaylabs_ns cannot be used here; call k8s.delete_namespace directly.
        try:
            k8s.delete_namespace("backend-ns")
        except Exception:
            pass

    k8s.delete_namespace(session.namespace)
    await rate_limit.decrement(session.level, session.user_sub)


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


def _apply_namespace_quotas(namespace: str, level_id: str = "") -> None:
    _assert_maydaylabs_ns(namespace)

    if level_id == "level-4-pending":
        # This level teaches that pods stay Pending when resource requests exceed
        # node capacity. The broken pod requests 999Gi/999 CPU — accepted by the API
        # only when no LimitRange injects lower default limits and no ResourceQuota
        # caps total requests. Only a pod-count quota is applied here.
        k8s.core().create_namespaced_resource_quota(
            namespace=namespace,
            body=client.V1ResourceQuota(
                metadata=client.V1ObjectMeta(name="maydaylabs-quota", namespace=namespace),
                spec=client.V1ResourceQuotaSpec(hard={"pods": "15"}),
            ),
        )
        return

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
