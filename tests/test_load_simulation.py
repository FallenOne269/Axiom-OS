import asyncio
from time import perf_counter

import pytest

from axiom.cost import CostCalculator
from axiom.executor import DeterministicExecutor
from axiom.models import AxiomTask, ExecutionLocation, LocalCapabilities
from axiom.orchestrator import AxiomOrchestrator
from axiom.router import ExecutionRouter
from axiom.tracer import InMemoryTracer


@pytest.mark.asyncio
async def test_one_hundred_concurrent_local_simulated_tasks_complete_within_frame_budget() -> None:
    runtime = AxiomOrchestrator(
        router=ExecutionRouter(
            LocalCapabilities(available_models={"llama2-7b"}, predicted_frame_ms=1)
        ),
        local_executor=DeterministicExecutor(ExecutionLocation.LOCAL),
        remote_executor=DeterministicExecutor(ExecutionLocation.REMOTE),
        tracer=InMemoryTracer(),
        cost_calculator=CostCalculator(),
    )
    tasks = [
        AxiomTask(
            objective=f"Synthetic local workload {index}",
            depth=1,
            tokensRemaining=8_000,
            requiredCompute={"model": "llama2-7b"},
        )
        for index in range(100)
    ]

    start = perf_counter()
    results = await asyncio.gather(*(runtime.submit(task) for task in tasks))
    elapsed_ms = (perf_counter() - start) * 1_000

    assert all(result.status.value == "succeeded" for result in results)
    assert all(result.execution_location == ExecutionLocation.LOCAL for result in results)
    # The simulator is intentionally tiny; retain a generous CI-level ceiling while
    # exposing any pathological scheduling regression in a constrained runner.
    assert elapsed_ms < 2_000
