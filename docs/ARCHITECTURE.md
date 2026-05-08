# MayDayLabs K8sQuest Architecture

MayDayLabs Presents K8sQuest is a browser-based Kubernetes learning platform. Each player gets a fully isolated Kubernetes namespace containing real workloads they can inspect and fix using `kubectl` — entirely in their browser, with no local installation required.

---

## High-Level Overview

```
Browser
  │
  ├── Tab 1: /play          ← Mission Control (objectives, hints, progress)
  └── Tab 2: /play/terminal ← Helm Station (full kubectl shell)
       │
       ▼
  Ingress (Gateway API)
       │
       ├──▶ Next.js Frontend     (static assets, page rendering)
       └──▶ FastAPI Backend       (session management, WebSocket bridge)
                 │
                 ▼
         Kubernetes API
                 │
         ┌───────┴────────┐
         │  Per-Session   │
         │  Namespace     │
         │  ─────────     │
         │  engine pod    │  ← game logic, hint system, validation
         │  shell pod     │  ← ttyd web terminal with kubectl access
         └────────────────┘
```

---

## Request Flow

1. The player opens the site in a browser.
2. All traffic enters through a **Gateway API** ingress controller, which routes requests to either the frontend or the backend based on path prefix.
3. The **Next.js frontend** serves the UI. It communicates with the backend exclusively via `/api/*` HTTP endpoints and `/ws/*` WebSocket connections.
4. The **FastAPI backend** handles session lifecycle and proxies terminal I/O to pods running inside the cluster.

---

## Session & Namespace Isolation

Every time a player launches a level, the backend provisions a brand-new, uniquely named Kubernetes namespace. This is the core isolation primitive.

### Namespace naming

Each namespace is derived from the player's chosen callsign, the selected level, and a short random hex token:

```
maydaylabs-{callsign}-{level-id}-{random}
```

No two active sessions share a namespace. The namespace and everything inside it are deleted when the session ends.

### What gets created per session

Inside each namespace, the backend provisions:

| Resource | Purpose |
|---|---|
| `engine` pod | Runs the game engine. Delivers objectives, progressive hints, and validates the player's solution |
| `shell` pod | Runs a web terminal (`ttyd`). The player's `kubectl` commands execute here |
| Level ConfigMap | Contains all level files (mission, broken manifests, hints) with the session namespace substituted in |
| Broken workloads | The intentionally misconfigured Kubernetes resources the player must fix |
| Player ServiceAccount | Scoped identity for the shell pod |
| Player Role + RoleBinding | Full CRUD on namespace-scoped resources within this session namespace only |
| Player ClusterRoleBinding | Read-only cluster-wide view (nodes, storage classes, metrics) |
| ResourceQuota | Caps CPU, memory, and object counts per namespace |
| NetworkPolicy | Blocks cross-session and cross-namespace traffic |

### Session lifetime

Sessions have a fixed TTL of 15 minutes. A session ends via one of three paths:

- **TTL expiry** — a background task deletes the namespace when time runs out
- **Tab close** — the shell tab sends a `DELETE` request with `keepalive: true` on `beforeunload`
- **Explicit end** — the player clicks the "✕ End Session" button

On deletion, the namespace (and all resources within it) is removed and rate-limit counters are decremented.

---

## Two-Tab Model

The player experience runs across two browser tabs opened simultaneously:

```
Tab 1 — Mission Control (/play)
  • Displays the level objective and context
  • Streams output from the engine pod via WebSocket
  • Shows the countdown timer and session status
  • Provides progressive hints on demand
  • Detects session expiry via polling (not WebSocket state)

Tab 2 — Helm Station (/play/terminal)
  • Full-screen web terminal rendered with xterm.js
  • Connects to the shell pod via WebSocket → kubectl exec bridge
  • Has kubectl pre-configured to the session namespace
  • Closing this tab triggers session cleanup
```

Both tabs connect over WebSocket to the backend, which bridges I/O to the respective pod via the Kubernetes exec API. Terminal resize events are forwarded as JSON frames on a dedicated exec channel.

---

## Backend Architecture

The backend is a single-replica FastAPI application. Sessions are held in memory — scaling beyond one replica would cause session lookup failures.

**Key modules:**

