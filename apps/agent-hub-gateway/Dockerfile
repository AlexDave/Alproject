# syntax=docker/dockerfile:1
# Контекст — корень репозитория.
FROM public.ecr.aws/docker/library/node:20-alpine AS base
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
COPY apps/portal/package.json ./apps/portal/
COPY apps/agent-hub-gateway/package.json ./apps/agent-hub-gateway/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci

FROM base AS builder
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/agent-hub-gateway ./apps/agent-hub-gateway
RUN npm run build -w @alproject/agent-hub-gateway

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs
COPY apps/agent-hub-gateway/package.json ./
COPY --from=builder /app/apps/agent-hub-gateway/dist ./dist
RUN npm install --omit=dev
USER nodejs
EXPOSE 3010
ENV PORT=3010
WORKDIR /app
CMD ["node", "dist/index.js"]
