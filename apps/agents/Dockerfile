# LiveKit Agents Dockerfile — adapted for pnpm workspace monorepo
# The lk CLI sends only apps/agents/ as build context, so we cannot
# COPY the root lockfile. We install from package.json alone.
# syntax=docker/dockerfile:1

ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update -qq && apt-get install --no-install-recommends -y ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10

# --- Build stage ---
FROM base AS build
WORKDIR /app

# Copy package.json only (no lockfile in monorepo workspace)
COPY package.json ./

# Install dependencies (no --frozen-lockfile since lockfile is at monorepo root)
RUN pnpm install

# Copy source, assets, config
COPY . .

# Build TypeScript
RUN pnpm build

# Download Silero VAD model
RUN pnpm download-files

# Remove dev dependencies
RUN pnpm prune --prod

# --- Production stage ---
FROM base

ARG UID=10001
RUN adduser \
    --disabled-password \
    --gecos "" \
    --home "/app" \
    --shell "/sbin/nologin" \
    --uid "${UID}" \
    appuser

WORKDIR /app

COPY --from=build --chown=appuser:appuser /app /app

USER appuser

ENV NODE_ENV=production

CMD [ "pnpm", "start" ]
