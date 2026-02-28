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

# Build frontend and copy to backend static dir
build-static: build
    rm -rf backend/static/assets
    cp -r frontend/dist/* backend/static/

# Clean build artifacts
clean:
    rm -rf frontend/dist backend/tsconfig.tsbuildinfo

# Run everything (install, lint, typecheck, test)
check: install lint typecheck test
