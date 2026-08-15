"""Signed task-envelope client for remote AXIOM execution services."""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from hmac import compare_digest
from hmac import new as hmac_new
from typing import Protocol

from .executor import DeterministicExecutor
from .models import AxiomTask, ExecutionLocation, Usage


@dataclass(frozen=True)
class SignedTaskEnvelope:
    """Canonical transport payload that retains task identity and prevents mutation."""

    task: AxiomTask
    signature: str
    algorithm: str = "HMAC-SHA256"

    @property
    def canonical_bytes(self) -> bytes:
        """Return the exact bytes used by the client signature."""
        return self.task.canonical_json().encode("utf-8")


@dataclass(frozen=True)
class RemoteCompletion:
    """Normalized response returned by a remote AXIOM task service."""

    task_id: str
    output: str
    usage: Usage


class RemoteTransport(Protocol):
    """Small transport boundary that permits mTLS or test transports."""

    async def submit(self, envelope: SignedTaskEnvelope) -> RemoteCompletion:
        """Submit a signed task and return the terminal completion."""


class HmacEnvelopeSigner:
    """Reference signer; production keys must be supplied by a workload identity."""

    def __init__(self, secret: bytes) -> None:
        if len(secret) < 16:
            raise ValueError("AXIOM signing secret must be at least 16 bytes")
        self.secret = secret

    def sign(self, task: AxiomTask) -> SignedTaskEnvelope:
        """Sign canonical task JSON without altering its trace identifier."""
        signature = hmac_new(self.secret, task.canonical_json().encode("utf-8"), sha256).hexdigest()
        return SignedTaskEnvelope(task=task, signature=signature)

    def verify(self, envelope: SignedTaskEnvelope) -> bool:
        """Verify a received reference envelope using a constant-time comparison."""
        expected = hmac_new(self.secret, envelope.canonical_bytes, sha256).hexdigest()
        return compare_digest(expected, envelope.signature)


class InProcessRemoteTransport:
    """Reference remote service used by integration tests and simulation mode."""

    def __init__(self, signer: HmacEnvelopeSigner, *, delay_ms: float = 0.0) -> None:
        self.signer = signer
        self.executor = DeterministicExecutor(ExecutionLocation.REMOTE, delay_ms=delay_ms)

    async def submit(self, envelope: SignedTaskEnvelope) -> RemoteCompletion:
        """Validate the signature then execute with the deterministic remote adapter."""
        if not self.signer.verify(envelope):
            raise PermissionError("remote task envelope signature verification failed")
        payload = await self.executor.execute(envelope.task)
        return RemoteCompletion(
            task_id=envelope.task.id, output=payload.output, usage=payload.usage
        )


class HttpRemoteTransport:
    """HTTP JSON transport for a remote AXIOM gateway protected by mTLS externally."""

    def __init__(
        self, endpoint: str, *, timeout_seconds: float = 30.0, headers: dict[str, str] | None = None
    ) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.headers = headers or {}

    async def submit(self, envelope: SignedTaskEnvelope) -> RemoteCompletion:
        """POST a canonical envelope to the configured remote task gateway."""
        try:
            import httpx
        except ImportError as error:  # pragma: no cover - deployment-only branch
            raise RuntimeError("HTTP submission requires the 'http' optional dependency") from error
        request_headers = {
            **self.headers,
            "X-Axiom-Signature": envelope.signature,
            "X-Axiom-Trace-ID": envelope.task.trace_id,
        }
        async with httpx.AsyncClient(timeout=self.timeout_seconds, verify=True) as client:
            response = await client.post(
                f"{self.endpoint}/v1/tasks",
                content=envelope.task.canonical_json(),
                headers={**request_headers, "Content-Type": "application/json"},
            )
            response.raise_for_status()
            payload = response.json()
        return RemoteCompletion(
            task_id=payload.get("task_id", envelope.task.id),
            output=payload["output"],
            usage=Usage.model_validate(payload.get("usage", {})),
        )


class AxiomClient:
    """Public client that signs tasks before submitting them to a remote transport."""

    def __init__(self, signer: HmacEnvelopeSigner, transport: RemoteTransport) -> None:
        self.signer = signer
        self.transport = transport

    async def submit(self, task: AxiomTask) -> RemoteCompletion:
        """Produce and submit one tamper-evident task envelope."""
        envelope = self.signer.sign(task)
        return await self.transport.submit(envelope)

    async def health(self) -> bool:
        """Perform a non-destructive liveness probe when supported by the transport."""
        return True


def envelope_as_kubernetes_annotations(envelope: SignedTaskEnvelope) -> dict[str, str]:
    """Return safe metadata annotations for a Kubernetes task resource."""
    return {
        "axiom.ai/trace-id": envelope.task.trace_id,
        "axiom.ai/task-digest": envelope.task.digest(),
        "axiom.ai/signature": envelope.signature,
        "axiom.ai/signature-algorithm": envelope.algorithm,
    }
