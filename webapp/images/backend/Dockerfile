# Builder: compile C extensions (uvloop, httptools) then discard build tools
FROM python:3.14-alpine3.21 AS builder
RUN apk upgrade --no-cache && apk add --no-cache gcc musl-dev libffi-dev
RUN pip install --no-cache-dir --upgrade pip wheel
COPY webapp/backend/requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.14-alpine3.21
RUN apk upgrade --no-cache && apk add --no-cache ca-certificates

COPY --from=builder /install /usr/local

RUN adduser -u 1000 -D k8squest
WORKDIR /app

COPY webapp/backend/ ./
COPY worlds/ /app/worlds/
RUN chown -R k8squest:k8squest /app

USER k8squest
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1
ENV K8SQUEST_WORLDS_PATH=/app/worlds

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
