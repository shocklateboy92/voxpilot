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

OUTDIR="dist/release"
STAGE="dist/stage/voxpilot"
TARBALL="$OUTDIR/voxpilot-${VERSION}-${OS_ARCH}.tar.gz"

echo "==> Building VoxPilot ${VERSION} for ${TARGET} (${OS_ARCH})"

# --- clean ----------------------------------------------------------------
rm -rf "$STAGE" "$OUTDIR"
mkdir -p "$STAGE" "$OUTDIR"

# --- plugin and shared RPC contract ----------------------------------------
echo "==> Building plugin"
( cd plugin && bun install --frozen-lockfile && bun run typecheck && bun run build )

# --- frontend -------------------------------------------------------------
echo "==> Installing frontend dependencies"
( cd frontend && npm ci --no-audit --no-fund )
echo "==> Building frontend"
( cd frontend && npm run build )

# --- assemble stage -------------------------------------------------------
echo "==> Assembling tarball contents"
cp -r frontend/dist "$STAGE/static"
mkdir -p "$STAGE/plugins/voxpilot" "$STAGE/bin"
cp -r plugin/dist "$STAGE/plugins/voxpilot/dist"
cp plugin/package.json "$STAGE/plugins/voxpilot/package.json"
cp plugin/index.js "$STAGE/plugins/voxpilot/index.js"
install -m 755 packaging/voxpilot-opencode "$STAGE/bin/voxpilot-opencode"
cp -r packaging/systemd "$STAGE/systemd"
cp packaging/README.md "$STAGE/README.md"
echo "$VERSION" > "$STAGE/VERSION"

# --- tarball --------------------------------------------------------------
echo "==> Creating $TARBALL"
# --transform isn't portable; the stage dir is already named 'voxpilot' so
# tar from its parent to get voxpilot/... at the root.
tar -czf "$TARBALL" -C "$(dirname "$STAGE")" "$(basename "$STAGE")"
# One architecture-independent static frontend for central hosting.
FRONTEND_TARBALL="$OUTDIR/voxpilot-frontend-${VERSION}.tar.gz"
tar -czf "$FRONTEND_TARBALL" -C frontend/dist .

# --- checksum -------------------------------------------------------------
( cd "$OUTDIR" && sha256sum "$(basename "$TARBALL")" > "$(basename "$TARBALL").sha256" )
( cd "$OUTDIR" && sha256sum "$(basename "$FRONTEND_TARBALL")" > "$(basename "$FRONTEND_TARBALL").sha256" )

echo
echo "Built:    $TARBALL"
echo "Sha256:   $TARBALL.sha256"
echo "Version:  $VERSION"
echo "Size:     $(du -h "$TARBALL" | cut -f1)"
