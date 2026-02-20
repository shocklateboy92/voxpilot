set dotenv-load

# List available recipes
default:
    @just --list

# Install all dependencies
install:
    cd backend && bun install
    cd frontend && npm install

# Run backend dev server
dev-backend:
    cd backend && bun run --hot src/index.ts

# Run frontend dev server
dev-frontend:
    cd frontend && npm run dev

# Generate OpenAPI spec and TypeScript client
generate:
    cd backend && bun run src/export-openapi.ts
    cd frontend && npm run generate

# Generate a new Drizzle migration after schema changes
db-generate:
    cd backend && bunx drizzle-kit generate

# Run backend tests
test:
    cd backend && bun test

# Lint everything
lint:
    bunx @biomejs/biome check backend/src backend/tests
    cd frontend && npx tsc --noEmit

# Type check everything
typecheck:
    cd backend && bunx tsc --noEmit
    cd frontend && npx tsc --noEmit

# Format backend code
format:
    bunx @biomejs/biome check --write backend/src backend/tests

# Build frontend for production
build: generate
    cd frontend && npm run build

# Build frontend and copy to backend static dir
build-static: build
    mkdir -p backend/static
    cp -r frontend/dist/* backend/static/

# Clean build artifacts
clean:
    cd frontend && npm run clean
    find backend -type d -name node_modules -prune -o -name '*.tsbuildinfo' -print -exec rm {} +

# Run everything (install, generate, lint, typecheck, test)
check: install generate lint typecheck test
