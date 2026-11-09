# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 make g++ git procps \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
COPY package.json ./
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
ENV HUSKY=0

# Rust is only for rebuilding packages/stage/sim; the compiled weather_sim.wasm is committed,
# so the build and release stages below never need it
FROM base AS development
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH
COPY packages/stage/sim/rust-toolchain.toml /tmp/rust-toolchain.toml
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && toolchain=$(sed -n 's/^channel *= *"\(.*\)"/\1/p' /tmp/rust-toolchain.toml) \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path --profile minimal --default-toolchain "$toolchain" -t wasm32-unknown-unknown \
    && rm /tmp/rust-toolchain.toml
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
CMD ["sh", "-c", "node scripts/migrate.js && exec node build"]
