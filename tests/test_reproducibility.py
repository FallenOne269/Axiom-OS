import pytest

from axiom.cost import CostCalculator
from axiom.executor import DeterministicExecutor
from axiom.models import AxiomTask, ExecutionLocation, LocalCapabilities
from axiom.orchestrator import AxiomOrchestrator, LocalTaskStore
from axiom.router import ExecutionRouter
from axiom.tracer import InMemoryTracer


@pytest.mark.asyncio
async def test_exported_replay_manifest_preserves_task_trace_and_digest(tmp_path) -> None:
    store = LocalTaskStore(tmp_path / "state")
    runtime = AxiomOrchestrator(
        router=ExecutionRouter(LocalCapabilities(available_models={"llama2-7b"})),
        local_executor=DeterministicExecutor(ExecutionLocation.LOCAL),
        remote_executor=DeterministicExecutor(ExecutionLocation.REMOTE),
        tracer=InMemoryTracer(),
        cost_calculator=CostCalculator(),
        task_store=store,
    )
    task = AxiomTask(
        objective="Produce deterministic replay evidence",
        depth=1,
        tokensRemaining=8_000,
        requiredCompute={"model": "llama2-7b"},
    )

    first_result = await runtime.submit(task)
    manifest = runtime.export_replay(task.id)
    verification = runtime.verify_replay(task.id)

    assert manifest.trace_id == task.trace_id
    assert manifest.task_digest == task.digest()
    assert manifest.expected_result_digest == first_result.result_digest
    assert verification["verified"] is True


@pytest.mark.asyncio
async def test_replaying_identical_deterministic_task_has_identical_output_digest(tmp_path) -> None:
    store = LocalTaskStore(tmp_path / "state")
    runtime = AxiomOrchestrator(
        router=ExecutionRouter(LocalCapabilities(available_models={"llama2-7b"})),
        local_executor=DeterministicExecutor(ExecutionLocation.LOCAL),
        remote_executor=DeterministicExecutor(ExecutionLocation.REMOTE),
        tracer=InMemoryTracer(),
        cost_calculator=CostCalculator(),
        task_store=store,
    )
    task = AxiomTask(
        objective="Replay this identical input", requiredCompute={"model": "llama2-7b"}
    )

    first = await runtime.submit(task)
    manifest = runtime.export_replay(task.id)
    second = await runtime.replay(manifest)

    assert second.trace_id == first.trace_id
    assert second.result_digest == first.result_digest
