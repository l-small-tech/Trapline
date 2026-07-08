# Trapline — ISP quality monitor.
#
# Run with host networking (see docker-compose.yml): the monitor must see the
# real LAN gateway and ISP first hop, not the Docker bridge.

# ---- Stage 1: install all deps + build the web UI ----------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY server/ server/
COPY web/ web/
RUN npm run build:web

# ---- Stage 2: production deps for the server workspace only ------------------
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server

# ---- Stage 3: runtime ---------------------------------------------------------
FROM node:24-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        iputils-ping \
        mtr-tiny \
        iproute2 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    TRAPLINE_DATA_DIR=/data

COPY --from=deps /app/ ./
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY server/ server/
COPY --from=build /app/web/dist web/dist

VOLUME /data
EXPOSE 8731

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch(\`http://127.0.0.1:\${process.env.TRAPLINE_PORT ?? 8731}/trapline/api/health\`).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "node_modules/.bin/tsx", "server/src/index.ts"]
