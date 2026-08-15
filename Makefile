SHELL := /usr/bin/env bash
PYTHON ?= python3
UV ?= uv

.PHONY: help lock install test lint format-check build runtime local-bootstrap helm-template image-manifest clean

help:
	@printf 'AXIOM OS targets:\n'
	@printf '  lock            Resolve and verify the uv lockfile\n'
	@printf '  install         Install project with development dependencies\n'
	@printf '  test            Run unit and integration simulation tests\n'
	@printf '  lint            Run Ruff static analysis\n'
	@printf '  build           Build the Python distribution\n'
	@printf '  runtime         Build runtime artifact and checksum manifest\n'
	@printf '  local-bootstrap Create local kind prerequisites\n'
	@printf '  helm-template   Render remote Kubernetes manifests\n'
	@printf '  image-manifest  Generate local and remote image manifests\n'

lock:
	$(UV) lock

install:
	$(UV) sync --extra dev --extra http

test:
	$(UV) run pytest

lint:
	$(UV) run ruff check src tests

format-check:
	$(UV) run ruff format --check src tests

build:
	$(UV) build

runtime:
	./scripts/build-runtime.sh

local-bootstrap:
	./scripts/bootstrap-local.sh

helm-template:
	helm template axiom ./helm/axiom --namespace axiom

image-manifest:
	./scripts/build-kernel.sh --target=local --arch=x86_64
	./scripts/build-kernel.sh --target=remote --arch=x86_64
	./scripts/build-iso.sh local
	./scripts/build-iso.sh remote

clean:
	rm -rf dist .pytest_cache .ruff_cache
