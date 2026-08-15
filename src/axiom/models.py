"""Typed, serializable contracts shared by all AXIOM execution tiers."""

from __future__ import annotations

from base64 import b64decode
from datetime import UTC, datetime
from enum import StrEnum
from hashlib import sha256
from json import dumps
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_CONTEXT_TOKENS = 128_000


def utc_now() -> datetime:
    """Return a timezone-aware timestamp suitable for persisted records."""
    return datetime.now(UTC)


def new_trace_id() -> str:
    """Create a stable, opaque trace identifier for a task execution tree."""
    return f"tr_{uuid4().hex}"


def new_task_id() -> str:
    """Create an opaque task identifier."""
    return f"task_{uuid4().hex[:16]}"


class DeploymentMode(StrEnum):
    LOCAL = "local"
    REMOTE = "remote"
    HYBRID = "hybrid"
    SIMULATION = "simulation"


class ExecutionEnv(StrEnum):
    AUTO = "auto"
    LOCAL = "local"
    REMOTE = "remote"


class ExecutionLocation(StrEnum):
    LOCAL = "local"
    REMOTE = "remote"


class TaskStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    REJECTED = "rejected"


class RouteReason(StrEnum):
    EXPLICIT_LOCAL = "explicit_local"
    EXPLICIT_REMOTE = "explicit_remote"
    LOCAL_ELIGIBLE = "local_eligible"
    DEPTH_LIMIT = "depth_limit"
    CONTEXT_LIMIT = "context_limit"
    SERIALIZED_STATE_LIMIT = "serialized_state_limit"
    MODEL_NOT_CACHED = "model_not_cached"
    GPU_UNAVAILABLE = "gpu_unavailable"
    VRAM_UNAVAILABLE = "vram_unavailable"
    FRAME_BUDGET = "frame_budget"
    REMOTE_UNAVAILABLE_DEGRADED = "remote_unavailable_degraded"
    REMOTE_UNAVAILABLE_REJECTED = "remote_unavailable_rejected"


class ComputeSpec(BaseModel):
    """Model and accelerator requirements carried with an execution request."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    model: str = Field(default="llama2-7b", min_length=1, max_length=256)
    min_vram_mb: int = Field(default=0, ge=0, alias="minVramMb")
    gpu_required: bool = Field(default=False, alias="gpuRequired")
    prefer_local: bool = Field(default=True, alias="preferLocal")
    estimated_local_latency_ms: float | None = Field(
        default=None, ge=0, alias="estimatedLocalLatencyMs"
    )


class AxiomTask(BaseModel):
    """Canonical cross-tier task envelope.

    The `trace_id` is generated once and must be preserved by every adapter. The
    serialized state is Base64 encoded to make transport boundaries explicit.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(default_factory=new_task_id, min_length=6)
    trace_id: str = Field(default_factory=new_trace_id, min_length=8, alias="traceId")
    objective: str = Field(min_length=1, max_length=100_000)
    depth: int = Field(default=0, ge=0, le=10, alias="maxDepth")
    tokens_remaining: int = Field(
        default=MAX_CONTEXT_TOKENS, ge=1_000, le=MAX_CONTEXT_TOKENS, alias="tokensRemaining"
    )
    context_size_bytes: int = Field(default=0, ge=0, alias="contextSizeBytes")
    required_compute: ComputeSpec = Field(default_factory=ComputeSpec, alias="requiredCompute")
    serialized_state: str = Field(default="e30=", alias="serializedState")
    parent_task_id: str | None = Field(default=None, alias="parentTaskId")
    execution_env: ExecutionEnv = Field(default=ExecutionEnv.AUTO, alias="executionEnv")
    allow_degraded_local: bool = Field(default=True, alias="allowDegradedLocal")
    created_at: datetime = Field(default_factory=utc_now, alias="createdAt")

    @field_validator("serialized_state")
    @classmethod
    def state_must_be_base64(cls, value: str) -> str:
        try:
            b64decode(value.encode("ascii"), validate=True)
        except Exception as error:  # noqa: BLE001 - validation boundary
            raise ValueError("serializedState must be valid Base64") from error
        return value

    @model_validator(mode="after")
    def validate_context_size(self) -> AxiomTask:
        decoded_size = len(b64decode(self.serialized_state.encode("ascii")))
        if self.context_size_bytes and decoded_size > self.context_size_bytes:
            raise ValueError("serializedState exceeds declared contextSizeBytes")
        return self

    @classmethod
    def from_kubernetes_spec(cls, body: dict[str, Any], *, task_id: str | None = None) -> AxiomTask:
        """Build a task from an AxiomJob resource while preserving its trace ID."""
        metadata = body.get("metadata", {})
        spec = dict(body.get("spec", {}))
        spec["id"] = task_id or metadata.get("name") or new_task_id()
        return cls.model_validate(spec)

    def canonical_json(self) -> str:
        """Serialize the task deterministically for signing and reproducibility."""
        payload = self.model_dump(mode="json", by_alias=True)
        return dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

    def digest(self) -> str:
        """Calculate the SHA-256 digest of the canonical task contract."""
        return sha256(self.canonical_json().encode("utf-8")).hexdigest()


