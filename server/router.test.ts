import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ExecutionRouter } from './router.js';
import type { AxiomTask } from './types.js';

/**
 * Verify unavailable explicit remote placement is rejected despite local eligibility.
 */
test('explicit remote placement rejects unavailable remote despite local eligibility', () => {
  const router = new ExecutionRouter(
    { available_models: ['llama2-7b'] },
    undefined,
    false
  );
  const task: AxiomTask = {
    id: 'task_remote_only',
    trace_id: 'tr_remote_only',
    objective: 'Remote-only task',
    depth: 0,
    tokens_remaining: 8000,
    context_size_bytes: 0,
    required_compute: {
      model: 'llama2-7b',
      minVramMb: 0,
      gpuRequired: false,
      preferLocal: true,
    },
    serialized_state: 'e30=',
    execution_env: 'remote',
    allow_degraded_local: true,
    created_at: '2026-01-01T00:00:00.000Z',
  };

  assert.equal(router.checkLocalConstraint(task), null);

  const decision = router.decide(task);

  assert.equal(decision.location, null);
  assert.equal(decision.rejected, true);
  assert.equal(decision.degraded, false);
  assert.equal(decision.reason, 'remote_unavailable_rejected');
  assert.match(decision.detail, /explicit remote request/);
});
