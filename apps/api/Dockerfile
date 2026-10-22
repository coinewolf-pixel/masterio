# Сборка API из корня monorepo:  docker build -f apps/api/Dockerfile -t masterio-api .
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /repo

# Сначала только манифесты — кэш слоёв зависимостей
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @masterio/api...

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @masterio/shared build && pnpm --filter @masterio/api build

ENV NODE_ENV=production
WORKDIR /repo/apps/api
EXPOSE 3000
# Миграции применяются при каждом запуске (идемпотентно), затем старт сервера
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
