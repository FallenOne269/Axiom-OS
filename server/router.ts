import {
  AxiomTask,
  ExecutionLocation,
  LocalCapabilities,
  RouteDecision,
  RouteReason,
  RoutingPolicy,
} from './types.js';

export class CircuitBreaker {
  failure_threshold: number;
  reset_seconds: number;
  failures = 0;
  opened_at: number | null = null;

  constructor(failureThreshold = 3, resetSeconds = 30) {
    this.failure_threshold = failureThreshold;
    this.reset_seconds = resetSeconds;
  }

  isOpen(now?: number): boolean {
    if (this.opened_at === null) {
      return false;
    }
    const current = now !== undefined ? now : Date.now() / 1000;
    if (current - this.opened_at >= this.reset_seconds) {
      this.failures = 0;
      this.opened_at = null;
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.opened_at = null;
  }

  recordFailure(now?: number): void {
    this.failures += 1;
    if (this.failures >= this.failure_threshold) {
      this.opened_at = now !== undefined ? now : Date.now() / 1000;
    }
  }

  reset(): void {
    this.failures = 0;
    this.opened_at = null;
  }
}

export const defaultCapabilities: LocalCapabilities = {
  available_models: ['llama2-7b', 'mistral-7b'],
  gpu_available: false,
  free_vram_mb: 0,
  local_context_window: 32000,
  max_serialized_state_bytes: 4000000,
  predicted_frame_ms: 5.0,
  local_healthy: true,
};

export const defaultRoutingPolicy: RoutingPolicy = {
  local_max_depth: 3,
  local_frame_budget_ms: 50.0,
  remote_submit_budget_ms: 200.0,
  remote_circuit_failure_threshold: 3,
  remote_circuit_reset_seconds: 30.0,
};

export class ExecutionRouter {
  capabilities: LocalCapabilities;
  policy: RoutingPolicy;
  remote_healthy: boolean;
  circuit_breaker: CircuitBreaker;

  constructor(
    capabilities?: Partial<LocalCapabilities>,
    policy?: Partial<RoutingPolicy>,
    remoteHealthy = true
  ) {
    this.capabilities = { ...defaultCapabilities, ...(capabilities || {}) };
    this.policy = { ...defaultRoutingPolicy, ...(policy || {}) };
    this.remote_healthy = remoteHealthy;
    this.circuit_breaker = new CircuitBreaker(
      this.policy.remote_circuit_failure_threshold,
      this.policy.remote_circuit_reset_seconds
    );
  }

  get remote_available(): boolean {
    return this.remote_healthy && !this.circuit_breaker.isOpen();
  }

  setRemoteHealth(healthy: boolean): void {
    this.remote_healthy = healthy;
    if (healthy) {
      this.circuit_breaker.recordSuccess();
    }
  }

  setLocalHealth(healthy: boolean): void {
    this.capabilities.local_healthy = healthy;
  }

  recordRemoteFailure(): void {
    this.circuit_breaker.recordFailure();
  }

  recordRemoteSuccess(): void {
    this.circuit_breaker.recordSuccess();
  }

  /**
   * Determine where a task should execute, honoring explicit placement
   * requests before falling back to policy-driven local/remote routing.
   */
  decide(task: AxiomTask): RouteDecision {
    if (task.execution_env === 'local') {
      return this.localOrDegraded(task, 'explicit_local', true);
    }
    if (task.execution_env === 'remote') {
      return this.remoteOrDegraded(task, 'explicit_remote', true);
    }

    const localFailure = this.checkLocalConstraint(task);
    if (localFailure === null) {
      return this.makeDecision(
        task,
        'local',
        'local_eligible',
        'local capability checks passed'
      );
    }
    return this.remoteOrDegraded(task, localFailure);
  }

  /**
   * Evaluate whether local capabilities and policy allow executing the task,
   * returning the first violated constraint reason or `null` if the task is
   * eligible for local execution.
   */
  checkLocalConstraint(task: AxiomTask): RouteReason | null {
    const caps = this.capabilities;
    if (!caps.local_healthy) {
      return 'frame_budget';
    }
    if (task.depth > this.policy.local_max_depth) {
      return 'depth_limit';
    }
    if (task.tokens_remaining > caps.local_context_window) {
      return 'context_limit';
    }
    if (task.context_size_bytes > caps.max_serialized_state_bytes) {
      return 'serialized_state_limit';
    }
    if (!caps.available_models.includes(task.required_compute.model)) {
      return 'model_not_cached';
    }
    if (task.required_compute.gpuRequired && !caps.gpu_available) {
      return 'gpu_unavailable';
    }
    if (task.required_compute.minVramMb > caps.free_vram_mb) {
      return 'vram_unavailable';
    }
    const estimate =
      task.required_compute.estimatedLocalLatencyMs || caps.predicted_frame_ms;
    if (estimate > this.policy.local_frame_budget_ms) {
      return 'frame_budget';
    }
    return null;
  }

  private localOrDegraded(
    task: AxiomTask,
    reason: RouteReason,
    explicit = false
  ): RouteDecision {
    const constraint = this.checkLocalConstraint(task);
    if (constraint === null) {
      return this.makeDecision(task, 'local', reason, 'local execution requested');
    }
    if (explicit) {
      return this.makeDecision(
        task,
        null,
        constraint,
        `explicit local request cannot be honored: ${constraint}`,
        false,
        true
      );
    }
    return this.remoteOrDegraded(task, constraint);
  }

  /**
   * Route remotely when available, rejecting unavailable explicit requests.
   *
   * Implicit requests may fall back to eligible local execution only when
   * the task permits degraded local execution; otherwise, reject them.
   */
  private remoteOrDegraded(
    task: AxiomTask,
    reason: RouteReason,
    explicit = false
  ): RouteDecision {
    if (this.remote_available) {
      return this.makeDecision(
        task,
        'remote',
        reason,
        explicit
          ? 'remote execution requested'
          : 'remote execution selected after local policy evaluation'
      );
    }

    // Explicit placement is authoritative, even when local degradation is allowed.
    if (explicit) {
      return this.makeDecision(
        task,
        null,
        'remote_unavailable_rejected',
        'explicit remote request cannot be honored: remote tier unavailable',
        false,
        true
      );
    }

    const localConstraint = this.checkLocalConstraint(task);
    if (task.allow_degraded_local && localConstraint === null) {
      return this.makeDecision(
        task,
        'local',
        'remote_unavailable_degraded',
        'remote tier unavailable; executing locally in degraded mode',
        true,
        false
      );
    }

    return this.makeDecision(
      task,
      null,
      'remote_unavailable_rejected',
      `remote tier unavailable and local execution is ineligible (${localConstraint || reason})`,
      false,
      true
    );
  }

  private makeDecision(
    task: AxiomTask,
    location: ExecutionLocation | null,
    reason: RouteReason,
    detail: string,
    degraded = false,
    rejected = false
  ): RouteDecision {
    return {
      task_id: task.id,
      trace_id: task.trace_id,
      location,
      reason,
      degraded,
      rejected,
      detail,
      policy: { ...this.policy },
      capabilities: {
        ...this.capabilities,
        available_models: [...this.capabilities.available_models],
      },
      decided_at: new Date().toISOString(),
    };
  }
}
