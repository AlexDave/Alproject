# syntax=docker/dockerfile:1
# Только граф портала + общие пакеты (без projects/js/*).
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
COPY apps/portal ./apps/portal
COPY packages/shared ./packages/shared
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @alproject/portal

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/apps/portal/public ./apps/portal/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/portal/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/portal/.next/static ./apps/portal/.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/portal/server.js"]
