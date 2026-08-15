"""Command-line interface for AXIOM OS local, remote, hybrid, and simulation profiles."""

from __future__ import annotations

import argparse
import asyncio
from base64 import b64encode
from collections.abc import Sequence
from json import dumps
from os import environ
from pathlib import Path

from .config import detect_capabilities, load_config, save_config
from .cost import CostCalculator, CostRates
from .executor import DeterministicExecutor, HttpModelExecutor, RemoteSubmissionExecutor
from .hybrid_client import (
    AxiomClient,
    HmacEnvelopeSigner,
    HttpRemoteTransport,
    InProcessRemoteTransport,
)
from .models import (
    AxiomConfig,
    AxiomTask,
    DeploymentMode,
    ExecutionEnv,
    ExecutionLocation,
    HealthReport,
)
from .orchestrator import AxiomOrchestrator, LocalTaskStore
from .router import ExecutionRouter
from .tracer import AuditLedger, InMemoryTracer

COMMON_LOCAL_MODELS = {"llama2-7b", "mistral-7b"}


def json_output(payload: object) -> None:
    """Write consistently structured command output to stdout."""
    if hasattr(payload, "model_dump"):
        payload = payload.model_dump(mode="json")
    print(dumps(payload, indent=2, sort_keys=True, default=str))


def axiom_home() -> Path:
    """Resolve the current AXIOM workspace at invocation time."""
    return Path(environ.get("AXIOM_HOME", Path.home() / ".axiom"))


def build_runtime(home: str | Path | None = None, *, simulate: bool = True) -> AxiomOrchestrator:
    """Build a runnable local control plane with no external infrastructure by default."""
    root = Path(home) if home else axiom_home()
    config = load_config(root)
    capabilities = config.local_capabilities
    if simulate and not capabilities.available_models:
        capabilities = capabilities.model_copy(update={"available_models": COMMON_LOCAL_MODELS})
    router = ExecutionRouter(
        capabilities, config.routing_policy, remote_healthy=config.mode != DeploymentMode.LOCAL
    )
    ledger = AuditLedger(root / "audit")
    tracer = InMemoryTracer(ledger)
    store = LocalTaskStore(root / "state")
    rates = CostRates(
        local_compute_per_second_usd=float(environ.get("AXIOM_LOCAL_COMPUTE_USD_PER_SECOND", "0")),
        remote_compute_per_second_usd=float(
            environ.get("AXIOM_REMOTE_COMPUTE_USD_PER_SECOND", "0")
        ),
        input_token_per_million_usd=float(environ.get("AXIOM_INPUT_TOKEN_USD_PER_MILLION", "0")),
        output_token_per_million_usd=float(environ.get("AXIOM_OUTPUT_TOKEN_USD_PER_MILLION", "0")),
        egress_gib_usd=float(environ.get("AXIOM_EGRESS_USD_PER_GIB", "0")),
    )
    if simulate:
        local = DeterministicExecutor(ExecutionLocation.LOCAL)
        secret = environ.get(
            "AXIOM_HMAC_SECRET", "axiom-development-secret-change-before-production"
        ).encode()
        signer = HmacEnvelopeSigner(secret)
        client = AxiomClient(signer, InProcessRemoteTransport(signer))
    else:
        local_endpoint = environ.get("AXIOM_LOCAL_ENDPOINT", "http://localhost:11434")
        remote_endpoint = config.remote_endpoint or environ.get("AXIOM_REMOTE_ENDPOINT")
        if not remote_endpoint:
            raise RuntimeError(
                "live hybrid execution requires AXIOM_REMOTE_ENDPOINT or config.remote_endpoint"
            )
        local = HttpModelExecutor(ExecutionLocation.LOCAL, local_endpoint)
        secret = environ.get("AXIOM_HMAC_SECRET", "").encode()
        if not secret:
            raise RuntimeError("live hybrid execution requires AXIOM_HMAC_SECRET")
        signer = HmacEnvelopeSigner(secret)
        client = AxiomClient(signer, HttpRemoteTransport(remote_endpoint))
    remote = RemoteSubmissionExecutor(client)
    return AxiomOrchestrator(
        router=router,
        local_executor=local,
        remote_executor=remote,
        tracer=tracer,
        cost_calculator=CostCalculator(rates),
        task_store=store,
    )


