set dotenv-load

# List available recipes
default:
    @just --list

# Install all dependencies
install:
    cd backend && bun install
    cd frontend && npm install

# Run both frontend and backend dev servers
dev:
    trap 'kill 0' EXIT; \
    bun run --hot backend/src/index.ts & \
    (cd frontend && npm run dev) & \
    wait

# Run backend dev server
dev-backend:
    bun run --hot backend/src/index.ts

# Run frontend dev server
dev-frontend:
    cd frontend && npm run dev

# Run backend tests
test:
    cd backend && bun test

# Lint everything
lint:
    cd backend && bunx @biomejs/biome check src tests ../frontend/src
    cd frontend && npx tsc --noEmit
    cd frontend && npx eslint src/

# Type check everything
typecheck:
    cd backend && bunx tsc --noEmit
    cd frontend && npx tsc --noEmit

# Format all code
format:
    cd backend && bunx @biomejs/biome check --write src tests ../frontend/src

# Build frontend for production
build:
    cd frontend && npm run build

# Clean build artifacts
clean:
    rm -rf frontend/dist backend/tsconfig.tsbuildinfo gateway/static/assets

# Run everything (install, lint, typecheck, test)
check: install lint typecheck test

# Run a local gateway against `just dev` -- builds the frontend, points
# the gateway at frontend/dist via VPGW_FRONTEND_DIR (so changes to
# frontend code can be picked up with another `just build` without
# rebuilding the gateway binary), runs gateway + tunnel-client + backend
# all together. The gateway listens on :18080 by default; visit
# http://localhost:18080/ for the picker.
dev-gateway:
    trap 'kill 0' EXIT; \
    cd frontend && npm run build && cd .. ; \
    VPGW_BIND=:18080 \
      VPGW_TUNNEL_TOKEN=dev \
      VPGW_FRONTEND_DIR=$(pwd)/frontend/dist \
      go run ./gateway & \
    bun run --hot backend/src/index.ts & \
    sleep 1 ; \
    VOXPILOT_GATEWAY_URL=ws://127.0.0.1:18080/api/gateway/tunnel \
      VOXPILOT_GATEWAY_TOKEN=dev \
      VOXPILOT_INSTANCE_NAME=dev \
      VOXPILOT_LOCAL_URL=http://127.0.0.1:8000 \
      go run ./tunnel-client & \
    wait
