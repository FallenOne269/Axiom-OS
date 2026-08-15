#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLUSTER_NAME="${AXIOM_KIND_CLUSTER_NAME:-axiom-dev}"
CACHE_DIR="${AXIOM_CACHE_DIR:-/var/lib/axiom-cache}"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  }
}

require kind
require kubectl
require helm

if [[ "${EUID}" -ne 0 ]] && [[ ! -w "$(dirname "$CACHE_DIR")" ]]; then
  printf 'Cache parent is not writable: %s. Set AXIOM_CACHE_DIR to a writable path or run with suitable permissions.\n' "$CACHE_DIR" >&2
  exit 1
fi

mkdir -p "$CACHE_DIR"

if kind get clusters | grep -qx "$CLUSTER_NAME"; then
  printf 'kind cluster %s already exists; reusing it.\n' "$CLUSTER_NAME"
else
  kind create cluster --config "$ROOT_DIR/k8s/kind-config.yaml"
fi

kubectl wait --for=condition=Ready node --all --timeout=300s
kubectl create namespace axiom --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f "$ROOT_DIR/k8s/axiom-crd.yaml"

if command -v nvidia-smi >/dev/null 2>&1; then
  WORKER="$(kubectl get nodes -o jsonpath='{range .items[?(@.metadata.labels.node-role\.kubernetes\.io/worker)]}{.metadata.name}{"\n"}{end}' | head -n 1)"
  if [[ -n "$WORKER" ]]; then
    kubectl label node "$WORKER" gpu=true accelerator=nvidia --overwrite
  fi
fi

printf '\nAXIOM local control-plane prerequisites are ready.\n'
printf 'Install the chart after building images:\n'
printf '  helm upgrade --install axiom %q -n axiom --create-namespace\n' "$ROOT_DIR/helm/axiom"
printf 'For local model and tracing services, run:\n'
printf '  docker compose -f %q --profile models up -d\n' "$ROOT_DIR/docker/docker-compose-local.yml"