def command_init(args: argparse.Namespace) -> int:
    """Create an AXIOM profile and detect non-invasive local capabilities."""
    config = AxiomConfig(
        mode=DeploymentMode(args.mode),
        local_capabilities=detect_capabilities(),
        remote_endpoint=args.remote_endpoint,
    )
    path = save_config(config, axiom_home())
    json_output({"status": "initialized", "config": str(path), **config.model_dump(mode="json")})
    return 0


def command_submit(args: argparse.Namespace) -> int:
    """Build and execute one task through the unified orchestration service."""
    state = b64encode(args.state.encode("utf-8")).decode("ascii")
    task = AxiomTask(
        objective=args.objective,
        depth=args.depth,
        tokens_remaining=args.tokens,
        required_compute={
            "model": args.model,
            "minVramMb": args.min_vram_mb,
            "gpuRequired": args.gpu_required,
            "preferLocal": not args.prefer_remote,
            "estimatedLocalLatencyMs": args.estimated_local_latency_ms,
        },
        serialized_state=state,
        context_size_bytes=len(args.state.encode("utf-8")),
        execution_env=ExecutionEnv(args.execution_env),
        allow_degraded_local=not args.no_degraded_local,
    )
    runtime = build_runtime(simulate=not args.live)
    result = asyncio.run(runtime.submit(task))
    json_output(result)
    return 0 if result.status.value == "succeeded" else 2


def command_wait(args: argparse.Namespace) -> int:
    """Read a persisted terminal result from the local workspace."""
    runtime = build_runtime()
    json_output(runtime.task_store.load_result(args.task_id))
    return 0


def command_cost_breakdown(args: argparse.Namespace) -> int:
    """Aggregate persisted cost records by execution tier."""
    runtime = build_runtime()
    results_dir = runtime.task_store.results
    totals = {
        "local_compute_usd": 0.0,
        "remote_compute_usd": 0.0,
        "token_usd": 0.0,
        "network_usd": 0.0,
        "total_usd": 0.0,
    }
    task_count = 0
    for path in sorted(results_dir.glob("*.json")):
        result = runtime.task_store.load_result(path.stem)
        if args.trace_id and result.trace_id != args.trace_id:
            continue
        task_count += 1
        for key in totals:
            totals[key] += getattr(result.cost, key)
    json_output(
        {"task_count": task_count, **{key: round(value, 8) for key, value in totals.items()}}
    )
    return 0


def command_trace_show(args: argparse.Namespace) -> int:
    """Display the sanitized audit trail belonging to a trace identifier."""
    runtime = build_runtime()
    events = runtime.tracer.ledger.read_trace(args.trace_id)
    json_output([event.model_dump(mode="json") for event in events])
    return 0 if events else 1


def command_logs_stream(args: argparse.Namespace) -> int:
    """Emit the saved audit trail; this finite form is suitable for terminal and CI use."""
    return command_trace_show(args)


def command_export(args: argparse.Namespace) -> int:
    """Export a portable replay manifest, optionally as a Kubernetes custom resource."""
    runtime = build_runtime()
    manifest = runtime.export_replay(args.task_id)
    if args.format == "json":
        json_output(manifest)
        return 0
    resource = {
        "apiVersion": "axiom.ai/v1alpha1",
        "kind": "AxiomJob",
        "metadata": {
            "name": manifest.task.id,
            "namespace": args.namespace,
            "annotations": {
                "axiom.ai/trace-id": manifest.trace_id,
                "axiom.ai/task-digest": manifest.task_digest,
            },
        },
        "spec": manifest.task.model_dump(mode="json", by_alias=True, exclude={"id", "created_at"}),
    }
    try:
        import yaml
    except ImportError as error:  # pragma: no cover - shipped runtime dependency
        raise RuntimeError("Kubernetes export requires PyYAML") from error
    print(yaml.safe_dump(resource, sort_keys=False))
    return 0


