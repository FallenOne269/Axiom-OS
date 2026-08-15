import pytest

from axiom.cost import CostCalculator, CostRates
from axiom.executor import DeterministicExecutor
from axiom.models import AxiomTask, ExecutionLocation, LocalCapabilities
from axiom.orchestrator import AxiomOrchestrator, LocalTaskStore
from axiom.router import ExecutionRouter
from axiom.tracer import AuditLedger, InMemoryTracer


@pytest.mark.asyncio
async def test_local_execution_persists_result_and_redacts_objective(tmp_path) -> None:
    secret_objective = "TOP-SECRET: do not expose this objective"
    task = AxiomTask(
        objective=secret_objective,
        depth=1,
        tokensRemaining=8_000,
        requiredCompute={"model": "llama2-7b"},
    )
    ledger = AuditLedger(tmp_path / "audit")
    runtime = AxiomOrchestrator(
        router=ExecutionRouter(LocalCapabilities(available_models={"llama2-7b"})),
        local_executor=DeterministicExecutor(ExecutionLocation.LOCAL),
        remote_executor=DeterministicExecutor(ExecutionLocation.REMOTE),
        tracer=InMemoryTracer(ledger),
        cost_calculator=CostCalculator(CostRates(local_compute_per_second_usd=0.02)),
        task_store=LocalTaskStore(tmp_path / "state"),
    )

    result = await runtime.submit(task)

    assert result.execution_location == ExecutionLocation.LOCAL
    assert result.status.value == "succeeded"
    assert result.cost.local_compute_usd >= 0
    assert runtime.task_store.load_result(task.id).result_digest == result.result_digest

    audit_text = ledger.path_for(task.trace_id).read_text(encoding="utf-8")
    assert secret_objective not in audit_text
    assert "objective_sha256" in audit_text
    assert task.trace_id in audit_text
