#!/usr/bin/env bash
set -euo pipefail

TARGET=""
ARCH="x86_64"

for arg in "$@"; do
  case "$arg" in
    --target=local) TARGET="local" ;;
    --target=remote) TARGET="remote" ;;
    --arch=*) ARCH="${arg#*=}" ;;
    *) printf 'Unknown argument: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  printf 'Usage: %s --target=local|remote [--arch=x86_64]\n' "$0" >&2
  exit 2
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist/kernel-$TARGET-$ARCH"
mkdir -p "$OUT_DIR"

cat > "$OUT_DIR/build-plan.json" <<PLAN
{
  "target": "$TARGET",
  "architecture": "$ARCH",
  "kernel_series": "6.6 LTS",
  "required_features": [
    "cgroup-v2",
    "io_uring",
    "overlayfs"
  ],
  "target_features": [
    $([[ "$TARGET" == "remote" ]] && printf '"infiniband", "rdma"' || printf '"btrfs", "minimal-drivers"')
  ],
  "status": "requires pinned kernel source and trusted toolchain"
}
PLAN

printf 'Wrote reproducible kernel build plan: %s\n' "$OUT_DIR/build-plan.json"
printf 'This repository does not download or compile kernel sources implicitly. Pin a verified source tarball and toolchain in your deployment pipeline before executing an image build.\n'
