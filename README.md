# AXIOM OS

**AXIOM OS** is a hybrid agent-execution control plane for routing bounded agent tasks between a local development tier and a remote Kubernetes tier. It treats the persistent `trace_id` as the system spine, enabling unified audit records, replayable envelopes, deterministic routing decisions, and local-versus-remote cost attribution.

> This repository is a **runnable reference implementation** of the AXIOM OS control plane. It does not claim to be a complete custom Linux distribution, GPU platform, or managed cloud service.

| Capability | Included in this repository | Deployment boundary |
|---|---:|---|
| Typed task contract and canonical serialization | Yes | Shared across CLI, controller, and worker |
| Hybrid execution router | Yes | Works in local simulation and with live adapters |
| Trace continuity and redacted audit events | Yes | JSONL locally; OTLP adapter can be supplied in production |
| Local and remote cost attribution | Yes | Rates are explicit environment configuration |
| Signed remote envelopes | Yes | Replace development key with workload identity and mTLS |
| Kubernetes custom resource and Helm chart | Yes | Requires a cluster and reviewed image registry |
| Local service topology | Yes | Requires Docker/Compose to run services |
| Kernel, ISO, GPU, and cloud provisioning | Build plans/configuration only | Requires trusted toolchains and cloud credentials |

## Quick Start: Zero-Infrastructure Simulation

The simulation profile executes the same control-plane behavior without a model server or a Kubernetes cluster. It is the fastest way to validate task routing, trace persistence, replay export, and cost reports.

```bash
uv sync --extra dev
export AXIOM_HOME="$PWD/.axiom"
uv run axiom init --mode simulation
uv run axiom submit \
  --objective "Verify a local AXIOM task" \
  --depth 1 \
  --tokens 8000 \
  --model llama2-7b
```

The submit response contains `task_id` and `trace_id`. Use them for audit, replay, and costs.

```bash
uv run axiom trace show --trace-id tr_your_trace_id
uv run axiom export --task-id task_your_task_id --format kubernetes > execution.yaml
uv run axiom verify --task-id task_your_task_id
uv run axiom cost breakdown --trace-id tr_your_trace_id
```

## Routing Policy

The router is deterministic. It honors an explicit `local` or `remote` placement first; with `auto`, it executes locally only when the selected model is cached, the context and serialized state fit local limits, the recursion depth is bounded, accelerator requirements are met, and the predicted local frame is within budget. Otherwise it routes to the remote tier. If the remote circuit is unavailable, AXIOM executes locally only when that task remains locally eligible and degradation is allowed.

| Default limit | Value | Rationale |
|---|---:|---|
| Local recursion depth | 3 | Keeps recursive work bounded in the latency-sensitive tier |
| Local frame budget | 50 ms | Exposes the specification’s local responsiveness target |
| Remote submit budget | 200 ms | Exposes the specification’s remote handoff target |
| Maximum task context | 128,000 tokens | Enforced by the task schema |
| Remote circuit failure threshold | 3 | Prevents repeated failed remote submits from amplifying incidents |

## Local Services

The Compose profile declares ephemeral Redis, Jaeger, optional Ollama, and an AXIOM worker. It deliberately binds service ports to loopback addresses.

```bash
docker compose -f docker/docker-compose-local.yml --profile models up -d
```

Build and apply local Kubernetes prerequisites only on a machine with `kind`, `kubectl`, and `helm` installed:

```bash
./scripts/bootstrap-local.sh
helm upgrade --install axiom ./helm/axiom -n axiom --create-namespace
```

## Remote Kubernetes Deployment

The `helm/axiom` chart contains the `AxiomJob` schema, least-privilege namespaced RBAC, controller deployment, routing configuration, and Prometheus rules. Render before installation and provide real image references, trust material, model storage, and endpoint configuration through a reviewed production values file.

```bash
helm template axiom ./helm/axiom --namespace axiom
helm upgrade --install axiom ./helm/axiom \
  --namespace axiom --create-namespace \
  --values helm/axiom/values-prod.yaml
```

The Terraform directory provides a **bring-your-own-network** EKS baseline. It requires private subnets in at least two availability zones and intentionally does not create an unreviewed Internet gateway, NAT topology, or permissive ingress.

```bash
cd terraform
terraform init
terraform plan \
  -var='aws_region=us-east-1' \
  -var='private_subnet_ids=["subnet-1","subnet-2"]'
```

## Security and Privacy

The reference implementation signs canonical task envelopes using HMAC so a transport adapter can reject task mutation. A production deployment must source the key from a managed workload identity and use mTLS with a pinned trust root. Trace and audit events hash task objectives and serialized state rather than storing raw content. Do not pass secrets through task objectives, environment variables, labels, annotations, or metric labels.

## Project Layout

| Path | Responsibility |
|---|---|
| `src/axiom/` | Typed contracts, routing, executor adapters, traces, costs, replay, and CLI |
| `src/axiom_controller.py` | Optional Kubernetes-controller compatible resource adapter |
| `src/axiom_agent.py` | Container-friendly worker entry point |
| `docker/` | Local service topology and hardened container definitions |
| `k8s/` | Kind profile and `AxiomJob` custom resource definition |
| `helm/axiom/` | Remote-cluster chart, RBAC, configuration, rules, and dashboard |
| `terraform/` | EKS baseline over reviewed existing private networking |
| `scripts/` | Guarded build, bootstrap, and image-manifest commands |
| `docs/` | Architecture, deployment, and operations guidance |
| `tests/` | No-infrastructure unit and integration simulation suite |

## Development

```bash
make install
make lint
make test
make build
make image-manifest
```

See [architecture documentation](docs/architecture.md) for the control-plane boundaries and [deployment documentation](docs/deployment.md) for the production rollout sequence.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
