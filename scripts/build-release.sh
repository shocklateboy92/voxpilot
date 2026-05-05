#!/usr/bin/env bash
# Build a VoxPilot release tarball.
#
# Usage:  scripts/build-release.sh [target]
#         target defaults to bun-linux-x64.
#
# Outputs:
#   dist/release/voxpilot-<version>-<os>-<arch>.tar.gz
#   dist/release/voxpilot-<version>-<os>-<arch>.tar.gz.sha256
#
# Both this script and the GitHub Actions workflow call into here so the build
# is reproducible from a developer machine.

set -euo pipefail

TARGET="${1:-bun-linux-x64}"

# Project root (script lives at scripts/build-release.sh).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# --- version --------------------------------------------------------------
# Format: 0.1.<commit-count>+<short-sha>
# Properly orderable semver (the +metadata is ignored for ordering, and the
# patch number monotonically increases with every commit on the branch).
COMMIT_COUNT="$(git rev-list --count HEAD)"
SHORT_SHA="$(git rev-parse --short HEAD)"
VERSION="0.1.${COMMIT_COUNT}+${SHORT_SHA}"

# Map Bun --target to a friendly arch tag for the tarball name.
case "$TARGET" in
  bun-linux-x64)        OS_ARCH="linux-x64" ;;
  bun-linux-x64-baseline) OS_ARCH="linux-x64-baseline" ;;
  bun-linux-arm64)      OS_ARCH="linux-arm64" ;;
  bun-darwin-x64)       OS_ARCH="darwin-x64" ;;
  bun-darwin-arm64)     OS_ARCH="darwin-arm64" ;;
  *) echo "build-release: unknown target '$TARGET'" >&2; exit 1 ;;
esac

# Map Bun target to Go GOOS/GOARCH for tsnet-proxy cross-compilation.
case "$TARGET" in
  bun-linux-x64*)   GOOS=linux  GOARCH=amd64 ;;
  bun-linux-arm64)  GOOS=linux  GOARCH=arm64 ;;
  bun-darwin-x64)   GOOS=darwin GOARCH=amd64 ;;
  bun-darwin-arm64) GOOS=darwin GOARCH=arm64 ;;
esac

OUTDIR="dist/release"
STAGE="dist/stage/voxpilot"
TARBALL="$OUTDIR/voxpilot-${VERSION}-${OS_ARCH}.tar.gz"

echo "==> Building VoxPilot ${VERSION} for ${TARGET} (${OS_ARCH})"

# --- clean ----------------------------------------------------------------
rm -rf "$STAGE" "$OUTDIR"
mkdir -p "$STAGE" "$OUTDIR"

# --- backend deps (frontend imports types via @backend alias, so backend
#     node_modules must exist before frontend build) ----------------------
echo "==> Installing backend dependencies"
( cd backend && bun install --frozen-lockfile 2>/dev/null || bun install )

# --- frontend -------------------------------------------------------------
echo "==> Installing frontend dependencies"
( cd frontend && npm install --no-audit --no-fund )
echo "==> Building frontend"
( cd frontend && npm run build )

# --- backend binary -------------------------------------------------------
echo "==> Compiling VoxPilot binary (target=${TARGET})"
# --define injects the version as a string literal at build time.
# --minify + --sourcemap follows Bun's production recommendation.
( cd backend && bun build \
    --compile \
    --target="$TARGET" \
    --minify \
    --sourcemap \
    --define "BUILD_VERSION=\"${VERSION}\"" \
    src/index.ts \
    --outfile "$ROOT/$STAGE/voxpilot" )

# --- tsnet-proxy (Go) -----------------------------------------------------
echo "==> Building tsnet-proxy (GOOS=${GOOS} GOARCH=${GOARCH})"
( cd tsnet-proxy && \
  GOOS="$GOOS" GOARCH="$GOARCH" CGO_ENABLED=0 \
  go build -trimpath -ldflags="-s -w" -o "$ROOT/$STAGE/tsnet-proxy" . )

# --- assemble stage -------------------------------------------------------
echo "==> Assembling tarball contents"
cp -r frontend/dist "$STAGE/static"
cp -r backend/drizzle "$STAGE/drizzle"
cp -r packaging/systemd "$STAGE/systemd"
cp packaging/README.md "$STAGE/README.md"
echo "$VERSION" > "$STAGE/VERSION"

# --- tarball --------------------------------------------------------------
echo "==> Creating $TARBALL"
# --transform isn't portable; the stage dir is already named 'voxpilot' so
# tar from its parent to get voxpilot/... at the root.
tar -czf "$TARBALL" -C "$(dirname "$STAGE")" "$(basename "$STAGE")"

# --- checksum -------------------------------------------------------------
( cd "$OUTDIR" && sha256sum "$(basename "$TARBALL")" > "$(basename "$TARBALL").sha256" )

echo
echo "Built:    $TARBALL"
echo "Sha256:   $TARBALL.sha256"
echo "Version:  $VERSION"
echo "Size:     $(du -h "$TARBALL" | cut -f1)"
