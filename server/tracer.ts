import crypto from 'crypto';
import { AxiomTask, ExecutionLocation, TraceEvent } from './types.js';

const SENSITIVE_ATTRIBUTES = new Set([
  'objective',
  'prompt',
  'serialized_state',
  'serializedState',
  'user_id',
  'context_preview',
]);

export function redactAttributes(attributes: Record<string, any>): Record<string, any> {
  const redacted: Record<string, any> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (SENSITIVE_ATTRIBUTES.has(key) && value !== undefined && value !== null) {
      redacted[`${key}_sha256`] = crypto
        .createHash('sha256')
        .update(String(value))
        .digest('hex');
      continue;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      redacted[key] = redactAttributes(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export function newSpanId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function newEventId(): string {
  return `evt_${crypto.randomBytes(16).toString('hex')}`;
}

export class InMemoryTracer {
  private events: TraceEvent[] = [];
  private byTrace = new Map<string, TraceEvent[]>();

  emit(
    task: AxiomTask,
    name: string,
    options: {
      execution_location?: ExecutionLocation | null;
      parent_span_id?: string | null;
      attributes?: Record<string, any>;
    } = {}
  ): TraceEvent {
    const rawAttrs: Record<string, any> = {
      task_digest: computeTaskDigest(task),
      depth: task.depth,
      model: task.required_compute.model,
      ...(options.attributes || {}),
    };

    const event: TraceEvent = {
      event_id: newEventId(),
      trace_id: task.trace_id,
      task_id: task.id,
      name,
      timestamp: new Date().toISOString(),
      execution_location: options.execution_location ?? null,
      parent_span_id: options.parent_span_id ?? null,
      span_id: newSpanId(),
      attributes: redactAttributes(rawAttrs),
    };

    this.events.push(event);
    const traceEvents = this.byTrace.get(task.trace_id) || [];
    traceEvents.push(event);
    this.byTrace.set(task.trace_id, traceEvents);

    return event;
  }

  getEventsForTrace(traceId: string): TraceEvent[] {
    return this.byTrace.get(traceId) || [];
  }

  getAllTraces(): string[] {
    return Array.from(this.byTrace.keys());
  }

  getAllEvents(): TraceEvent[] {
    return [...this.events];
  }
}

export function computeTaskDigest(task: AxiomTask): string {
  const canonical = JSON.stringify({
    allow_degraded_local: task.allow_degraded_local,
    context_size_bytes: task.context_size_bytes,
    depth: task.depth,
    execution_env: task.execution_env,
    id: task.id,
    objective: task.objective,
    parent_task_id: task.parent_task_id || null,
    required_compute: task.required_compute,
    serialized_state: task.serialized_state,
    tokens_remaining: task.tokens_remaining,
    trace_id: task.trace_id,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
