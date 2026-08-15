"""Execution adapters for local, remote, HTTP, and deterministic simulation tiers."""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass
from hashlib import sha256
from time import perf_counter
from typing import Any

from .models import AxiomTask, ExecutionLocation, Usage


@dataclass(frozen=True)
class ExecutionPayload:
    """Unpriced terminal output returned by any executor adapter."""

    output: str
    usage: Usage
    metadata: dict[str, Any]


class TaskExecutor(ABC):
    """Protocol for an asynchronous task executor in one placement tier."""

    location: ExecutionLocation

    @abstractmethod
    async def execute(self, task: AxiomTask) -> ExecutionPayload:
        """Execute one validated task and return output plus measured usage."""


class DeterministicExecutor(TaskExecutor):
    """Side-effect-free executor for CI, demos, replay tests, and local simulation."""

    def __init__(self, location: ExecutionLocation, *, delay_ms: float = 0.0) -> None:
        self.location = location
        self.delay_ms = delay_ms

    async def execute(self, task: AxiomTask) -> ExecutionPayload:
        start = perf_counter()
        if self.delay_ms:
            await asyncio.sleep(self.delay_ms / 1_000)
        task_hash = sha256(task.canonical_json().encode("utf-8")).hexdigest()
        output = f"{self.location.value}: simulated execution for {task.id} [{task_hash[:16]}]"
        elapsed = (perf_counter() - start) * 1_000
        prompt_tokens = max(1, len(task.objective.split()))
        completion_tokens = 12
        return ExecutionPayload(
            output=output,
            usage=Usage(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                latency_ms=elapsed,
                queue_ms=0.0,
                egress_bytes=len(output.encode("utf-8")),
            ),
            metadata={"backend": "deterministic", "task_digest": task_hash},
        )


class HttpModelExecutor(TaskExecutor):
    """OpenAI-compatible HTTP adapter for Ollama, vLLM, or compatible services."""

    def __init__(
        self,
        location: ExecutionLocation,
        endpoint: str,
        *,
        timeout_seconds: float = 30.0,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.location = location
        self.endpoint = endpoint.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.headers = headers or {}

    async def execute(self, task: AxiomTask) -> ExecutionPayload:
        """Call an OpenAI-compatible chat-completions endpoint lazily via httpx."""
        try:
            import httpx
        except ImportError as error:  # pragma: no cover - controlled deployment error
            raise RuntimeError("HTTP execution requires the 'http' optional dependency") from error

        start = perf_counter()
        request_body = {
            "model": task.required_compute.model,
            "messages": [{"role": "user", "content": task.objective}],
            "max_tokens": min(2048, task.tokens_remaining),
            "temperature": 0,
        }
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.post(
                f"{self.endpoint}/v1/chat/completions",
                json=request_body,
                headers=self.headers,
            )
            response.raise_for_status()
            payload = response.json()
        elapsed = (perf_counter() - start) * 1_000
        usage = payload.get("usage", {})
        output = payload["choices"][0]["message"]["content"]
        return ExecutionPayload(
            output=output,
            usage=Usage(
                prompt_tokens=int(usage.get("prompt_tokens", 0)),
                completion_tokens=int(usage.get("completion_tokens", 0)),
                latency_ms=elapsed,
                egress_bytes=len(output.encode("utf-8")),
            ),
            metadata={"backend": "http", "endpoint": self.endpoint},
        )


class RemoteSubmissionExecutor(TaskExecutor):
    """Remote adapter that delegates signed-envelope transport to a submitter object."""

    location = ExecutionLocation.REMOTE

    def __init__(self, submitter: Any) -> None:
        self.submitter = submitter

    async def execute(self, task: AxiomTask) -> ExecutionPayload:
        """Submit one task envelope and normalize the remote completion payload."""
        response = await self.submitter.submit(task)
        return ExecutionPayload(
            output=response.output,
            usage=response.usage,
            metadata={"backend": "remote_submission", "remote_task_id": response.task_id},
        )
