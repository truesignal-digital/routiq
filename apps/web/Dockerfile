# Build context is the repo root (see docker-compose.demo.yml).
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile --filter @routiq/web...

# Every package tsconfig extends this; vite resolves it during transform.
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/domain packages/domain
COPY apps/web apps/web

# Invoked through vite rather than the package's "build" script so the image
# builds on both sides of the CI branch that adds that script.
RUN pnpm --filter @routiq/web exec vite build

FROM nginx:1.29-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
