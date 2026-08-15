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


def test_explicit_remote_degrades_to_eligible_local_when_remote_is_offline() -> None:
    decision = router(remote_healthy=False).decide(task(executionEnv=ExecutionEnv.REMOTE))
    assert decision.location == ExecutionLocation.LOCAL
    assert decision.degraded
    assert decision.reason == RouteReason.REMOTE_UNAVAILABLE_DEGRADED


def test_remote_offline_rejects_remote_only_task() -> None:
    decision = router(remote_healthy=False).decide(
        task(maxDepth=4, executionEnv=ExecutionEnv.REMOTE)
    )
    assert decision.rejected
    assert decision.location is None
    assert decision.reason == RouteReason.REMOTE_UNAVAILABLE_REJECTED
