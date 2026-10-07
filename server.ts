import express from 'express';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { AxiomOrchestrator } from './server/orchestrator.js';
import { AxiomTask } from './server/types.js';

const orchestrator = new AxiomOrchestrator();

// Seed initial task for immediate visualization
const initialSeedTask: AxiomTask = {
  id: `task_boot_${crypto.randomBytes(4).toString('hex')}`,
  trace_id: `tr_${crypto.randomBytes(8).toString('hex')}`,
  objective: 'Verify AXIOM control plane boot and local placement policy',
  depth: 1,
  tokens_remaining: 8000,
  context_size_bytes: 256,
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
};

orchestrator.submit(initialSeedTask).catch(console.error);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // API Routes
  app.get('/api/health', (req, res) => {
    const report = {
      mode: 'hybrid',
      local_healthy: orchestrator.router.capabilities.local_healthy,
      remote_healthy: orchestrator.router.remote_healthy,
      remote_circuit_open: orchestrator.router.circuit_breaker.isOpen(),
      details: {
        models_cached: orchestrator.router.capabilities.available_models.join(', ') || 'none',
        gpu_available: String(orchestrator.router.capabilities.gpu_available),
        free_vram_mb: `${orchestrator.router.capabilities.free_vram_mb} MB`,
        local_context_window: `${orchestrator.router.capabilities.local_context_window} tokens`,
        local_max_depth: String(orchestrator.router.policy.local_max_depth),
        frame_budget_ms: `${orchestrator.router.policy.local_frame_budget_ms} ms`,
        total_tasks: String(orchestrator.getAllTasks().length),
        total_traces: String(orchestrator.tracer.getAllTraces().length),
      },
    };
    res.json(report);
  });

  app.post('/api/health/toggle-remote', (req, res) => {
    const nextState = !orchestrator.router.remote_healthy;
    orchestrator.router.setRemoteHealth(nextState);
    res.json({ remote_healthy: orchestrator.router.remote_healthy });
  });

  app.post('/api/health/toggle-local', (req, res) => {
    const nextState = !orchestrator.router.capabilities.local_healthy;
    orchestrator.router.setLocalHealth(nextState);
    res.json({ local_healthy: orchestrator.router.capabilities.local_healthy });
  });

  app.post('/api/health/reset-circuit', (req, res) => {
    orchestrator.router.circuit_breaker.reset();
    res.json({ remote_circuit_open: orchestrator.router.circuit_breaker.isOpen() });
  });

  app.get('/api/config', (req, res) => {
    res.json({
      capabilities: orchestrator.router.capabilities,
      policy: orchestrator.router.policy,
      rates: orchestrator.cost_calculator.rates,
      kernel_version: orchestrator.kernel.version,
    });
  });

  app.put('/api/config', (req, res) => {
    const { capabilities, policy, rates } = req.body;
    if (capabilities) {
      orchestrator.router.capabilities = {
        ...orchestrator.router.capabilities,
        ...capabilities,
      };
    }
    if (policy) {
      orchestrator.router.policy = {
        ...orchestrator.router.policy,
        ...policy,
      };
      orchestrator.router.circuit_breaker.failure_threshold =
        orchestrator.router.policy.remote_circuit_failure_threshold;
      orchestrator.router.circuit_breaker.reset_seconds =
        orchestrator.router.policy.remote_circuit_reset_seconds;
    }
    if (rates) {
      orchestrator.cost_calculator.rates = {
        ...orchestrator.cost_calculator.rates,
        ...rates,
      };
    }
    res.json({
      capabilities: orchestrator.router.capabilities,
      policy: orchestrator.router.policy,
      rates: orchestrator.cost_calculator.rates,
    });
  });

  app.post('/api/tasks', async (req, res) => {
    try {
      const body = req.body;
      const rawState = body.state ? Buffer.from(body.state, 'utf-8').toString('base64') : (body.serialized_state || 'e30=');
      const stateBytes = body.state ? Buffer.byteLength(body.state, 'utf-8') : (body.context_size_bytes || 0);

      const task: AxiomTask = {
        id: body.id || `task_${crypto.randomBytes(8).toString('hex')}`,
        trace_id: body.trace_id || `tr_${crypto.randomBytes(12).toString('hex')}`,
        objective: body.objective || 'Default objective',
        depth: typeof body.depth === 'number' ? body.depth : 1,
        tokens_remaining: typeof body.tokens_remaining === 'number' ? body.tokens_remaining : 8000,
        context_size_bytes: stateBytes,
        required_compute: {
          model: body.required_compute?.model || 'llama2-7b',
          minVramMb: body.required_compute?.minVramMb || 0,
          gpuRequired: !!body.required_compute?.gpuRequired,
          preferLocal: body.required_compute?.preferLocal !== false,
          estimatedLocalLatencyMs: body.required_compute?.estimatedLocalLatencyMs,
        },
        serialized_state: rawState,
        parent_task_id: body.parent_task_id || null,
        execution_env: body.execution_env || 'auto',
        allow_degraded_local: body.allow_degraded_local !== false,
        created_at: new Date().toISOString(),
      };

      const result = await orchestrator.submit(task);
      res.json({ task, result });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/tasks', (req, res) => {
    res.json(orchestrator.getAllTasks());
  });

  app.get('/api/tasks/:id', (req, res) => {
    const task = orchestrator.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const result = orchestrator.getResult(req.params.id);
    res.json({ task, result });
  });

  app.get('/api/traces', (req, res) => {
    const traces = orchestrator.tracer.getAllTraces();
    res.json(traces);
  });

  app.get('/api/traces/:traceId', (req, res) => {
    const events = orchestrator.tracer.getEventsForTrace(req.params.traceId);
    res.json(events);
  });

  app.get('/api/cost/breakdown', (req, res) => {
    const traceId = req.query.trace_id ? String(req.query.trace_id) : undefined;
    const breakdown = orchestrator.cost_ledger.breakdown(traceId);
    res.json(breakdown);
  });

  app.get('/api/replays/:id', (req, res) => {
    try {
      const manifest = orchestrator.exportReplay(req.params.id);
      if (req.query.format === 'kubernetes') {
        const crd = {
          apiVersion: 'axiom.ai/v1alpha1',
          kind: 'AxiomJob',
          metadata: {
            name: manifest.task.id,
            namespace: 'axiom',
            annotations: {
              'axiom.ai/trace-id': manifest.trace_id,
              'axiom.ai/task-digest': manifest.task_digest,
            },
          },
          spec: manifest.task,
        };
        return res.json({ format: 'kubernetes', manifest, crd });
      }
      res.json(manifest);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  app.post('/api/replays/:id/verify', (req, res) => {
    try {
      const verification = orchestrator.verifyReplay(req.params.id);
      res.json(verification);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/simulate-load', async (req, res) => {
    try {
      const count = Math.min(100, Math.max(1, parseInt(req.body.count, 10) || 20));
      const remoteEvery = parseInt(req.body.remote_every, 10) || 5;
      const report = await orchestrator.runSimulatedLoad(count, remoteEvery);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/constitutional/invariants', (req, res) => {
    res.json({
      version: orchestrator.kernel.version,
      invariants: orchestrator.kernel.invariants,
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AXIOM OS Control Plane running on http://localhost:${PORT}`);
  });
}

startServer();
