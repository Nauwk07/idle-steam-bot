# ── Stage 1 : Build ──
FROM node:24-alpine AS builder

WORKDIR /app

# Manifests d'abord pour maximiser le cache Docker.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

RUN npm run build

# ── Stage 2 : Production ──
FROM node:24-alpine AS runner

RUN addgroup -S idle && adduser -S idle -G idle

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts

RUN mkdir -p /app/data /app/logs && chown -R idle:idle /app

USER idle

# Bot Discord gateway-only : pas de port exposé.
CMD ["node", "dist/index.js"]
