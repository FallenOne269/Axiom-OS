import pytest

from axiom.cost import CostCalculator, CostRates
from axiom.executor import DeterministicExecutor, RemoteSubmissionExecutor
from axiom.hybrid_client import AxiomClient, HmacEnvelopeSigner, InProcessRemoteTransport
from axiom.models import AxiomTask, ExecutionEnv, ExecutionLocation, LocalCapabilities, RouteReason
from axiom.orchestrator import AxiomOrchestrator, LocalTaskStore
from axiom.router import ExecutionRouter
from axiom.tracer import InMemoryTracer


@pytest.mark.asyncio
async def test_depth_spillover_uses_signed_remote_transport_and_remote_cost(tmp_path) -> None:
    """Verify depth spillover uses signed remote transport and incurs remote cost."""
    signer = HmacEnvelopeSigner(b"test-signing-secret-at-least-sixteen-bytes")
    remote_client = AxiomClient(signer, InProcessRemoteTransport(signer, delay_ms=1))
    runtime = AxiomOrchestrator(
        router=ExecutionRouter(LocalCapabilities(available_models={"llama2-7b"})),
        local_executor=DeterministicExecutor(ExecutionLocation.LOCAL),
        remote_executor=RemoteSubmissionExecutor(remote_client),
        tracer=InMemoryTracer(),
        cost_calculator=CostCalculator(CostRates(remote_compute_per_second_usd=0.1)),
        task_store=LocalTaskStore(tmp_path / "state"),
    )
    task = AxiomTask(
        objective="This bounded task should spill to the remote tier",
        depth=4,
        tokensRemaining=8_000,
        requiredCompute={"model": "llama2-7b"},
    )

    result = await runtime.submit(task)

    assert result.status.value == "succeeded"
    assert result.execution_location == ExecutionLocation.REMOTE
    assert "remote: simulated execution" in (result.output or "")
    assert result.cost.remote_compute_usd > 0
    assert runtime.router.circuit_breaker.failures == 0


def test_explicit_remote_does_not_degrade_to_local_when_remote_is_unavailable() -> None:
    """Verify unavailable explicit remote placement is rejected despite local eligibility."""
    router = ExecutionRouter(
        LocalCapabilities(available_models={"llama2-7b"}),
        remote_healthy=False,
    )
    task = AxiomTask(
        objective="Remote-only task",
        executionEnv=ExecutionEnv.REMOTE,
        allowDegradedLocal=True,
        requiredCompute={"model": "llama2-7b"},
    )

    decision = router.decide(task)

    assert decision.location is None
    assert decision.rejected is True
    assert decision.degraded is False
    assert decision.reason == RouteReason.REMOTE_UNAVAILABLE_REJECTED
    assert "explicit remote request" in decision.detail


@pytest.mark.asyncio
async def test_remote_transport_rejects_modified_signed_task() -> None:
    """Verify remote transport rejects a task modified after its envelope was signed."""
    signer = HmacEnvelopeSigner(b"test-signing-secret-at-least-sixteen-bytes")
    transport = InProcessRemoteTransport(signer)
    original = AxiomTask(objective="Original task", requiredCompute={"model": "llama2-7b"})
    envelope = signer.sign(original)
    modified = envelope.__class__(
        task=original.model_copy(update={"objective": "Modified task"}),
        signature=envelope.signature,
    )

    with pytest.raises(PermissionError, match="signature"):
        await transport.submit(modified)
