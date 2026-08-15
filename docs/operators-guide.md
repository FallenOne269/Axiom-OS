# Operator Guide

## Operating Model

AXIOM operators manage immutable task envelopes, bounded routing policy, service health, and audit evidence. They do not need to inspect task prompt content to diagnose a route because the router records a sanitized decision reason, a task digest, a trace identifier, resource usage, and a cost record.

| Operator concern | Evidence source | Primary control |
|---|---|---|
| Why did a task leave the local tier? | `route.decision` trace event | Model cache, depth, context, VRAM, frame-budget policy |
| Did a remote failure affect callers? | Circuit-breaker state and terminal result | Remote gateway health and fallback eligibility |
| Which components contributed to cost? | `AxiomResult.cost` and `axiom cost breakdown` | Declared compute, token, and egress rates |
| Can a result be replayed? | `ReplayManifest` and task/result digests | `axiom export` and `axiom verify` |
| Is private content in the trace store? | JSONL audit record | Objective and serialized-state digest fields only |

## Task Life Cycle

A task is validated before it is placed. AXIOM persists the canonical task record, emits `task.submit`, evaluates the routing policy, emits `route.decision`, starts the selected executor, records terminal usage and cost, then appends `task.complete`. Every emitted event carries the same `trace_id`.

```bash
axiom submit --objective "Inspect the current request" --depth 1
axiom trace show --trace-id tr_example
axiom wait task_example
```

A trace event includes the selected execution location and the route reason. It intentionally omits raw task objectives and serialized state. Use the canonical task record in protected storage when diagnostic replay requires full input data.

## Routing Reasons

| Reason | Interpretation | Typical corrective action |
|---|---|---|
| `local_eligible` | All local checks passed | None |
| `depth_limit` | Task depth exceeds the bounded local recursion limit | Reduce recursion or ensure remote capacity |
| `context_limit` | Context budget exceeds local window | Use remote context tier or reduce context |
| `serialized_state_limit` | Envelope state is too large for local policy | Compact or externalize state |
| `model_not_cached` | Requested model is missing locally | Prewarm a verified model cache entry |
| `gpu_unavailable` | Task requires GPU but local capability snapshot has none | Use remote GPU tier |
| `vram_unavailable` | Local free VRAM is below task requirement | Select a smaller model or remote tier |
| `frame_budget` | Predicted local frame exceeds budget | Use remote tier or optimize local model path |
| `remote_unavailable_degraded` | Remote tier is unavailable but local fallback is safe | Investigate remote health; local work continues |
| `remote_unavailable_rejected` | Remote tier is unavailable and local fallback is unsafe | Restore remote path or change task requirements |

## Remote Circuit Breaker

The router opens the remote circuit after the configured number of consecutive remote failures. While open, remote work is withheld until the reset interval passes. An explicitly remote task can degrade to local only when the local eligibility checks pass and `allowDegradedLocal` is true. This prevents a network partition from converting into uncontrolled local overload or a never-ending retry loop.

Operators should treat the circuit as an incident signal rather than merely a client exception. Review remote gateway availability, mTLS trust validation, DNS, queue depth, quota, model readiness, Kubernetes events, and GPU capacity before restoring the route.

## Cost Attribution

Cost values are calculated only from explicit rate inputs and executor measurements. Zero is the correct result when no rate is supplied; AXIOM does not invent cloud prices. Configure rates at deployment time, retain the rate configuration alongside the result, and use trace-scoped breakdowns when attributing work to a request tree.

```bash
AXIOM_REMOTE_COMPUTE_USD_PER_SECOND=0.001 \
AXIOM_INPUT_TOKEN_USD_PER_MILLION=1.50 \
AXIOM_OUTPUT_TOKEN_USD_PER_MILLION=6.00 \
axiom submit --objective "Costed task" --depth 4

axiom cost breakdown --trace-id tr_example
```

## Replay and Export

A replay manifest contains canonical task bytes, a task digest, trace identifier, routing policy snapshot, capability snapshot, and expected output digest. It is designed to prove that the same execution contract was selected; deterministic executor adapters also produce identical output digests. Language-model output may vary if a live backend permits non-determinism, so production verification should compare contract and model configuration as well as output policy.

```bash
axiom export --task-id task_example --format kubernetes > execution.yaml
axiom verify --task-id task_example
kubectl apply -f execution.yaml --namespace axiom
```

## Audit Retention and Incident Preservation

The local reference ledger is a per-trace JSONL file. A remote deployment should direct sanitized telemetry to an OTLP collector and retain immutable audit events according to policy. During an incident, preserve the task digest, trace identifier, result digest, image digest, chart version, policy snapshot, and relevant Kubernetes events. Do not copy raw prompts into a ticket or log system unless the data owner has approved that disclosure.
