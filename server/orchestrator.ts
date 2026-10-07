import crypto from 'crypto';
import { AxiomKernel, ConstitutionalContext, InvariantViolation } from './constitutional.js';
import { CostCalculator, CostLedger } from './cost.js';
import { ExecutionRouter } from './router.js';
import { computeTaskDigest, InMemoryTracer } from './tracer.js';
import {
  AxiomResult,
  AxiomTask,
  ExecutionLocation,
  ReplayManifest,
  TaskStatus,
  Usage,
} from './types.js';

export class AxiomOrchestrator {
  router: ExecutionRouter;
  cost_calculator: CostCalculator;
  cost_ledger: CostLedger;
  tracer: InMemoryTracer;
  kernel: AxiomKernel;

  private tasks = new Map<string, AxiomTask>();
  private results = new Map<string, AxiomResult>();
  private replays = new Map<string, ReplayManifest>();

  constructor(
    router?: ExecutionRouter,
    costCalculator?: CostCalculator,
    tracer?: InMemoryTracer,
    kernel?: AxiomKernel
  ) {
    this.router = router || new ExecutionRouter();
    this.cost_calculator = costCalculator || new CostCalculator();
    this.cost_ledger = new CostLedger();
    this.tracer = tracer || new InMemoryTracer();
    this.kernel = kernel || new AxiomKernel();
  }

  async submit(task: AxiomTask): Promise<AxiomResult> {
    const startedAt = new Date().toISOString();
    const taskDigest = computeTaskDigest(task);

    // Save initial task state
    this.tasks.set(task.id, task);

    // 1. Constitutional admission check
    try {
      const constitutionalCtx: ConstitutionalContext = {
        trace_id: task.trace_id,
        task_id: task.id,
        actor_id: 'axiom.orchestrator',
        authority: 'execute',
        parent_state_hash: taskDigest,
        policy_version: this.kernel.version,
        mutation_id: `submit:${task.id}`,
        evidence: { task_digest: taskDigest },
        reversible: true,
      };

      this.kernel.validate(constitutionalCtx);
      this.kernel.assertBudget(
        task.depth,
        this.router.policy.local_max_depth,
        task.tokens_remaining,
        128000
      );
    } catch (err: any) {
      const isViolation = err instanceof InvariantViolation;
      const errorMsg = isViolation
        ? `constitutional rejection: ${err.message}`
        : `admission rejection: ${err.message}`;

      const rejectedResult: AxiomResult = {
        task_id: task.id,
        trace_id: task.trace_id,
        status: 'rejected',
        error: errorMsg,
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          latency_ms: 0.5,
          queue_ms: 0,
          egress_bytes: 0,
        },
        cost: {
          local_compute_usd: 0,
          remote_compute_usd: 0,
          token_usd: 0,
          network_usd: 0,
          total_usd: 0,
          currency: 'USD',
        },
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      };

      this.tracer.emit(task, 'task.rejected.constitution', {
        attributes: { error: errorMsg, invariant_violation: isViolation },
      });
      this.results.set(task.id, rejectedResult);
      this.cost_ledger.record(rejectedResult);
      return rejectedResult;
    }

    // 2. Submit trace event
    const rootEvent = this.tracer.emit(task, 'task.submit', {
      attributes: { objective: task.objective },
    });

    // 3. Routing decision
    const decision = this.router.decide(task);
    this.tracer.emit(task, 'route.decision', {
      parent_span_id: rootEvent.span_id,
      execution_location: decision.location,
      attributes: {
        reason: decision.reason,
        degraded: decision.degraded,
        rejected: decision.rejected,
        detail: decision.detail,
        constitutional_kernel: this.kernel.version,
      },
    });

    if (decision.rejected || !decision.location) {
      const rejectedResult: AxiomResult = {
        task_id: task.id,
        trace_id: task.trace_id,
        status: 'rejected',
        error: decision.detail,
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          latency_ms: 1.0,
          queue_ms: 0,
          egress_bytes: 0,
        },
        cost: {
          local_compute_usd: 0,
          remote_compute_usd: 0,
          token_usd: 0,
          network_usd: 0,
          total_usd: 0,
          currency: 'USD',
        },
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      };

