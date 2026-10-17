# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 make g++ git procps \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
COPY package.json ./
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
ENV HUSKY=0

FROM base AS development
COPY containers/dev.sh /usr/local/bin/tableslayer-dev
CMD ["bash", "/usr/local/bin/tableslayer-dev"]

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tableslayer/ui package && pnpm --filter @tableslayer/stage build
# Build directly: the existing Turbo deployment graph contains a migration task.
RUN pnpm --filter web build

FROM build AS release
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 BODY_SIZE_LIMIT=20M
WORKDIR /workspace/apps/web
CMD ["node", "build"]