def command_verify(args: argparse.Namespace) -> int:
    """Verify task identity and result digest against its exported replay manifest."""
    runtime = build_runtime()
    result = runtime.verify_replay(args.task_id)
    json_output(result)
    return 0 if result["verified"] else 2


def command_health_check(args: argparse.Namespace) -> int:
    """Report profile readiness without mutating local or remote services."""
    runtime = build_runtime()
    config = load_config(axiom_home())
    report = HealthReport(
        mode=config.mode,
        local_healthy=runtime.router.capabilities.local_healthy,
        remote_healthy=runtime.router.remote_healthy,
        remote_circuit_open=runtime.router.circuit_breaker.is_open(),
        details={
            "models_cached": ",".join(sorted(runtime.router.capabilities.available_models))
            or "none",
            "gpu_available": str(runtime.router.capabilities.gpu_available).lower(),
            "audit_root": str(runtime.tracer.ledger.root),
        },
    )
    json_output(report)
    return 0 if report.local_healthy else 2


def command_local_start(args: argparse.Namespace) -> int:
    """Report the selected local profile; service startup is delegated to Compose."""
    runtime = build_runtime()
    json_output(
        {
            "status": "ready",
            "mode": "local",
            "models": sorted(runtime.router.capabilities.available_models),
            "message": "Run docker compose -f docker/docker-compose-local.yml up -d for infrastructure services.",
        }
    )
    return 0


def command_local_push(args: argparse.Namespace) -> int:
    """Generate a model-cache manifest; transfer is intentionally an operator action."""
    cache_root = Path(environ.get("AXIOM_MODEL_CACHE", Path.home() / ".cache" / "axiom" / "models"))
    model_path = cache_root / args.model
    if not model_path.exists():
        raise FileNotFoundError(f"model is not present in local cache: {model_path}")
    json_output(
        {
            "status": "ready_to_sync",
            "model": args.model,
            "source": str(model_path),
            "message": "Use the documented mTLS-protected cache sync job to transfer this model.",
        }
    )
    return 0


def command_local_snapshot(args: argparse.Namespace) -> int:
    """Persist a replay manifest instead of attempting privileged BTRFS snapshots."""
    runtime = build_runtime()
    manifest = runtime.export_replay(args.task_id)
    json_output(
        {
            "status": "snapshot_created",
            "snapshot_type": "replay_manifest",
            "task_id": args.task_id,
            "trace_id": manifest.trace_id,
        }
    )
    return 0


