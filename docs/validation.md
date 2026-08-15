# Validation Evidence

## Scope

AXIOM OS validates its control plane without asserting hardware-dependent production service-level objectives in a generic development runner. The automated suite verifies typed contracts, deterministic placement, remote-envelope integrity, privacy-aware trace logging, task/result persistence, replay manifests, cost allocation, and concurrent simulation behavior.

| Validation class | Mechanism | Expected evidence |
|---|---|---|
| Schema validation | Pydantic task and result contracts | Invalid state, context, and terminal states are rejected |
| Hybrid routing | Unit tests for placement constraints | Recorded route reason and selected tier |
| Remote integrity | HMAC envelope transport test | Modified task payload is rejected |
| Trace privacy | JSONL audit inspection | Task objective appears only as a SHA-256 digest |
| Replay | Manifest export and digest comparison | Trace and canonical task identity preserved |
| Concurrent simulation | 100-task deterministic workload | Completion, location split, and latency distribution |
| Deployment syntax | Locked package build and chart manifests | Reviewed by the target cluster toolchain before release |

## Latest Reference Run

The following results were produced in the repository’s deterministic simulation harness on the development runner. They demonstrate the control-plane implementation only; they are not a claim about live model inference, network transit, GPUs, Kubernetes scheduling, or EKS service-level performance.

| Metric | Observed result |
|---|---:|
| Unit and simulation tests | 11 passed |
| Synthetic workload count | 100 tasks |
| Successful tasks | 100 |
| Local route count | 80 |
| Remote route count | 20 |
| Wall-clock workload duration | 29.452 ms |
| Simulated p50 task latency | 0.072 ms |
| Simulated p95 task latency | 20.687 ms |
| Simulated maximum task latency | 26.321 ms |

> The remote branch includes an intentional deterministic delay to exercise the placement and audit path. These figures validate implementation behavior, not real model-serving performance.

## Required Production Acceptance Tests

A target environment must collect its own evidence before production use. The environment owner should execute a cold-start test, model-cache checksum test, local model frame benchmark, signed mTLS remote submission benchmark, GPU placement test, remote queue stress test, OpenTelemetry trace inspection, immutable audit retention test, cost-rate reconciliation, failure-injection test, and rollback drill.

The following criteria should be recorded with environment details, measured percentile, workload, model revision, image digest, node type, and policy snapshot.

| Criterion | Target from the AXIOM specification | How to measure |
|---|---:|---|
| Local agent frame | ≤ 50 ms | Warm local model request measured at p95 under representative load |
| Remote submission | ≤ 200 ms | Signed gateway handoff measured at p95, excluding remote model runtime |
| Trace continuity | One trace across local → remote → local | Inspect OTLP/Jaeger spans by persistent trace ID |
| Model cache integrity | SHA-256 match | Compare local cache manifest with remote mounted-cache manifest |
| Local degradation | Functional when remote is unavailable | Block remote gateway and submit local-eligible tasks |
| Local concurrent load | <10% frame degradation at 100 tasks | Compare warm-frame percentile before and during load |
| Remote queue reliability | <5% timeout rate at 1000 queued tasks | Queue a controlled remote workload and inspect terminal statuses |

## Reproducing the Simulation Checks

```bash
uv run --extra dev pytest
uv run scripts/simulate-load.py --count 100 --remote-every 5
```

For a real cluster, render manifests first, retain the artifact checksum, and capture all acceptance outputs under a release-specific evidence directory. Never include raw task content, signing material, certificates, or access tokens in that evidence bundle.