      this.results.set(task.id, rejectedResult);
      this.cost_ledger.record(rejectedResult);
      return rejectedResult;
    }

    // 4. Execution
    const execLocation: ExecutionLocation = decision.location;
    this.tracer.emit(task, `${execLocation}.exec.start`, {
      parent_span_id: rootEvent.span_id,
      execution_location: execLocation,
      attributes: { model: task.required_compute.model },
    });

    // Simulate execution latency
    const simLatencyMs =
      execLocation === 'local'
        ? Math.max(2.5, (task.required_compute.estimatedLocalLatencyMs || 6.0) + Math.random() * 3)
        : 45.0 + Math.random() * 25;

    await new Promise((r) => setTimeout(r, Math.min(simLatencyMs, 40)));

    const wordCount = task.objective.trim().split(/\s+/).length;
    const promptTokens = Math.max(4, wordCount * 3);
    const completionTokens = 32 + Math.floor(Math.random() * 20);
    const output = `${execLocation.toUpperCase()}: completed task ${task.id} with model ${
      task.required_compute.model
    } for objective "${task.objective}" [digest: ${taskDigest.slice(0, 12)}]`;

    const usage: Usage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      latency_ms: Math.round(simLatencyMs * 10) / 10,
      queue_ms: execLocation === 'remote' ? 4.2 : 0.0,
      egress_bytes: Buffer.byteLength(output, 'utf-8'),
    };

    const cost = this.cost_calculator.calculate(usage, execLocation);
    const resultDigest = crypto.createHash('sha256').update(output).digest('hex');

    const result: AxiomResult = {
      task_id: task.id,
      trace_id: task.trace_id,
      status: 'succeeded',
      execution_location: execLocation,
      output,
      usage,
      cost,
      result_digest: resultDigest,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    };

    if (execLocation === 'remote') {
      this.router.recordRemoteSuccess();
    }

    // 5. Complete event
    this.tracer.emit(task, 'task.complete', {
      parent_span_id: rootEvent.span_id,
      execution_location: execLocation,
      attributes: {
        status: result.status,
        latency_ms: result.usage.latency_ms,
        tokens_used: result.usage.prompt_tokens + result.usage.completion_tokens,
        cost_usd: result.cost.total_usd,
        result_digest: resultDigest,
        constitutional_kernel: this.kernel.version,
      },
    });

    this.results.set(task.id, result);
    this.cost_ledger.record(result);
    return result;
  }

  getTask(taskId: string): AxiomTask | undefined {
    return this.tasks.get(taskId);
  }

  getResult(taskId: string): AxiomResult | undefined {
    return this.results.get(taskId);
  }

  getAllTasks(): { task: AxiomTask; result?: AxiomResult }[] {
    const list: { task: AxiomTask; result?: AxiomResult }[] = [];
    for (const task of this.tasks.values()) {
      list.push({
        task,
        result: this.results.get(task.id),
      });
    }
    return list.reverse();
  }

  exportReplay(taskId: string): ReplayManifest {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const result = this.results.get(taskId);
    const manifest: ReplayManifest = {
      schema_version: '1',
      task,
      task_digest: computeTaskDigest(task),
      trace_id: task.trace_id,
      policy: { ...this.router.policy },
      capabilities: { ...this.router.capabilities },
      expected_result_digest: result?.result_digest || null,
      exported_at: new Date().toISOString(),
    };
    this.replays.set(taskId, manifest);
    return manifest;
  }

  verifyReplay(taskId: string): {
    task_id: string;
    trace_id: string;
    task_digest_matches: boolean;
    result_digest_matches: boolean;
    verified: boolean;
  } {
    const manifest = this.replays.get(taskId) || this.exportReplay(taskId);
    const result = this.results.get(taskId);
    const currentTaskDigest = computeTaskDigest(manifest.task);
    const taskDigestMatches = manifest.task_digest === currentTaskDigest;
    const resultDigestMatches =
      !manifest.expected_result_digest ||
      manifest.expected_result_digest === result?.result_digest;

    return {
      task_id: taskId,
      trace_id: manifest.trace_id,
      task_digest_matches: taskDigestMatches,
      result_digest_matches: resultDigestMatches,
      verified: taskDigestMatches && resultDigestMatches,
    };
  }

  async runSimulatedLoad(
    count = 25,
    remoteEvery = 5
  ): Promise<{
    workload_count: number;
    succeeded: number;
    local_count: number;
    remote_count: number;
    wall_clock_ms: number;
    latency_ms: { p50: number; p95: number; max: number };
  }> {
    const start = Date.now();
    const tasks: AxiomTask[] = [];

    for (let i = 0; i < count; i++) {
      const isRemote = remoteEvery > 0 && i % remoteEvery === 0;
      tasks.push({
        id: `task_sim_${Date.now()}_${i}`,
        trace_id: `tr_sim_${Date.now()}`,
        objective: `Synthetic benchmark task #${i + 1}`,
        depth: isRemote ? 4 : 1, // depth 4 triggers remote because local_max_depth is 3
        tokens_remaining: 8000,
        context_size_bytes: 512,
        required_compute: {
          model: 'llama2-7b',
          minVramMb: 0,
          gpuRequired: false,
          preferLocal: true,
        },
        serialized_state: 'e30=',
        execution_env: 'auto',
        allow_degraded_local: true,
        created_at: new Date().toISOString(),
      });
    }

    const results = await Promise.all(tasks.map((t) => this.submit(t)));
    const elapsedMs = Date.now() - start;

    const latencies = results.map((r) => r.usage.latency_ms).sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
    const max = latencies[latencies.length - 1] || 0;

    return {
      workload_count: count,
      succeeded: results.filter((r) => r.status === 'succeeded').length,
      local_count: results.filter((r) => r.execution_location === 'local').length,
      remote_count: results.filter((r) => r.execution_location === 'remote').length,
      wall_clock_ms: elapsedMs,
      latency_ms: {
        p50: Math.round(p50 * 100) / 100,
        p95: Math.round(p95 * 100) / 100,
        max: Math.round(max * 100) / 100,
      },
    };
  }
}