| Module | Responsibility |
|---|---|
| `session.py` | Full session lifecycle — create, poll, delete, TTL expiry |
| `terminal.py` | WebSocket ↔ pod exec bridge for both terminal types |
| `k8s_client.py` | Kubernetes API interactions |
| `rate_limit.py` | Redis-backed counters: global, per-level, per-IP |
| `levels.py` | Reads `mission.yaml` from each level directory |
| `config.py` | All tunables via environment variables |

**Rate limits** are enforced at three scopes using Redis counters:
- Total concurrent sessions across all players
- Concurrent sessions per level
- Concurrent sessions per source IP

---

## Security Layers

Security is enforced in depth across four layers. No single layer is relied upon exclusively.

### 1. Application guard

Before every Kubernetes write operation, the backend asserts the target namespace begins with the platform prefix. Any operation targeting a namespace outside this prefix is rejected at the application layer before reaching the Kubernetes API.

### 2. RBAC (Kubernetes)

The backend's own service account is bound to a ClusterRole via **namespaced RoleBindings only** — it has no cluster-wide write permissions. Player service accounts are similarly constrained: full CRUD within their session namespace, read-only view of cluster-level resources like nodes and storage classes.

A player cannot read or modify resources in another player's namespace, or in any system namespace.

### 3. Admission control (Kyverno)

Three admission policies enforce:
- **Namespace confinement** — pods may only be created in `maydaylabs-*` namespaces
- **Pod security** — containers must run as non-root, drop all Linux capabilities, and use read-only root filesystems where applicable
- **Cross-namespace isolation** — subjects in one session namespace cannot reference resources in another

### 4. NetworkPolicy

Every session namespace has a `NetworkPolicy` that denies all ingress and egress by default. Only the traffic paths required for the game to function are explicitly allowed. The backend namespace itself only accepts ingress from the ingress controller namespace.

each session namespace gets both a ResourceQuota and a LimitRange applied at creation time. Here's what's in place:

ResourceQuota (maydaylabs-quota)

Limit	Value
Max pods	15
CPU requests	1500m (1.5 cores)
Memory requests	2 GiB
CPU limits	5 cores
Memory limits	5 GiB
LimitRange (maydaylabs-limits) — applied per container

CPU	Memory
Default limit	200m	192 MiB
Default request	50m	64 MiB
Maximum allowed	500m	512 MiB
The LimitRange means any container that doesn't specify its own requests/limits automatically gets the defaults, so there are no unthrottled containers possible in a session namespace. The ResourceQuota caps the namespace ceiling.

---

## Game Content Structure

```
worlds/
└── world-N-name/
    └── level-N-topic/
        ├── mission.yaml     ← name, difficulty, XP value, concepts covered
        ├── broken.yaml      ← misconfigured resources applied at session start
        ├── validate.sh      ← script the engine runs to check the player's fix
        ├── hint-1.txt       ← observation hint (what to look at)
        ├── hint-2.txt       ← directional hint (what kind of fix is needed)
        ├── hint-3.txt       ← near-solution hint
        └── debrief.md       ← post-completion explanation and real-world context
```

All `broken.yaml` files use a `k8squest` namespace placeholder. At session creation, every occurrence is replaced with the actual session namespace before the resources are applied. This ensures broken workloads are always scoped to the correct isolated namespace.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js / React / TypeScript / Tailwind CSS |
| Terminal rendering | xterm.js |
| Backend | Python / FastAPI / uvicorn |
| Session state | In-process (single replica) |
| Rate limiting | Redis |
| Kubernetes client | kubernetes-python |
| Container images | Alpine-based (multi-stage builds) |
| Ingress | Gateway API |
| Admission control | Kyverno |
| Web terminal | ttyd |

---

## World Progression

50 levels across 5 worlds, each building on the previous:

| World | Topic Area | Levels |
|---|---|---|
| 1 | Core Kubernetes — Pods, Deployments, Labels, Namespaces | 1–10 |
| 2 | Deployments & Scaling — HPA, Probes, Rolling Updates, StatefulSets | 11–20 |
| 3 | Networking & Services — Services, DNS, Ingress, NetworkPolicy | 21–30 |
| 4 | Storage & Stateful Apps — PV/PVC, StorageClass, ConfigMaps, Secrets | 31–40 |
| 5 | Security & Production Ops — RBAC, ResourceQuotas, Taints, Chaos | 41–50 |
