import pytest

from axiom.models import (
    AxiomTask,
    ExecutionEnv,
    ExecutionLocation,
    LocalCapabilities,
    RouteReason,
    RoutingPolicy,
)
from axiom.router import ExecutionRouter


def router(*, remote_healthy: bool = True) -> ExecutionRouter:
    return ExecutionRouter(
        LocalCapabilities(
            available_models={"llama2-7b"},
            gpu_available=False,
            free_vram_mb=0,
            local_context_window=32_000,
            max_serialized_state_bytes=1_024,
            predicted_frame_ms=4,
        ),
        RoutingPolicy(local_max_depth=3, local_frame_budget_ms=50),
        remote_healthy=remote_healthy,
    )


def task(**overrides: object) -> AxiomTask:
    payload = {
        "objective": "Route this task safely",
        "maxDepth": 1,
        "tokensRemaining": 8_000,
        "requiredCompute": {"model": "llama2-7b"},
        "contextSizeBytes": 2,
    }
    payload.update(overrides)
    return AxiomTask.model_validate(payload)


def test_eligible_task_routes_local() -> None:
    decision = router().decide(task())
    assert decision.location == ExecutionLocation.LOCAL
    assert decision.reason == RouteReason.LOCAL_ELIGIBLE
    assert not decision.degraded


def test_depth_over_local_limit_spills_to_remote() -> None:
    decision = router().decide(task(maxDepth=4))
    assert decision.location == ExecutionLocation.REMOTE
    assert decision.reason == RouteReason.DEPTH_LIMIT


def test_explicit_local_rejects_when_model_is_not_cached() -> None:
    decision = router().decide(
        task(executionEnv=ExecutionEnv.LOCAL, requiredCompute={"model": "llama2-13b"})
    )
    assert decision.rejected
    assert decision.location is None
    assert decision.reason == RouteReason.MODEL_NOT_CACHED


@pytest.mark.parametrize("outage", ["unhealthy", "open-circuit", "both"])
@pytest.mark.parametrize("allow_degraded_local", [True, False])
@pytest.mark.parametrize("model", ["llama2-7b", "uncached-model"])
def test_explicit_remote_rejects_when_remote_is_unavailable(
    outage: str, allow_degraded_local: bool, model: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("axiom.router.monotonic", lambda: 100.0)
    routing = router(remote_healthy=outage == "open-circuit")
    if outage in {"open-circuit", "both"}:
        for _ in range(routing.policy.remote_circuit_failure_threshold):
            routing.record_remote_failure()
    request = task(
        executionEnv=ExecutionEnv.REMOTE,
        allowDegradedLocal=allow_degraded_local,
        requiredCompute={"model": model},
    )

    decision = routing.decide(request)

    assert decision.location is None
    assert decision.rejected
    assert not decision.degraded
    assert decision.reason == RouteReason.REMOTE_UNAVAILABLE_REJECTED
    assert "explicit remote request" in decision.detail
    assert "remote tier unavailable" in decision.detail
    assert decision.task_id == request.id
    assert decision.trace_id == request.trace_id


@pytest.mark.parametrize("allow_degraded_local", [True, False])
@pytest.mark.parametrize("model", ["llama2-7b", "uncached-model"])
def test_explicit_remote_uses_available_remote_regardless_of_local_eligibility(
    allow_degraded_local: bool, model: str
) -> None:
    decision = router().decide(
        task(
            executionEnv=ExecutionEnv.REMOTE,
            allowDegradedLocal=allow_degraded_local,
            requiredCompute={"model": model},
        )
    )

    assert decision.location == ExecutionLocation.REMOTE
    assert decision.reason == RouteReason.EXPLICIT_REMOTE
    assert not decision.rejected
    assert not decision.degraded


def test_explicit_remote_resumes_at_circuit_reset_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = 100.0
    monkeypatch.setattr("axiom.router.monotonic", lambda: now)
    routing = router()
    request = task(executionEnv=ExecutionEnv.REMOTE, allowDegradedLocal=True)
    for _ in range(routing.policy.remote_circuit_failure_threshold):
        routing.record_remote_failure()

    now = 100.0 + routing.policy.remote_circuit_reset_seconds - 0.001
    before_reset = routing.decide(request)

    assert before_reset.location is None
    assert before_reset.rejected
    assert not before_reset.degraded
    assert before_reset.reason == RouteReason.REMOTE_UNAVAILABLE_REJECTED

    now = 100.0 + routing.policy.remote_circuit_reset_seconds
    after_reset = routing.decide(request)

    assert after_reset.location == ExecutionLocation.REMOTE
    assert after_reset.reason == RouteReason.EXPLICIT_REMOTE
    assert not after_reset.rejected
    assert not after_reset.degraded


def test_explicit_remote_resumes_when_remote_health_recovers() -> None:
    routing = router(remote_healthy=False)
    request = task(executionEnv=ExecutionEnv.REMOTE, allowDegradedLocal=True)

    unavailable = routing.decide(request)
    routing.set_remote_health(True)
    recovered = routing.decide(request)

    assert unavailable.location is None
    assert unavailable.rejected
    assert not unavailable.degraded
    assert unavailable.reason == RouteReason.REMOTE_UNAVAILABLE_REJECTED
    assert recovered.location == ExecutionLocation.REMOTE
    assert recovered.reason == RouteReason.EXPLICIT_REMOTE
    assert not recovered.rejected
    assert not recovered.degraded


def test_remote_offline_rejects_remote_only_task() -> None:
    decision = router(remote_healthy=False).decide(
        task(maxDepth=4, executionEnv=ExecutionEnv.REMOTE)
    )
    assert decision.rejected
    assert decision.location is None
    assert decision.reason == RouteReason.REMOTE_UNAVAILABLE_REJECTED
