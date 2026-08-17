"""Unified AXIOM control plane: route, execute, trace, cost, persist, and replay."""

from __future__ import annotations

from json import dumps, loads
from pathlib import Path
from time import perf_counter

from .constitutional import Authority, AxiomKernel, ConstitutionalContext, InvariantViolation
from .cost import CostCalculator, CostLedger
from .executor import TaskExecutor
from .models import (
    AxiomResult,
    AxiomTask,
    ExecutionLocation,
    ReplayManifest,
    TaskStatus,
    digest_result_output,
)
from .router import ExecutionRouter
from .tracer import InMemoryTracer, emit_task_event


class LocalTaskStore:
    """File-backed task and result store for local development and CI operation."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.tasks = self.root / "tasks"
        self.results = self.root / "results"
        self.replays = self.root / "replays"
        for directory in (self.tasks, self.results, self.replays):
            directory.mkdir(parents=True, exist_ok=True)

    def _write(self, path: Path, payload: dict) -> Path:
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)
        return path

    def save_task(self, task: AxiomTask) -> Path:
        """Persist canonical task input before execution begins."""
        return self._write(
            self.tasks / f"{task.id}.json", task.model_dump(mode="json", by_alias=True)
        )

    def load_task(self, task_id: str) -> AxiomTask:
        """Load an earlier task or fail with a useful missing-record error."""
        path = self.tasks / f"{task_id}.json"
        if not path.exists():
            raise FileNotFoundError(f"task not found: {task_id}")
        return AxiomTask.model_validate(loads(path.read_text(encoding="utf-8")))

    def save_result(self, result: AxiomResult) -> Path:
        """Persist a terminal result atomically."""
        return self._write(self.results / f"{result.task_id}.json", result.model_dump(mode="json"))

    def load_result(self, task_id: str) -> AxiomResult:
        """Load a stored result, if one exists."""
        path = self.results / f"{task_id}.json"
        if not path.exists():
            raise FileNotFoundError(f"result not found: {task_id}")
        return AxiomResult.model_validate(loads(path.read_text(encoding="utf-8")))

    def save_replay(self, manifest: ReplayManifest) -> Path:
        """Persist a portable replay manifest under its task identifier."""
        return self._write(
            self.replays / f"{manifest.task.id}.json",
            manifest.model_dump(mode="json", by_alias=True),
        )

    def load_replay(self, task_id: str) -> ReplayManifest:
        """Load a portable replay manifest."""
        path = self.replays / f"{task_id}.json"
        if not path.exists():
            raise FileNotFoundError(f"replay manifest not found: {task_id}")
        return ReplayManifest.model_validate(loads(path.read_text(encoding="utf-8")))


class AxiomOrchestrator:
    """Coordinate execution while enforcing the AXIOM constitutional boundary."""

    def __init__(
        self,
        router: ExecutionRouter,
        local_executor: TaskExecutor,
        remote_executor: TaskExecutor,
        tracer: InMemoryTracer,
        cost_calculator: CostCalculator,
        task_store: LocalTaskStore | None = None,
        cost_ledger: CostLedger | None = None,
        kernel: AxiomKernel | None = None,
    ) -> None:
        if local_executor.location != ExecutionLocation.LOCAL:
            raise ValueError("local executor must declare local execution location")
        if remote_executor.location != ExecutionLocation.REMOTE:
            raise ValueError("remote executor must declare remote execution location")
        self.router = router
        self.local_executor = local_executor
        self.remote_executor = remote_executor
        self.tracer = tracer
        self.cost_calculator = cost_calculator
        self.task_store = task_store
        self.cost_ledger = cost_ledger or CostLedger()
        self.kernel = kernel or AxiomKernel()

    def _constitutional_context(self, task: AxiomTask) -> ConstitutionalContext:
        """Build the immutable lineage context for a task admission decision."""
        return ConstitutionalContext(
            trace_id=task.trace_id,
            task_id=task.id,
            actor_id="axiom.orchestrator",
            authority=Authority.EXECUTE,
            parent_state_hash=task.digest(),
            policy_version=self.kernel.version,
            mutation_id=f"submit:{task.id}",
            evidence={"task_digest": task.digest()},
        )

    async def submit(self, task: AxiomTask) -> AxiomResult:
        """Persist a task and execute it only after constitutional admission."""
        try:
            constitutional = self._constitutional_context(task)
            self.kernel.validate(constitutional)
            self.kernel.assert_budget(
                depth=task.depth,
                max_depth=self.router.policy.local_max_depth,
                tokens=task.tokens_remaining,
                max_tokens=128_000,
            )
        except InvariantViolation as error:
            result = AxiomResult(
                task_id=task.id,
                trace_id=task.trace_id,
                status=TaskStatus.REJECTED,
                error=f"constitutional rejection: {error}",
            )
            if self.task_store:
                self.task_store.save_task(task)
            root_event = emit_task_event(
                self.tracer, task, "task.rejected.constitution", error=str(error)
            )
            self._finish(task, result, parent_span_id=root_event.span_id)
            return result

        if self.task_store:
            self.task_store.save_task(task)
        root_event = emit_task_event(self.tracer, task, "task.submit", objective=task.objective)
        decision = self.router.decide(task)
        emit_task_event(
            self.tracer,
            task,
            "route.decision",
            parent_span_id=root_event.span_id,
            execution_location=decision.location,
            reason=decision.reason.value,
            degraded=decision.degraded,
            rejected=decision.rejected,
            detail=decision.detail,
            constitutional_kernel=self.kernel.version,
        )
        if decision.rejected or decision.location is None:
            result = AxiomResult(
                task_id=task.id,
                trace_id=task.trace_id,
                status=TaskStatus.REJECTED,
                error=decision.detail,
            )
            self._finish(task, result, parent_span_id=root_event.span_id)
            return result

        executor = (
            self.local_executor
            if decision.location == ExecutionLocation.LOCAL
            else self.remote_executor
        )
        started = perf_counter()
        emit_task_event(
            self.tracer,
            task,
            f"{decision.location.value}.exec.start",
            parent_span_id=root_event.span_id,
            execution_location=decision.location,
            model=task.required_compute.model,
        )
        try:
            payload = await executor.execute(task)
            usage = payload.usage.model_copy(
                update={"latency_ms": (perf_counter() - started) * 1_000}
            )
            cost = self.cost_calculator.calculate(usage, decision.location)
            result = AxiomResult(
                task_id=task.id,
                trace_id=task.trace_id,
                status=TaskStatus.SUCCEEDED,
                execution_location=decision.location,
                output=payload.output,
                usage=usage,
                cost=cost,
                result_digest=digest_result_output(payload.output),
            )
            if decision.location == ExecutionLocation.REMOTE:
                self.router.record_remote_success()
        except Exception as error:  # noqa: BLE001 - boundary must normalize adapter errors
            if decision.location == ExecutionLocation.REMOTE:
                self.router.record_remote_failure()
            result = AxiomResult(
                task_id=task.id,
                trace_id=task.trace_id,
                status=TaskStatus.FAILED,
                execution_location=decision.location,
                error=str(error),
            )
        self._finish(task, result, parent_span_id=root_event.span_id)
        return result

    def _finish(self, task: AxiomTask, result: AxiomResult, *, parent_span_id: str) -> None:
        """Record terminal state once for traces, aggregate costs, and persistence."""
        emit_task_event(
            self.tracer,
            task,
            "task.complete",
            parent_span_id=parent_span_id,
            execution_location=result.execution_location,
            status=result.status.value,
            latency_ms=result.usage.latency_ms,
            tokens_used=result.usage.total_tokens,
            cost_usd=result.cost.total_usd,
            result_digest=result.result_digest,
            error=result.error,
            constitutional_kernel=self.kernel.version,
        )
        self.cost_ledger.record(result)
        if self.task_store:
            self.task_store.save_result(result)

    def export_replay(self, task_id: str) -> ReplayManifest:
        """Export enough deterministic metadata to replay or verify a task."""
        if not self.task_store:
            raise RuntimeError("replay export requires a task store")
        task = self.task_store.load_task(task_id)
        try:
            result = self.task_store.load_result(task_id)
            expected_digest = result.result_digest
        except FileNotFoundError:
            expected_digest = None
        manifest = ReplayManifest(
            task=task,
            task_digest=task.digest(),
            trace_id=task.trace_id,
            policy=self.router.policy,
            capabilities=self.router.capabilities,
            expected_result_digest=expected_digest,
        )
        self.task_store.save_replay(manifest)
        return manifest

    async def replay(self, manifest: ReplayManifest, *, force_remote: bool = False) -> AxiomResult:
        """Execute a replay task without changing its trace identifier."""
        task = manifest.task
        if force_remote:
            task = task.model_copy(update={"execution_env": "remote"})
        return await self.submit(task)

    def verify_replay(self, task_id: str) -> dict[str, object]:
        """Compare a saved result with its exported reproducibility contract."""
        if not self.task_store:
            raise RuntimeError("replay verification requires a task store")
        manifest = self.task_store.load_replay(task_id)
        result = self.task_store.load_result(task_id)
        task_digest_matches = manifest.task_digest == manifest.task.digest()
        result_digest_matches = (
            manifest.expected_result_digest is None
            or manifest.expected_result_digest == result.result_digest
        )
        return {
            "task_id": task_id,
            "trace_id": manifest.trace_id,
            "task_digest_matches": task_digest_matches,
            "result_digest_matches": result_digest_matches,
            "verified": task_digest_matches and result_digest_matches,
        }
