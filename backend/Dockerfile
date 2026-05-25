# syntax=docker/dockerfile:1
# API FastAPI (sin estáticos). La UI va en ui/Dockerfile o npm run build en el host.
# Build desde la raíz del repo:
#   docker build -f backend/Dockerfile -t atlas-api .
# Variables: ATLAS_API_ONLY=1, ATLAS_CORS_ORIGINS, ATLAS_SESSION_SECRET, etc.

FROM python:3.12-slim-bookworm AS runtime

LABEL org.opencontainers.image.title="Atlas API" \
      org.opencontainers.image.description="Atlas — API FastAPI (túneles Cloudflare Access TCP)"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    ATLAS_API_ONLY=1 \
    PYTHONPATH=/app/backend:/app

WORKDIR /app

ARG CLOUDFLARED_VERSION=2026.5.0
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gosu git \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) cf_arch=amd64 ;; \
      arm64) cf_arch=arm64 ;; \
      *) echo "Arquitectura no soportada: ${TARGETARCH}"; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${cf_arch}" \
      -o /usr/local/bin/cloudflared; \
    chmod +x /usr/local/bin/cloudflared; \
    cloudflared --version

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY ui/public/branding/ ./ui/public/branding/
COPY scripts/ ./scripts/

COPY backend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh \
    && useradd --create-home --shell /bin/bash --uid 1000 atlas \
    && chown -R atlas:atlas /app

USER root

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:8765/api/health" >/dev/null || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["python", "-m", "atlas_api", "--no-browser", "--host", "0.0.0.0", "--port", "8765"]
