set dotenv-load

default:
    @just --list

install:
    cd plugin && bun install
    cd frontend && npm ci

# Foreground OpenCode owns plugin lifecycle; Vite is only a development server.
dev: build-plugin
    trap 'kill 0' EXIT; \
    VOXPILOT_PLUGIN_DIR="$PWD/plugin" VOXPILOT_HOSTNAME=127.0.0.1 VOXPILOT_PORT=8001 packaging/voxpilot-opencode & \
    (cd frontend && VOXPILOT_API_TARGET=http://127.0.0.1:8001 npm run dev) & \
    wait

dev-frontend:
    cd frontend && VOXPILOT_API_TARGET=http://127.0.0.1:8001 npm run dev

build-plugin:
    cd plugin && bun run build

test:
    cd plugin && bun test

lint:
    cd plugin && bunx biome check src tests ../frontend/src
    cd frontend && npx eslint src/

typecheck:
    cd plugin && bunx tsc --noEmit
    cd frontend && npx tsc --noEmit

format:
    cd plugin && bunx biome check --write src tests ../frontend/src

build: build-plugin
    cd frontend && npm run build

clean:
    rm -rf frontend/dist plugin/dist

check: typecheck test lint