def command_cache_gc(args: argparse.Namespace) -> int:
    """Report model-cache candidates without deleting user artifacts implicitly."""
    cache_root = Path(environ.get("AXIOM_MODEL_CACHE", Path.home() / ".cache" / "axiom" / "models"))
    candidates = [str(path) for path in cache_root.glob("*")] if cache_root.exists() else []
    json_output(
        {
            "status": "dry_run",
            "cache_root": str(cache_root),
            "candidates": candidates,
            "message": "No cached model data is removed without an explicit operator policy.",
        }
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    """Create the full `axiom` command hierarchy."""
    parser = argparse.ArgumentParser(
        prog="axiom", description="AXIOM OS hybrid-agent control plane"
    )
    commands = parser.add_subparsers(dest="command", required=True)

    init = commands.add_parser("init", help="initialize a local AXIOM profile")
    init.add_argument("--mode", choices=[mode.value for mode in DeploymentMode], default="hybrid")
    init.add_argument("--remote-endpoint")
    init.set_defaults(handler=command_init)

    submit = commands.add_parser("submit", help="submit one agent task")
    submit.add_argument("--objective", required=True)
    submit.add_argument("--depth", type=int, default=0)
    submit.add_argument("--tokens", type=int, default=128_000)
    submit.add_argument("--model", default="llama2-7b")
    submit.add_argument("--min-vram-mb", type=int, default=0)
    submit.add_argument("--gpu-required", action="store_true")
    submit.add_argument("--prefer-remote", action="store_true")
    submit.add_argument("--estimated-local-latency-ms", type=float)
    submit.add_argument(
        "--execution-env", choices=[env.value for env in ExecutionEnv], default="auto"
    )
    submit.add_argument("--state", default="{}")
    submit.add_argument("--no-degraded-local", action="store_true")
    submit.add_argument(
        "--live", action="store_true", help="use configured HTTP model and remote endpoints"
    )
    submit.set_defaults(handler=command_submit)

    wait = commands.add_parser("wait", help="read a persisted task result")
    wait.add_argument("task_id")
    wait.set_defaults(handler=command_wait)

    cost = commands.add_parser("cost", help="cost accounting")
    cost_commands = cost.add_subparsers(dest="cost_command", required=True)
    breakdown = cost_commands.add_parser("breakdown", help="aggregate stored task costs")
    breakdown.add_argument("--trace-id")
    breakdown.set_defaults(handler=command_cost_breakdown)

    trace = commands.add_parser("trace", help="trace operations")
    trace_commands = trace.add_subparsers(dest="trace_command", required=True)
    show = trace_commands.add_parser("show", help="show a sanitized trace")
    show.add_argument("--trace-id", required=True)
    show.set_defaults(handler=command_trace_show)

    logs = commands.add_parser("logs", help="audit log operations")
    logs_commands = logs.add_subparsers(dest="logs_command", required=True)
    stream = logs_commands.add_parser("stream", help="emit persisted trace events")
    stream.add_argument("--trace-id", required=True)
    stream.set_defaults(handler=command_logs_stream)

    export = commands.add_parser("export", help="export replayable execution context")
    export.add_argument("--task-id", required=True)
    export.add_argument("--format", choices=["json", "kubernetes"], default="kubernetes")
    export.add_argument("--namespace", default="axiom")
    export.set_defaults(handler=command_export)

    verify = commands.add_parser("verify", help="verify replay inputs and result digest")
    verify.add_argument("--task-id", required=True)
    verify.set_defaults(handler=command_verify)

    health = commands.add_parser("health", help="runtime health operations")
    health_commands = health.add_subparsers(dest="health_command", required=True)
    check = health_commands.add_parser("check", help="inspect readiness")
    check.set_defaults(handler=command_health_check)

    local = commands.add_parser("local", help="local environment operations")
    local_commands = local.add_subparsers(dest="local_command", required=True)
    local_start = local_commands.add_parser("start", help="describe local service profile")
    local_start.set_defaults(handler=command_local_start)
    local_push = local_commands.add_parser("push", help="prepare a cached model for transfer")
    local_push.add_argument("model")
    local_push.set_defaults(handler=command_local_push)
    local_snapshot = local_commands.add_parser("snapshot", help="persist a replay snapshot")
    local_snapshot.add_argument("--task-id", required=True)
    local_snapshot.set_defaults(handler=command_local_snapshot)

    cache = commands.add_parser("cache", help="model cache operations")
    cache_commands = cache.add_subparsers(dest="cache_command", required=True)
    cache_sync = cache_commands.add_parser("sync", help="describe model cache sync prerequisites")
    cache_sync.set_defaults(
        handler=lambda args: command_local_push(argparse.Namespace(model="llama2-7b"))
    )
    cache_gc = cache_commands.add_parser("gc", help="show cache garbage-collection candidates")
    cache_gc.set_defaults(handler=command_cache_gc)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run the AXIOM CLI and normalize operational errors into concise messages."""
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.handler(args))
    except (FileNotFoundError, RuntimeError, ValueError) as error:
        parser.error(str(error))
        return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
