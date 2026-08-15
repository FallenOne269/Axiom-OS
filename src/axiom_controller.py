"""Kubernetes-controller compatible entry point for AXIOM custom resources.

This module keeps business behavior independent from a specific operator framework.
A production deployment can call `handle_axiom_job` from Kopf, KubeBuilder, or a
webhook consumer without changing task routing, tracing, or cost semantics.
"""

from __future__ import annotations

import asyncio
from typing import Any

from axiom.cli import build_runtime
from axiom.models import AxiomTask


async def handle_axiom_job(body: dict[str, Any], *, simulate: bool = True) -> dict[str, Any]:
    """Execute an AxiomJob-shaped object and return a CRD-compatible status patch."""
    task = AxiomTask.from_kubernetes_spec(body)
    runtime = build_runtime(simulate=simulate)
    result = await runtime.submit(task)
    return {
        "status": {
            "phase": result.status.value.capitalize(),
            "executionLocation": result.execution_location.value
            if result.execution_location
            else "unknown",
            "tokensUsed": result.usage.total_tokens,
            "costEstimate": result.cost.total_usd,
            "traceSpanId": task.trace_id,
            "message": result.error or "completed",
            "completionTime": result.completed_at.isoformat(),
        }
    }


def reconcile(body: dict[str, Any], *, simulate: bool = True) -> dict[str, Any]:
    """Synchronous adapter for simple controller frameworks and test harnesses."""
    return asyncio.run(handle_axiom_job(body, simulate=simulate))


# Optional Kopf integration is deliberately lazy so local CI does not require Kubernetes.
def register_kopf_handlers() -> None:
    """Register a Kopf event handler when the optional deployment dependency exists."""
    try:
        import kopf
    except ImportError as error:  # pragma: no cover - deployment-only branch
        raise RuntimeError(
            "Kubernetes operator support requires the 'kubernetes' optional dependency"
        ) from error

    @kopf.on.create("axiom.ai", "v1alpha1", "axiomjobs")
    async def on_create(body: dict[str, Any], **_: Any) -> dict[str, Any]:
        return await handle_axiom_job(body, simulate=False)


if __name__ == "__main__":  # pragma: no cover
    register_kopf_handlers()
