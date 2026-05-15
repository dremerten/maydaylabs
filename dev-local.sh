#!/usr/bin/env bash
# Local development deploy — builds images, pushes to in-cluster registry, deploys to local k3s.
# Turnkey: run once and access the UI at http://localhost:3000.
# Never pushes to any external registry.
# Usage: ./dev-local.sh
set -euo pipefail

# Use system docker (not colima)
export DOCKER_HOST="unix:///var/run/docker.sock"

LOCAL_REGISTRY="localhost:30500"
TAG="local"

# ── Config ────────────────────────────────────────────────────────────────────
if [[ ! -f ".env" ]]; then
  echo "ERROR: .env not found at repo root."
  exit 1
fi
set -a && source .env && set +a
if [[ -f ".env.local" ]]; then
  set -a && source .env.local && set +a
fi

KUBECONFIG="${HOME}/.kube/full-config"
export KUBECONFIG NAMESPACE

# Hardcoded context guard — never runs against staging or production
CONTEXT=$(kubectl config current-context)
if [[ "$CONTEXT" != "k3s-k8squest" ]]; then
  echo "ERROR: kubectl context is '$CONTEXT', expected 'k3s-k8squest'. Aborting."
  exit 1
fi
echo "✓ kubectl context: $CONTEXT"

# ── Namespaces ────────────────────────────────────────────────────────────────
echo ""
echo "── Ensuring namespaces ──────────────────────────────────────────────────"
kubectl get namespace maydaylabs-system &>/dev/null || kubectl create namespace maydaylabs-system
kubectl get namespace "$NAMESPACE"        &>/dev/null || kubectl create namespace "$NAMESPACE"

# ── Local registry ────────────────────────────────────────────────────────────
echo ""
echo "── Ensuring local registry ──────────────────────────────────────────────"
kubectl apply -f webapp/k8s/local-registry.yaml

# One-time: configure k3s containerd to pull from the local registry over HTTP.
# Required so pods can pull localhost:30500/... images without HTTPS.
REGISTRY_CFG="/etc/rancher/k3s/registries.yaml"
if ! sudo grep -q "localhost:30500" "$REGISTRY_CFG" 2>/dev/null; then
  echo "  configuring k3s containerd for local registry (one-time — requires restart) ..."
  sudo tee "$REGISTRY_CFG" > /dev/null <<'EOF'
mirrors:
  "localhost:30500":
    endpoint:
      - "http://localhost:30500"
EOF
  echo "  restarting k3s to apply registry config ..."
  sudo systemctl restart k3s
  echo "  waiting for k3s API to come back up ..."
  until kubectl get nodes &>/dev/null 2>&1; do sleep 2; done
  echo "  ✓ k3s restarted — registry config active"
else
  echo "  ✓ registry config already present"
fi

echo "  waiting for registry to be ready ..."
kubectl rollout status deployment/registry -n maydaylabs-system --timeout=90s
sleep 2
echo "  ✓ registry ready at $LOCAL_REGISTRY"

# ── Build ─────────────────────────────────────────────────────────────────────
echo ""
echo "── Building images ──────────────────────────────────────────────────────"
docker build -f webapp/images/backend/Dockerfile \
  -t "${LOCAL_REGISTRY}/maydaylabs-api:${TAG}" .
docker build -f webapp/images/frontend/Dockerfile \
  --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID}" \
  --build-arg NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL}" \
  --build-arg NEXT_PUBLIC_WS_URL="${NEXT_PUBLIC_WS_URL}" \
  -t "${LOCAL_REGISTRY}/maydaylabs-frontend:${TAG}" .
docker build -f webapp/images/engine/Dockerfile \
  -t "${LOCAL_REGISTRY}/maydaylabs-engine:${TAG}" .
docker build webapp/images/shell/ \
  -t "${LOCAL_REGISTRY}/maydaylabs-shell:${TAG}"

# ── Push to local registry ────────────────────────────────────────────────────
echo ""
echo "── Pushing images to local registry ($LOCAL_REGISTRY) ──────────────────"
for img in maydaylabs-api maydaylabs-frontend maydaylabs-engine maydaylabs-shell; do
  echo "  pushing ${img}:${TAG} ..."
  docker push "${LOCAL_REGISTRY}/${img}:${TAG}"
done

# ── Secrets ───────────────────────────────────────────────────────────────────
echo ""
echo "── Ensuring secrets ─────────────────────────────────────────────────────"
if ! kubectl get secret google-oauth -n "$NAMESPACE" &>/dev/null; then
  echo "  creating google-oauth secret from .env ..."
  kubectl create secret generic google-oauth \
    --from-literal=GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID}" \
    --from-literal=GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET}" \
    --from-literal=SESSION_SECRET_KEY="${SESSION_SECRET_KEY}" \
    -n "$NAMESPACE"
  echo "  ✓ google-oauth secret created"
else
  echo "  ✓ google-oauth secret already exists"
fi

# ── Apply manifests ───────────────────────────────────────────────────────────
echo ""
echo "── Applying manifests ───────────────────────────────────────────────────"
kubectl apply -f webapp/k8s/rbac-backend.yaml

export REGISTRY="$LOCAL_REGISTRY" TAG
envsubst < webapp/k8s/backend.yaml  | kubectl apply -f - -n "$NAMESPACE"
envsubst < webapp/k8s/frontend.yaml | kubectl apply -f - -n "$NAMESPACE"
envsubst < webapp/k8s/redis.yaml    | kubectl apply -f - -n "$NAMESPACE"

kubectl rollout restart deployment/maydaylabs-api deployment/maydaylabs-frontend -n "$NAMESPACE"
kubectl rollout status  deployment/maydaylabs-api      --timeout=120s -n "$NAMESPACE"
kubectl rollout status  deployment/maydaylabs-frontend --timeout=120s -n "$NAMESPACE"

# ── Port-forwards ─────────────────────────────────────────────────────────────
echo ""
echo "── Starting port-forwards ───────────────────────────────────────────────"
for port in 8000 3000; do
  existing=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [[ -n "$existing" ]]; then
    echo "  killing existing process on :$port (pid $existing)"
    kill "$existing" 2>/dev/null || true
    sleep 1
  fi
done

kubectl port-forward -n "$NAMESPACE" svc/maydaylabs-api      8000:8000 &>/tmp/pf-api.log &
echo $! > /tmp/pf-api.pid
kubectl port-forward -n "$NAMESPACE" svc/maydaylabs-frontend 3000:3000 &>/tmp/pf-frontend.log &
echo $! > /tmp/pf-frontend.pid

echo "  waiting for port-forwards to be ready ..."
sleep 3

if curl -sf http://localhost:8000/api/health &>/dev/null; then
  echo "  ✓ API reachable at http://localhost:8000"
else
  echo "  ✗ API not reachable — check /tmp/pf-api.log"
  cat /tmp/pf-api.log
fi

echo ""
echo "✓ Local deploy complete."
echo ""
echo "  UI  →  http://localhost:3000"
echo "  API →  http://localhost:8000/api/health"
echo ""
echo "  Port-forward logs: /tmp/pf-api.log  /tmp/pf-frontend.log"
echo "  To stop:  kill \$(cat /tmp/pf-api.pid) \$(cat /tmp/pf-frontend.pid)"
