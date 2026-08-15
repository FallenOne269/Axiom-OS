"""Transparent per-task cost attribution for local and remote execution."""

from __future__ import annotations

from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal

from pydantic import BaseModel, ConfigDict, Field

from .models import AxiomResult, CostBreakdown, ExecutionLocation, Usage


class CostRates(BaseModel):
    """Declared cost inputs; values default to zero to avoid hidden assumptions."""

    model_config = ConfigDict(extra="forbid")

    local_compute_per_second_usd: float = Field(default=0.0, ge=0)
    remote_compute_per_second_usd: float = Field(default=0.0, ge=0)
    input_token_per_million_usd: float = Field(default=0.0, ge=0)
    output_token_per_million_usd: float = Field(default=0.0, ge=0)
    egress_gib_usd: float = Field(default=0.0, ge=0)


def money(value: float) -> float:
    """Round USD values predictably to eight fractional digits."""
    return float(Decimal(str(value)).quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP))


class CostCalculator:
    """Calculate attributable spend from a result's usage and declared rates."""

    def __init__(self, rates: CostRates | None = None) -> None:
        self.rates = rates or CostRates()

    def calculate(self, usage: Usage, location: ExecutionLocation) -> CostBreakdown:
        """Calculate a cost record without fetching or estimating external prices."""
        runtime_seconds = usage.latency_ms / 1_000
        local = (
            runtime_seconds * self.rates.local_compute_per_second_usd
            if location == ExecutionLocation.LOCAL
            else 0.0
        )
        remote = (
            runtime_seconds * self.rates.remote_compute_per_second_usd
            if location == ExecutionLocation.REMOTE
            else 0.0
        )
        tokens = (
            usage.prompt_tokens / 1_000_000 * self.rates.input_token_per_million_usd
            + usage.completion_tokens / 1_000_000 * self.rates.output_token_per_million_usd
        )
        network = usage.egress_bytes / (1024**3) * self.rates.egress_gib_usd
        return CostBreakdown(
            local_compute_usd=money(local),
            remote_compute_usd=money(remote),
            token_usd=money(tokens),
            network_usd=money(network),
            total_usd=money(local + remote + tokens + network),
        )


class CostLedger:
    """In-process aggregation of immutable task result cost records."""

    def __init__(self) -> None:
        self._results: list[AxiomResult] = []

    def record(self, result: AxiomResult) -> None:
        """Record one terminal task result exactly once per caller invocation."""
        self._results.append(result)

    def breakdown(self, trace_id: str | None = None) -> dict[str, float | int]:
        """Aggregate cost across every result or a single trace tree."""
        selected = [
            result for result in self._results if trace_id is None or result.trace_id == trace_id
        ]
        totals: defaultdict[str, float] = defaultdict(float)
        for result in selected:
            totals["local_compute_usd"] += result.cost.local_compute_usd
            totals["remote_compute_usd"] += result.cost.remote_compute_usd
            totals["token_usd"] += result.cost.token_usd
            totals["network_usd"] += result.cost.network_usd
            totals["total_usd"] += result.cost.total_usd
        return {"task_count": len(selected), **{key: money(value) for key, value in totals.items()}}
