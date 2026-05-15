# Stage 1: fetch binaries — isolated so download deps don't land in the final image
FROM alpine:3.23 AS downloader

RUN apk add --no-cache curl ca-certificates

# kubectl
RUN KUBECTL_VERSION=$(curl -sSL https://dl.k8s.io/release/stable.txt) \
    && curl -sSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
       -o /kubectl \
    && chmod +x /kubectl

# k9s — full-terminal Kubernetes UI
ARG K9S_VERSION=v0.50.18
RUN curl -sSL "https://github.com/derailed/k9s/releases/download/${K9S_VERSION}/k9s_Linux_amd64.tar.gz" \
    | tar xzf - -C /tmp k9s \
    && mv /tmp/k9s /k9s \
    && chmod +x /k9s

# ttyd — web terminal daemon (serves a real PTY over HTTP/WebSocket)
ARG TTYD_VERSION=1.7.7
RUN curl -sSL "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64" \
    -o /ttyd \
    && chmod +x /ttyd

# kubectl-neat — strips noise from kubectl output, helps create clean YAML
ARG KUBECTL_NEAT_VERSION=v2.0.4
RUN curl -sSL "https://github.com/itaysk/kubectl-neat/releases/download/${KUBECTL_NEAT_VERSION}/kubectl-neat_linux_amd64.tar.gz" \
    | tar xzf - -C /tmp kubectl-neat \
    && mv /tmp/kubectl-neat /kubectl-neat \
    && chmod +x /kubectl-neat


# Stage 2: lean runtime image — non-root, read-only-safe
FROM alpine:3.23

COPY --from=downloader /kubectl       /usr/local/bin/kubectl
COPY --from=downloader /k9s           /usr/local/bin/k9s
COPY --from=downloader /ttyd          /usr/local/bin/ttyd
COPY --from=downloader /kubectl-neat  /usr/local/bin/kubectl-neat

RUN apk add --no-cache \
    bash \
    curl \
    jq \
    ca-certificates \
    bind-tools \
    iputils \
    vim \
    && adduser -u 1000 -D -s /bin/bash k8squest

RUN chmod 700 /root && \
    chmod 711 /home && \
    chmod o-rx /etc/shadow /etc/crontabs 2>/dev/null || true

# Store entrypoint and bashrc template outside /home/k8squest so an emptyDir
# overlay on the home directory (for write access) doesn't hide them.
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY bashrc /etc/k8squest/bashrc
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /home/k8squest \
    && chown k8squest:k8squest /home/k8squest

USER k8squest
WORKDIR /home/k8squest

EXPOSE 7681
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