class LocalCapabilities(BaseModel):
    """Point-in-time local capability snapshot used in a routing decision."""

    model_config = ConfigDict(extra="forbid")

    available_models: set[str] = Field(default_factory=set)
    gpu_available: bool = False
    free_vram_mb: int = Field(default=0, ge=0)
    local_context_window: int = Field(default=32_000, ge=1_000)
    max_serialized_state_bytes: int = Field(default=4_000_000, ge=1)
    predicted_frame_ms: float = Field(default=5.0, ge=0)
    local_healthy: bool = True


class RoutingPolicy(BaseModel):
    """Explicit safety and latency limits for deterministic placement decisions."""

    model_config = ConfigDict(extra="forbid")

    local_max_depth: int = Field(default=3, ge=0, le=10)
    local_frame_budget_ms: float = Field(default=50.0, gt=0)
    remote_submit_budget_ms: float = Field(default=200.0, gt=0)
    remote_circuit_failure_threshold: int = Field(default=3, ge=1)
    remote_circuit_reset_seconds: float = Field(default=30.0, gt=0)


class RouteDecision(BaseModel):
    """The complete and auditable output of routing a task."""

    model_config = ConfigDict(extra="forbid")

    task_id: str
    trace_id: str
    location: ExecutionLocation | None
    reason: RouteReason
    degraded: bool = False
    rejected: bool = False
    detail: str = ""
    policy: RoutingPolicy
    capabilities: LocalCapabilities
    decided_at: datetime = Field(default_factory=utc_now)


class Usage(BaseModel):
    """Resource measurements returned by an executor."""

    model_config = ConfigDict(extra="forbid")

    prompt_tokens: int = Field(default=0, ge=0)
    completion_tokens: int = Field(default=0, ge=0)
    latency_ms: float = Field(default=0, ge=0)
    queue_ms: float = Field(default=0, ge=0)
    egress_bytes: int = Field(default=0, ge=0)

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


class CostBreakdown(BaseModel):
    """Per-task local and remote spend calculated from declared rate inputs."""

    model_config = ConfigDict(extra="forbid")

    local_compute_usd: float = 0.0
    remote_compute_usd: float = 0.0
    token_usd: float = 0.0
    network_usd: float = 0.0
    total_usd: float = 0.0
    currency: Literal["USD"] = "USD"


class AxiomResult(BaseModel):
    """Normalized terminal record returned to the CLI, controller, and audit ledger."""

    model_config = ConfigDict(extra="forbid")

    task_id: str
    trace_id: str
    status: TaskStatus
    execution_location: ExecutionLocation | None = None
    output: str | None = None
    error: str | None = None
    usage: Usage = Field(default_factory=Usage)
    cost: CostBreakdown = Field(default_factory=CostBreakdown)
    result_digest: str | None = None
    started_at: datetime = Field(default_factory=utc_now)
    completed_at: datetime = Field(default_factory=utc_now)

    @model_validator(mode="after")
    def terminal_state_is_consistent(self) -> AxiomResult:
        if self.status == TaskStatus.SUCCEEDED and self.error:
            raise ValueError("a successful result cannot include an error")
        if self.status in {TaskStatus.FAILED, TaskStatus.REJECTED} and not self.error:
            raise ValueError("failed or rejected results require an error")
        return self


def digest_result_output(output: str | None) -> str | None:
    """Return a stable output digest without copying model output into traces."""
    if output is None:
        return None
    return sha256(output.encode("utf-8")).hexdigest()


class AxiomConfig(BaseModel):
    """Persisted local configuration generated by `axiom init`."""

    model_config = ConfigDict(extra="forbid")

    mode: DeploymentMode
    local_capabilities: LocalCapabilities = Field(default_factory=LocalCapabilities)
    routing_policy: RoutingPolicy = Field(default_factory=RoutingPolicy)
    remote_endpoint: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    version: str = "0.1.0"


class HealthReport(BaseModel):
    """Readiness summary emitted by the CLI and service adapters."""

    model_config = ConfigDict(extra="forbid")

    mode: DeploymentMode
    local_healthy: bool
    remote_healthy: bool
    remote_circuit_open: bool
    details: dict[str, str] = Field(default_factory=dict)


class ReplayManifest(BaseModel):
    """Portable manifest that makes task replay and verification explicit."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = "1"
    task: AxiomTask
    task_digest: str
    trace_id: str
    policy: RoutingPolicy
    capabilities: LocalCapabilities
    expected_result_digest: str | None = None
    exported_at: datetime = Field(default_factory=utc_now)

    @model_validator(mode="after")
    def task_digest_must_match(self) -> ReplayManifest:
        if self.task_digest != self.task.digest():
            raise ValueError("taskDigest does not match canonical task payload")
        if self.trace_id != self.task.trace_id:
            raise ValueError("traceId must match the embedded task trace ID")
        return self


JsonValue = str | int | float | bool | None | list["JsonValue"] | dict[str, "JsonValue"]
"""A recursive alias useful for trace and audit attributes."""
