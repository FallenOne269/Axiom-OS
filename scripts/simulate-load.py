#!/usr/bin/env python3
"""Run a deterministic AXIOM synthetic workload and emit a machine-readable report."""

from __future__ import annotations

import argparse
import asyncio
from statistics import quantiles
from time import perf_counter

from axiom.cost import CostCalculator
from axiom.executor import DeterministicExecutor
from axiom.models import AxiomTask, ExecutionLocation, LocalCapabilities
from axiom.orchestrator import AxiomOrchestrator
from axiom.router import ExecutionRouter
from axiom.tracer import InMemoryTracer


async def run(count: int, remote_every: int) -> dict[str, object]:
    """Execute a mixed local/remote deterministic workload concurrently."""
    runtime = AxiomOrchestrator(
        router=ExecutionRouter(LocalCapabilities(available_models={"llama2-7b"})),
        local_executor=DeterministicExecutor(ExecutionLocation.LOCAL),
        remote_executor=DeterministicExecutor(ExecutionLocation.REMOTE, delay_ms=1),
        tracer=InMemoryTracer(),
        cost_calculator=CostCalculator(),
    )
    tasks = [
        AxiomTask(
            objective=f"Synthetic workload item {index}",
            depth=4 if remote_every and index % remote_every == 0 else 1,
            tokensRemaining=8_000,
            requiredCompute={"model": "llama2-7b"},
        )
        for index in range(count)
    ]
    started = perf_counter()
    results = await asyncio.gather(*(runtime.submit(task) for task in tasks))
    elapsed_ms = (perf_counter() - started) * 1_000
    latencies = sorted(result.usage.latency_ms for result in results)
    return {
        "workload_count": count,
        "succeeded": sum(result.status.value == "succeeded" for result in results),
        "local_count": sum(
            result.execution_location == ExecutionLocation.LOCAL for result in results
        ),
        "remote_count": sum(
            result.execution_location == ExecutionLocation.REMOTE for result in results
        ),
        "wall_clock_ms": round(elapsed_ms, 3),
        "latency_ms": {
            "p50": round(quantiles(latencies, n=100, method="inclusive")[49], 3)
            if len(latencies) > 1
            else round(latencies[0], 3),
            "p95": round(quantiles(latencies, n=100, method="inclusive")[94], 3)
            if len(latencies) > 1
            else round(latencies[0], 3),
            "max": round(max(latencies), 3),
        },
    }


def main() -> int:
    """Parse workload options and print a JSON report."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=100)
    parser.add_argument("--remote-every", type=int, default=5)
    args = parser.parse_args()
    if args.count < 1 or args.remote_every < 0:
        parser.error("count must be positive and remote-every must be non-negative")
    import json

    print(json.dumps(asyncio.run(run(args.count, args.remote_every)), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
