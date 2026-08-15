"""Container-friendly AXIOM executor entry point.

The process reads a validated `AxiomTask` envelope from `AXIOM_TASK_JSON` and
uses the same runtime contracts as the CLI. It is deliberately model-provider
agnostic; in simulation mode it is deterministic and safe for Kubernetes tests.
"""

from __future__ import annotations

import asyncio
from json import dumps, loads
from os import environ

from axiom.cli import build_runtime
from axiom.models import AxiomTask


async def execute_from_environment() -> dict[str, object]:
    """Execute the canonical task supplied by the controller or a Kubernetes Job."""
    raw_task = environ.get("AXIOM_TASK_JSON")
    if not raw_task:
        raise RuntimeError("AXIOM_TASK_JSON must contain a canonical AxiomTask JSON object")
    task = AxiomTask.model_validate(loads(raw_task))
    simulate = environ.get("AXIOM_SIMULATION", "false").lower() in {"1", "true", "yes"}
    runtime = build_runtime(simulate=simulate)
    result = await runtime.submit(task)
    return result.model_dump(mode="json")


def main() -> int:
    """Run the executor process and emit exactly one JSON terminal result."""
    try:
        result = asyncio.run(execute_from_environment())
        print(dumps(result, sort_keys=True))
        return 0 if result["status"] == "succeeded" else 2
    except Exception as error:  # noqa: BLE001 - process boundary
        print(dumps({"status": "failed", "error": str(error)}))
        return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
