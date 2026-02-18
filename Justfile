set dotenv-load

# List available recipes
default:
    @just --list

# Install all dependencies
install:
    cd backend && uv sync --all-extras
    cd frontend && npm install

# Run backend dev server
dev-backend:
    cd backend && uv run uvicorn voxpilot.main:app --reload --port 8000

# Run frontend dev watcher
dev-frontend:
    cd frontend && npm run watch

# Run backend tests
test:
    cd backend && uv run pytest

# Run backend tests with coverage
test-cov:
    cd backend && uv run pytest --cov=voxpilot --cov-report=term-missing

# Lint everything
lint:
    cd backend && uv run ruff check src tests
    cd frontend && npx tsc --noEmit

# Type check everything
typecheck:
    cd backend && uv run pyright
    cd frontend && npx tsc --noEmit

# Format backend code
format:
    cd backend && uv run ruff format src tests
    cd backend && uv run ruff check --fix src tests

# Build frontend for production
build:
    cd frontend && npm run build

# Clean build artifacts
clean:
    cd frontend && npm run clean
    find backend -type d -name __pycache__ -exec rm -rf {} +

# Run everything (install, lint, typecheck, test)
check: install lint typecheck test
