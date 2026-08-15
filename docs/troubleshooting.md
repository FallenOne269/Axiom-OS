# Troubleshooting

## First Response

Start with the terminal result and the trace identifier. The task result distinguishes rejected work, local execution failures, remote execution failures, and successful degraded execution. The trace records the original routing decision without exposing the task objective.

```bash
axiom wait task_example
axiom trace show --trace-id tr_example
axiom health check
```

| Symptom | Likely interpretation | First diagnostic action |
|---|---|---|
| Task is `rejected` | No safe execution tier is available | Inspect `route.decision` reason and remote health |
| Task runs remotely unexpectedly | Local eligibility condition failed | Inspect model, depth, context, VRAM, and predicted frame values |
| Task runs locally despite explicit remote mode | Remote was unavailable and local degradation was allowed | Inspect remote circuit and gateway health |
| Remote circuit is open | Consecutive remote failures crossed threshold | Review transport, certificates, queue, and worker health |
| Trace has no raw objective | Expected privacy behavior | Use protected task records for approved replay only |
| Cost is zero | No explicit rates are configured | Set rate environment values and rerun the calculation |

## Routing Issues

### A model is not cached locally

`model_not_cached` means the capability snapshot did not find the requested model in `AXIOM_MODEL_CACHE`. Verify the model directory name exactly matches `requiredCompute.model`. The simulation profile injects common lightweight model names only for zero-infrastructure testing; it does not download or validate real model weights.

```bash
find "${AXIOM_MODEL_CACHE:-$HOME/.cache/axiom/models}" -maxdepth 1 -mindepth 1 -printf '%f\n'
```

### Local capacity is insufficient

A task with `gpuRequired=true`, a VRAM threshold, depth above the policy maximum, a context larger than the local window, or a predicted frame above the configured target will not run locally in automatic mode. Adjust the task requirement only if it truly overstates the workload; otherwise restore remote capacity.

### Remote is unavailable

A remote failure can be a network path, mTLS, signature, API, queue, Kubernetes, model, or capacity issue. Do not disable the circuit breaker as a first response. Confirm that the gateway returns a successful liveness response, verify the CA and client credentials, inspect controller and worker events, and review queue depth and GPU scheduling. If the task is locally eligible, AXIOM can continue in degraded local mode; if not, it should remain rejected.

## CLI and State Issues

AXIOM stores local simulation records under `AXIOM_HOME`, defaulting to `~/.axiom`. A `task not found` message usually indicates a different workspace, shell user, container mount, or cleanup event.

```bash
printf '%s\n' "${AXIOM_HOME:-$HOME/.axiom}"
find "${AXIOM_HOME:-$HOME/.axiom}/state" -maxdepth 2 -type f
```

If a replay manifest is missing, run `axiom export --task-id …` after a task has been persisted. If verification reports a result-digest mismatch, distinguish between a deterministic simulation replay, where equality is expected, and a live model replay, where output variation may be legitimate. Preserve the policy snapshot and model configuration before retrying.

## Kubernetes Issues

Confirm the custom resource definition exists before applying an `AxiomJob`.

```bash
kubectl get crd axiomjobs.axiom.ai
kubectl get axiomjobs -A
kubectl get pods -n axiom
kubectl get events -n axiom --sort-by=.lastTimestamp
```

If Helm rendering fails, run `helm lint ./helm/axiom` and inspect the generated YAML. Do not bypass RBAC errors with `cluster-admin`; the supplied chart uses a namespace-scoped Role. Expand permissions only after identifying the exact API group, resource, verb, and namespace required by the controller.

## Container and Compose Issues

The local Compose configuration binds ports to `127.0.0.1`. A service intentionally cannot be reached from a remote host. If a local port is in use, change the host mapping in an environment-specific override rather than editing the source file. Model files are mounted read-only in the AXIOM worker; model installation belongs to a controlled cache-management process.

```bash
docker compose -f docker/docker-compose-local.yml ps
docker compose -f docker/docker-compose-local.yml logs --tail=200 jaeger redis
```

## Deployment Escalation Evidence

When escalating a problem, collect the AXIOM version, image digest, Helm release revision, rendered manifest checksum, task ID, trace ID, route reason, sanitized result, Kubernetes event excerpts, and relevant health output. Do not include raw objective text, serialized task state, HMAC values, private keys, client certificates, or bearer tokens.
