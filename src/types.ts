export type DeploymentMode = 'local' | 'remote' | 'hybrid' | 'simulation';
export type ExecutionEnv = 'auto' | 'local' | 'remote';
export type ExecutionLocation = 'local' | 'remote';
export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'rejected';

export type RouteReason =
  | 'explicit_local'
  | 'explicit_remote'
  | 'local_eligible'
  | 'depth_limit'
  | 'context_limit'
  | 'serialized_state_limit'
  | 'model_not_cached'
  | 'gpu_unavailable'
  | 'vram_unavailable'
  | 'frame_budget'
  | 'remote_unavailable_degraded'
  | 'remote_unavailable_rejected';

export interface ComputeSpec {
  model: string;
  minVramMb: number;
  gpuRequired: boolean;
  preferLocal: boolean;
  estimatedLocalLatencyMs?: number;
}

export interface AxiomTask {
  id: string;
  trace_id: string;
  objective: string;
  depth: number;
  tokens_remaining: number;
  context_size_bytes: number;
  required_compute: ComputeSpec;
  serialized_state: string;
  parent_task_id?: string | null;
  execution_env: ExecutionEnv;
  allow_degraded_local: boolean;
  created_at: string;
}

export interface LocalCapabilities {
  available_models: string[];
  gpu_available: boolean;
  free_vram_mb: number;
  local_context_window: number;
  max_serialized_state_bytes: number;
  predicted_frame_ms: number;
  local_healthy: boolean;
}

export interface RoutingPolicy {
  local_max_depth: number;
  local_frame_budget_ms: number;
  remote_submit_budget_ms: number;
  remote_circuit_failure_threshold: number;
  remote_circuit_reset_seconds: number;
}

export interface RouteDecision {
  task_id: string;
  trace_id: string;
  location: ExecutionLocation | null;
  reason: RouteReason;
  degraded: boolean;
  rejected: boolean;
  detail: string;
  policy: RoutingPolicy;
  capabilities: LocalCapabilities;
  decided_at: string;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  queue_ms: number;
  egress_bytes: number;
}

export interface CostBreakdown {
  local_compute_usd: number;
  remote_compute_usd: number;
  token_usd: number;
  network_usd: number;
  total_usd: number;
  currency: 'USD';
}

export interface AxiomResult {
  task_id: string;
  trace_id: string;
  status: TaskStatus;
  execution_location?: ExecutionLocation | null;
  output?: string | null;
  error?: string | null;
  usage: Usage;
  cost: CostBreakdown;
  result_digest?: string | null;
  started_at: string;
  completed_at: string;
}

export interface TraceEvent {
  event_id: string;
  trace_id: string;
  task_id: string;
  name: string;
  timestamp: string;
  execution_location?: ExecutionLocation | null;
  parent_span_id?: string | null;
  span_id: string;
  attributes: Record<string, any>;
}

export interface HealthReport {
  mode: DeploymentMode;
  local_healthy: boolean;
  remote_healthy: boolean;
  remote_circuit_open: boolean;
  details: Record<string, string>;
}

export interface ReplayManifest {
  schema_version: string;
  task: AxiomTask;
  task_digest: string;
  trace_id: string;
  policy: RoutingPolicy;
  capabilities: LocalCapabilities;
  expected_result_digest?: string | null;
  exported_at: string;
}
