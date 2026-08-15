#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-local}"
case "$TARGET" in
  local|remote) ;;
  *) printf 'Usage: %s [local|remote]\n' "$0" >&2; exit 2 ;;
esac

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
mkdir -p "$DIST_DIR"

RUNTIME_SUM=""
if [[ -f "$DIST_DIR/SHA256SUMS" ]]; then
  RUNTIME_SUM="$(sha256sum "$DIST_DIR/SHA256SUMS" | awk '{print $1}')"
fi

cat > "$DIST_DIR/${TARGET}-image-manifest.json" <<MANIFEST
{
  "artifact_type": "axiom-${TARGET}-image",
  "version": "0.1.0",
  "runtime_checksum_manifest": "$RUNTIME_SUM",
  "kernel_plan": "kernel-${TARGET}-x86_64/build-plan.json",
  "container_definitions": [
    "docker/Dockerfile.agent",
    "docker/Dockerfile.controller"
  ],
  "provenance_status": "manifest-generated; sign this manifest and built OCI/ISO layers with your approved Sigstore identity"
}
MANIFEST

printf 'Wrote image-finalization manifest: %s\n' "$DIST_DIR/${TARGET}-image-manifest.json"
