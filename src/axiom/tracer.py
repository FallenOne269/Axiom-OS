"""Privacy-aware tracing and append-only JSONL audit records."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime
from hashlib import sha256
from json import dumps, loads
from pathlib import Path
from threading import Lock
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from .models import AxiomTask, ExecutionLocation

SENSITIVE_ATTRIBUTE_NAMES = {
    "objective",
    "prompt",
    "serialized_state",
    "serializedState",
    "user_id",
    "context_preview",
}


def utc_now_iso() -> str:
    """Produce an ISO-8601 UTC timestamp."""
    return datetime.now(UTC).isoformat()


def redact_attributes(attributes: dict[str, Any]) -> dict[str, Any]:
    """Hash sensitive values before they can enter an audit or trace backend."""
    redacted: dict[str, Any] = {}
    for key, value in attributes.items():
        if key in SENSITIVE_ATTRIBUTE_NAMES and value is not None:
            redacted[f"{key}_sha256"] = sha256(str(value).encode("utf-8")).hexdigest()
            continue
        if isinstance(value, (str, int, float, bool)) or value is None:
            redacted[key] = value
        elif isinstance(value, list):
            redacted[key] = [str(item) for item in value]
        else:
            redacted[key] = str(value)
    return redacted


class TraceEvent(BaseModel):
    """A normalized, sanitized AXIOM event suitable for OTLP translation."""

    model_config = ConfigDict(extra="forbid")

    event_id: str = Field(default_factory=lambda: f"evt_{uuid4().hex}")
    trace_id: str
    task_id: str
    name: str
    timestamp: str = Field(default_factory=utc_now_iso)
    execution_location: ExecutionLocation | None = None
    parent_span_id: str | None = None
    span_id: str = Field(default_factory=lambda: uuid4().hex[:16])
    attributes: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def for_task(
        cls,
        task: AxiomTask,
        name: str,
        *,
        execution_location: ExecutionLocation | None = None,
        parent_span_id: str | None = None,
        **attributes: Any,
    ) -> TraceEvent:
        """Create an event that retains correlation but excludes raw task contents."""
        attributes.setdefault("task_digest", task.digest())
        attributes.setdefault("depth", task.depth)
        attributes.setdefault("model", task.required_compute.model)
        return cls(
            trace_id=task.trace_id,
            task_id=task.id,
            name=name,
            execution_location=execution_location,
            parent_span_id=parent_span_id,
            attributes=redact_attributes(attributes),
        )


class AuditLedger:
    """Append-only per-trace JSONL ledger used by simulation and local operation."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()

    def path_for(self, trace_id: str) -> Path:
        """Return the immutable-audit path associated with a trace identifier."""
        return self.root / f"{trace_id}.jsonl"

    def append(self, event: TraceEvent) -> None:
        """Atomically append one sanitized event line to its trace ledger."""
        record = event.model_dump(mode="json")
        with self._lock, self.path_for(event.trace_id).open("a", encoding="utf-8") as handle:
            handle.write(dumps(record, sort_keys=True, separators=(",", ":")) + "\n")

    def read_trace(self, trace_id: str) -> list[TraceEvent]:
        """Load the complete audit sequence for a trace, oldest event first."""
        path = self.path_for(trace_id)
        if not path.exists():
            return []
        return [
            TraceEvent.model_validate(loads(line)) for line in path.read_text().splitlines() if line
        ]

    def traces(self) -> Iterable[str]:
        """Yield recorded trace IDs without inspecting individual records."""
        for path in sorted(self.root.glob("tr_*.jsonl")):
            yield path.stem


class InMemoryTracer:
    """OTLP-compatible event façade for testing and zero-infrastructure runs."""

    def __init__(self, ledger: AuditLedger | None = None) -> None:
        self.ledger = ledger
        self.events: list[TraceEvent] = []
        self._by_trace: dict[str, list[TraceEvent]] = defaultdict(list)

    def emit(self, event: TraceEvent) -> TraceEvent:
        """Record one event locally and optionally append it to the audit ledger."""
        self.events.append(event)
        self._by_trace[event.trace_id].append(event)
        if self.ledger:
            self.ledger.append(event)
        return event

    def events_for(self, trace_id: str) -> list[TraceEvent]:
        """Return in-process spans for a single trace identifier."""
        return list(self._by_trace.get(trace_id, []))


def emit_task_event(
    tracer: InMemoryTracer,
    task: AxiomTask,
    name: str,
    *,
    execution_location: ExecutionLocation | None = None,
    parent_span_id: str | None = None,
    **attributes: Any,
) -> TraceEvent:
    """Construct and emit an AXIOM event in one auditable operation."""
    return tracer.emit(
        TraceEvent.for_task(
            task,
            name,
            execution_location=execution_location,
            parent_span_id=parent_span_id,
            **attributes,
        )
    )
