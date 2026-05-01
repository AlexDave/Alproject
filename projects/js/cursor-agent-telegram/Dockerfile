# syntax=docker/dockerfile:1
# Запуск на той же машине, где открыт Cursor: CDP_URL=http://host.docker.internal:9222 (Windows/Mac).
# Если контейнер стартует раньше Cursor — задайте AGENT_SKIP_CDP_PROBE=1 (проверка CDP при входе отключится).
FROM public.ecr.aws/docker/library/node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build

FROM public.ecr.aws/docker/library/node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
