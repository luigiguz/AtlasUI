# syntax=docker/dockerfile:1
# UI estática (Vite) servida por nginx. Build desde la raíz del repo:
#   docker build -f ui/Dockerfile --build-arg VITE_API_BASE_URL=https://api.tu-dominio.com -t atlas-ui .

FROM node:22-bookworm-slim AS build
WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx-ui.conf /etc/nginx/conf.d/default.conf
COPY deploy/docker-entrypoint-ui.sh /docker-entrypoint-ui.sh
RUN chmod +x /docker-entrypoint-ui.sh
COPY --from=build /app/ui/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
ENTRYPOINT ["/docker-entrypoint-ui.sh"]
