# syntax=docker/dockerfile:1.7

# Multi-stage Docker build for voxpilot-gateway.
#
# Stages:
#   1. frontend-build   -- npm build of the SolidJS bundle
#   2. backend-deps     -- backend node_modules (frontend imports types from it)
#   3. gateway-build    -- Go build with the frontend assets embedded
#   4. final            -- distroless image with just the binary
#
# The version is passed in via the VERSION build arg and is baked into both
# the frontend bundle (Vite `define`) and the gateway binary (Go ldflags),
# so the picker's version-skew check works against backends correctly.

ARG VERSION=0.0.0-dev


# ── 1. Backend deps (frontend uses @backend type alias) ─────────────────
FROM oven/bun:1.3-alpine AS backend-deps
WORKDIR /src/backend
COPY backend/package.json backend/bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install


# ── 2. Frontend build ───────────────────────────────────────────────────
FROM node:22-alpine AS frontend-build
ARG VERSION
WORKDIR /src
# Frontend imports types from ../backend/src and uses node_modules from
# ../backend/node_modules; bring both in.
COPY backend/ backend/
COPY --from=backend-deps /src/backend/node_modules backend/node_modules
COPY frontend/ frontend/
WORKDIR /src/frontend
RUN npm install --no-audit --no-fund
ENV VOXPILOT_VERSION=${VERSION}
RUN npm run build


# ── 3. Gateway build (Go, with embedded frontend) ───────────────────────
FROM golang:1.24-alpine AS gateway-build
ARG VERSION
WORKDIR /src/gateway
COPY gateway/go.mod gateway/go.sum ./
RUN go mod download
COPY gateway/ ./
# Replace the placeholder static/ dir with the freshly-built bundle.
RUN rm -rf static && mkdir static
COPY --from=frontend-build /src/frontend/dist/ ./static/
RUN CGO_ENABLED=0 go build \
      -trimpath \
      -ldflags="-s -w -X main.version=${VERSION}" \
      -o /out/voxpilot-gateway \
      ./...


# ── 4. Final image ──────────────────────────────────────────────────────
FROM gcr.io/distroless/static:nonroot
COPY --from=gateway-build /out/voxpilot-gateway /voxpilot-gateway
EXPOSE 8080
ENTRYPOINT ["/voxpilot-gateway"]
