"""Deterministic local-versus-remote placement policy and resilience state."""

from __future__ import annotations

from dataclasses import dataclass
from time import monotonic

from .models import (
    AxiomTask,
    ExecutionEnv,
    ExecutionLocation,
    LocalCapabilities,
    RouteDecision,
    RouteReason,
    RoutingPolicy,
)


@dataclass
class CircuitBreaker:
    """Minimal, deterministic circuit breaker for remote task submission."""

    failure_threshold: int
    reset_seconds: float
    failures: int = 0
    opened_at: float | None = None

    def is_open(self, now: float | None = None) -> bool:
        """Report whether the remote route is currently withheld."""
        if self.opened_at is None:
            return False
        current = monotonic() if now is None else now
        if current - self.opened_at >= self.reset_seconds:
            self.failures = 0
            self.opened_at = None
            return False
        return True

    def record_success(self) -> None:
        """Close the circuit after a successful remote execution."""
        self.failures = 0
        self.opened_at = None

    def record_failure(self, now: float | None = None) -> None:
        """Record a failure and open the circuit when its threshold is reached."""
        self.failures += 1
        if self.failures >= self.failure_threshold:
            self.opened_at = monotonic() if now is None else now


class ExecutionRouter:
    """Route an immutable task using a documented order of constraints."""

    def __init__(
        self,
        capabilities: LocalCapabilities,
        policy: RoutingPolicy | None = None,
        remote_healthy: bool = True,
        circuit_breaker: CircuitBreaker | None = None,
    ) -> None:
        self.capabilities = capabilities
        self.policy = policy or RoutingPolicy()
        self.remote_healthy = remote_healthy
        self.circuit_breaker = circuit_breaker or CircuitBreaker(
            failure_threshold=self.policy.remote_circuit_failure_threshold,
            reset_seconds=self.policy.remote_circuit_reset_seconds,
        )

    @property
    def remote_available(self) -> bool:
        """Return the combined remote health and breaker state."""
        return self.remote_healthy and not self.circuit_breaker.is_open()

    def set_remote_health(self, healthy: bool) -> None:
        """Update the latest liveness signal received from the remote tier."""
        self.remote_healthy = healthy
        if healthy:
            self.circuit_breaker.record_success()

    def record_remote_failure(self) -> None:
        """Update resilience state when remote execution fails."""
        self.circuit_breaker.record_failure()

    def record_remote_success(self) -> None:
        """Update resilience state when remote execution succeeds."""
        self.circuit_breaker.record_success()

    def decide(self, task: AxiomTask) -> RouteDecision:
        """Select an execution tier and preserve the exact basis for the decision."""
        if task.execution_env == ExecutionEnv.LOCAL:
            return self._local_or_degraded(task, RouteReason.EXPLICIT_LOCAL, explicit=True)
        if task.execution_env == ExecutionEnv.REMOTE:
            return self._remote_or_degraded(task, RouteReason.EXPLICIT_REMOTE, explicit=True)

        local_failure = self._local_constraint(task)
        if local_failure is None:
            return self._decision(
                task,
                ExecutionLocation.LOCAL,
                RouteReason.LOCAL_ELIGIBLE,
                "local capability checks passed",
            )
        return self._remote_or_degraded(task, local_failure)

    def _local_constraint(self, task: AxiomTask) -> RouteReason | None:
        """Return the first disqualifying local constraint, if any."""
        caps = self.capabilities
        if not caps.local_healthy:
            return RouteReason.FRAME_BUDGET
        if task.depth > self.policy.local_max_depth:
            return RouteReason.DEPTH_LIMIT
        if task.tokens_remaining > caps.local_context_window:
            return RouteReason.CONTEXT_LIMIT
        if task.context_size_bytes > caps.max_serialized_state_bytes:
            return RouteReason.SERIALIZED_STATE_LIMIT
        if task.required_compute.model not in caps.available_models:
            return RouteReason.MODEL_NOT_CACHED
        if task.required_compute.gpu_required and not caps.gpu_available:
            return RouteReason.GPU_UNAVAILABLE
        if task.required_compute.min_vram_mb > caps.free_vram_mb:
            return RouteReason.VRAM_UNAVAILABLE
        estimate = task.required_compute.estimated_local_latency_ms or caps.predicted_frame_ms
        if estimate > self.policy.local_frame_budget_ms:
            return RouteReason.FRAME_BUDGET
        return None

    def _local_or_degraded(
        self, task: AxiomTask, reason: RouteReason, *, explicit: bool = False
    ) -> RouteDecision:
        constraint = self._local_constraint(task)
        if constraint is None:
            return self._decision(
                task, ExecutionLocation.LOCAL, reason, "local execution requested"
            )
        if explicit:
            return self._decision(
                task,
                None,
                constraint,
                f"explicit local request cannot be honored: {constraint.value}",
                rejected=True,
            )
        return self._remote_or_degraded(task, constraint)

    def _remote_or_degraded(
        self, task: AxiomTask, reason: RouteReason, *, explicit: bool = False
    ) -> RouteDecision:
        if self.remote_available:
            return self._decision(
                task,
                ExecutionLocation.REMOTE,
                reason,
                "remote execution selected after local policy evaluation"
                if not explicit
                else "remote execution requested",
            )

        # Explicit placement is authoritative. Never silently convert an
        # explicit remote request into local execution because degradation is
        # enabled; doing so would violate the task's placement contract.
        if explicit:
            return self._decision(
                task,
                None,
                RouteReason.REMOTE_UNAVAILABLE_REJECTED,
                "explicit remote request cannot be honored: remote tier unavailable",
                rejected=True,
            )

        local_constraint = self._local_constraint(task)
        if task.allow_degraded_local and local_constraint is None:
            return self._decision(
                task,
                ExecutionLocation.LOCAL,
                RouteReason.REMOTE_UNAVAILABLE_DEGRADED,
                "remote tier unavailable; executing locally in degraded mode",
                degraded=True,
            )
        return self._decision(
            task,
            None,
            RouteReason.REMOTE_UNAVAILABLE_REJECTED,
            f"remote tier unavailable and local execution is ineligible ({local_constraint or reason})",
            rejected=True,
        )

    def _decision(
        self,
        task: AxiomTask,
        location: ExecutionLocation | None,
        reason: RouteReason,
        detail: str,
        *,
        degraded: bool = False,
        rejected: bool = False,
    ) -> RouteDecision:
        return RouteDecision(
            task_id=task.id,
            trace_id=task.trace_id,
            location=location,
            reason=reason,
            detail=detail,
            degraded=degraded,
            rejected=rejected,
            policy=self.policy,
            capabilities=self.capabilities,
        )
