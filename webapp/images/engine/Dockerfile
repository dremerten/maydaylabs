FROM python:3.14.5-alpine3.23

RUN apk upgrade --no-cache && apk add --no-cache curl bash jq ca-certificates \
    && KUBECTL_VERSION=$(curl -sSL https://dl.k8s.io/release/stable.txt) \
    && curl -sSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
       -o /usr/local/bin/kubectl \
    && chmod +x /usr/local/bin/kubectl

RUN pip install --no-cache-dir --upgrade pip wheel

RUN adduser -u 1000 -D -s /bin/bash k8squest

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY engine/ ./engine/
COPY worlds/ ./worlds/
RUN chown -R k8squest:k8squest /app

USER k8squest
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

CMD ["sleep", "infinity"]
