# AXIOM OS

**AXIOM OS** is a TypeScript reference implementation of a hybrid agent-execution control plane. It runs as one Node.js server (Express) with a React dashboard, and simulates routing bounded agent tasks between a local tier and a remote tier. Every task carries a persistent `trace_id` that ties together its routing decision, trace spans, replay envelope and cost attribution.

> This repository is a runnable simulation and dashboard. Remote execution is simulated: the server does not connect to a Kubernetes cluster, a model server or a cloud account. Tasks, traces and costs are kept in memory and are cleared when the server restarts.

| Capability | Included in this repository |
|---|---|
| Task submission API and dashboard form | Yes |
| Deterministic local/remote router with a remote circuit breaker | Yes |
| Trace viewer and task history | Yes |
| Local versus remote cost breakdown (simulated, editable rates) | Yes |
| Replay envelope export and digest verification | Yes |
| Constitutional invariant checks when a task is admitted | Yes |
| Python CLI, Helm chart, Docker Compose, Terraform | No |
| Kernel, ISO and image manifests | Build-plan scripts only, in `scripts/` |

## Quick Start

Requirements: Node.js and npm. No environment variables or API keys are needed.

```bash
npm install
npm run dev
```

Open http://localhost:3000. In development the Express server runs Vite as middleware, so dashboard changes reload live. The port is fixed at 3000 in `server.ts`.

Submit a task from the dashboard, or with curl:

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"objective":"Verify a local AXIOM task","depth":1,"tokens_remaining":8000,"required_compute":{"model":"llama2-7b"}}'
```

The response contains the task, with its `id` and `trace_id`, and the routing result. Use them with the trace, replay and cost endpoints below.

## Production Build

```bash
npm run build
NODE_ENV=production npm start
```

`npm run build` builds the dashboard into `dist/` and bundles the server into `dist/server.cjs`. With `NODE_ENV=production` the server serves the built dashboard instead of running Vite.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Tier health, circuit state and router limits |
| `POST /api/health/toggle-remote`, `/toggle-local`, `/reset-circuit` | Simulate tier outages and reset the circuit breaker |
| `GET /api/config`, `PUT /api/config` | Read or change capabilities, routing policy and cost rates |
| `POST /api/tasks`, `GET /api/tasks`, `GET /api/tasks/:id` | Submit and list tasks |
| `GET /api/traces`, `GET /api/traces/:traceId` | Trace records |
| `GET /api/cost/breakdown` | Local versus remote cost attribution |
| `GET /api/replays/:id` | Replay envelope; add `?format=kubernetes` for an `AxiomJob` manifest |
| `POST /api/replays/:id/verify` | Check the task and result digests |
| `POST /api/simulate-load` | Run a synthetic batch (default 20 tasks, up to 100) |
| `GET /api/constitutional/invariants` | List the admission invariants |

## Routing Policy

The router is deterministic. It honors an explicit `local` or `remote` placement first; with `auto`, it executes locally only when the selected model is cached, the context and serialized state fit local limits, the recursion depth is bounded, accelerator requirements are met, and the predicted local frame is within budget. Otherwise it routes to the remote tier. If the remote circuit is unavailable, AXIOM executes locally only when that task remains locally eligible and degradation is allowed.

| Default limit | Value | Rationale |
|---|---:|---|
| Local recursion depth | 3 | Keeps recursive work bounded in the latency-sensitive tier |
| Local frame budget | 50 ms | Exposes the specification’s local responsiveness target |
| Remote submit budget | 200 ms | Exposes the specification’s remote handoff target |
| Maximum task context | 128,000 tokens | Enforced when a task is admitted |
| Remote circuit failure threshold | 3 | Prevents repeated failed remote submits from amplifying incidents |

## Security and Privacy

Trace events replace sensitive fields (objective, prompt, serialized state, user ID, context preview) with SHA-256 hashes. Replay envelopes carry a SHA-256 task digest that the verify endpoint checks. The server has no authentication, no envelope signing and no mTLS, accepts cross-origin requests from any site, and listens on all network interfaces, so run it only on a trusted machine or network. Do not put secrets in task objectives or state.

## Project Layout

| Path | Responsibility |
|---|---|
| `server.ts` | Express server, API routes, Vite middleware in development |
| `server/` | Router, orchestrator, constitutional kernel, tracer, cost calculator and types |
| `src/` | React dashboard (task form, routing policy, traces, history, costs, kernel view) |
| `scripts/` | Build-plan and bootstrap scripts carried over from the earlier Python version; several expect folders or a Python package that are not in this repository |
| `docs/` | Architecture and operations notes |

## Development

```bash
npm run lint                           # TypeScript type check
npx tsx --test server/router.test.ts   # router tests
npm run build
```

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
