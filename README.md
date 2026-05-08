# MayDayLabs presents K8sQuest

[![Kubernetes](https://img.shields.io/badge/kubernetes-learning-326CE5)]()
[![Browser Based](https://img.shields.io/badge/platform-browser-informational)]()
[![Levels](https://img.shields.io/badge/levels-50-success)]()

**Real life practical labs for solving production Kubernetes issues. Learn by Doing.**

K8sQuest is a browser-based Kubernetes learning platform. Each session provisions a fully isolated Kubernetes namespace with real broken workloads. Your job is to diagnose and fix them using `kubectl` — no installation required.

---

## How It Works

When you launch a level, the platform automatically provisions:

- A **dedicated Kubernetes namespace** scoped exclusively to your session
- An **engine pod** running the game — delivering your mission briefing, hints, and validating your fix
- A **shell pod** with a pre-configured `kubectl` terminal streamed live to your browser

Your session namespace is destroyed when the timer runs out, when you end the session, or when you close the terminal tab. Nothing persists. Nothing bleeds into another player's environment.

### Two-tab workflow

```
Tab 1 — Mission Control
  Your objectives, progressive hints, and validation feedback.
  The game engine runs here.

Tab 2 — Helm Station  
  Full kubectl shell. This is where you fix the cluster.
  Opens automatically when you launch a level.
```

---

## 50 Levels across 5 Worlds

| World | Topic | Levels | Difficulty |
|---|---|---|---|
| 1 | Core Kubernetes — Pods, Deployments, Labels, Namespaces | 1–10 | Beginner |
| 2 | Deployments & Scaling — HPA, Probes, Rolling Updates, StatefulSets | 11–20 | Intermediate |
| 3 | Networking & Services — Services, DNS, Ingress, NetworkPolicy | 21–30 | Intermediate |
| 4 | Storage & Stateful Apps — PV/PVC, StorageClass, ConfigMaps, Secrets | 31–40 | Advanced |
| 5 | Security & Production Ops — RBAC, ResourceQuotas, Taints, Chaos | 41–50 | Advanced |

Each level includes:
- A mission briefing explaining the scenario
- Up to 3 progressive hints (observation → direction → near-solution)
- Automated validation that checks your actual cluster state
- A post-mission debrief covering the real-world context and mental model

---

## Features

- **No setup** — runs entirely in your browser, no local tools required
- **Real isolation** — every session gets its own Kubernetes namespace; players cannot see or affect each other
- **Real kubectl** — no simulations, no mocked APIs; commands run against actual cluster resources
- **Progressive hints** — ask for help only when you need it; each hint reveals a bit more
- **Post-mission debriefs** — understand *why* your fix worked and how it maps to production incidents
- **Progress tracking** — download your `progress.json` at any time from the play page to save your XP and completed levels; upload it on the home screen to resume exactly where you left off on any device

---

## Session Details

- Sessions last **15 minutes**
- Each session is isolated in its own namespace with resource quotas enforced
- Rate limits apply per IP and globally to ensure fair access for all players
- All session resources are automatically cleaned up on expiry

---

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a full breakdown of how the platform works — request flow, namespace isolation, security layers, and the two-tab model.

---

## Contributing

Want to contribute a level or report a bug? Open an issue or pull request on GitHub.

See [docs/contributing.md](docs/contributing.md) for the level format and contribution guidelines.
