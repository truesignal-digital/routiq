# Build context is the repo root (see docker-compose.yml).
FROM node:24-alpine
RUN corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile --filter @routiq/api...

COPY packages/contracts packages/contracts
COPY packages/domain packages/domain
COPY apps/api apps/api

ENV NODE_ENV=production
EXPOSE 3001
WORKDIR /app/apps/api
CMD ["pnpm", "exec", "tsx", "src/boot.ts"]
