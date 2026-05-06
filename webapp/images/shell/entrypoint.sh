#!/bin/bash
# Configure kubectl with the in-cluster service account, then start ttyd so the
# browser tab gets a real PTY — not a JavaScript relay.

SA_DIR="/var/run/secrets/kubernetes.io/serviceaccount"
KUBECONFIG_PATH="/tmp/kubeconfig"

if [ -f "${SA_DIR}/token" ]; then
  TOKEN=$(cat "${SA_DIR}/token")
  SERVER="https://${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT_HTTPS}"

  kubectl config --kubeconfig="${KUBECONFIG_PATH}" set-cluster in-cluster \
    --server="${SERVER}" \
    --certificate-authority="${SA_DIR}/ca.crt" >/dev/null 2>&1

  kubectl config --kubeconfig="${KUBECONFIG_PATH}" set-credentials player \
    --token="${TOKEN}" >/dev/null 2>&1

  kubectl config --kubeconfig="${KUBECONFIG_PATH}" set-context default \
    --cluster=in-cluster \
    --user=player \
    --namespace="${NAMESPACE:-default}" >/dev/null 2>&1

  kubectl config --kubeconfig="${KUBECONFIG_PATH}" use-context default >/dev/null 2>&1
  export KUBECONFIG="${KUBECONFIG_PATH}"
fi

# Home dir is a writable emptyDir — seed .bashrc from the baked template
[ ! -f /home/k8squest/.bashrc ] && cp /etc/k8squest/bashrc /home/k8squest/.bashrc

export TERM=xterm-256color
export HISTFILE=/home/k8squest/.bash_history
export K9S_CONFIG_DIR=/home/k8squest/.k9s
export XDG_CONFIG_HOME=/home/k8squest/.config
export XDG_STATE_HOME=/home/k8squest/.local/state
export XDG_CACHE_HOME=/home/k8squest/.cache

# ttyd base-path must match the proxy route the backend exposes:
#   https://<host>/shell/<session_id>/
TTYD_BASE="/shell/${SESSION_ID:-local}/"

exec ttyd \
  --port 7681 \
  --writable \
  --base-path "${TTYD_BASE}" \
  bash -l
