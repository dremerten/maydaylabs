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

  # ~/.kube/config symlink so k9s and standard tools find the kubeconfig
  mkdir -p /home/k8squest/.kube
  ln -sf /tmp/kubeconfig /home/k8squest/.kube/config

  # Seed empty plugins.yaml so k9s doesn't error on startup
  mkdir -p /home/k8squest/.k9s
  printf 'plugins: {}\n' > /home/k8squest/.k9s/plugins.yaml

  # Lock k9s active namespace to the session namespace
  mkdir -p /home/k8squest/.k9s/clusters/in-cluster/default
  cat > /home/k8squest/.k9s/clusters/in-cluster/default/config.yaml <<EOF
k9s:
  namespace:
    active: ${NAMESPACE:-default}
    favorites:
    - ${NAMESPACE:-default}
EOF
fi

# Home dir is a writable emptyDir — seed .bashrc and .bash_profile from baked templates.
# bash -l (login shell) reads .bash_profile, not .bashrc directly — .bash_profile must
# source .bashrc so the banner, PS1, and aliases are active from the first prompt.
[ ! -f /home/k8squest/.bashrc ] && cp /etc/k8squest/bashrc /home/k8squest/.bashrc
[ ! -f /home/k8squest/.bash_profile ] && printf '[[ -f ~/.bashrc ]] && . ~/.bashrc\n' > /home/k8squest/.bash_profile

export TERM=xterm-256color
export HISTFILE=/home/k8squest/.bash_history
export K9S_CONFIG_DIR=/home/k8squest/.k9s
export XDG_CONFIG_HOME=/home/k8squest/.config
export XDG_STATE_HOME=/home/k8squest/.local/state
export XDG_CACHE_HOME=/home/k8squest/.cache

# ttyd base-path must match the proxy route the backend exposes:
#   https://<host>/shell/<session_id>/
TTYD_BASE="/shell/${SESSION_ID:-local}/"

cd /home/k8squest

exec ttyd \
  --port 7681 \
  --writable \
  --base-path "${TTYD_BASE}" \
  bash -l
