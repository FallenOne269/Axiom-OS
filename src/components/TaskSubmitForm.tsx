import React, { useState } from 'react';
import { Play, Sparkles, AlertTriangle, ShieldCheck, Layers } from 'lucide-react';
import { AxiomTask, AxiomResult, ExecutionEnv } from '../types';

interface TaskSubmitFormProps {
  onTaskSubmitted: (data: { task: AxiomTask; result: AxiomResult }) => void;
  availableModels: string[];
}

export const TaskSubmitForm: React.FC<TaskSubmitFormProps> = ({
  onTaskSubmitted,
  availableModels,
}) => {
  const [objective, setObjective] = useState('Verify a bounded local AXIOM agent task');
  const [depth, setDepth] = useState<number>(1);
  const [tokens, setTokens] = useState<number>(8000);
  const [model, setModel] = useState<string>('llama2-7b');
  const [executionEnv, setExecutionEnv] = useState<ExecutionEnv>('auto');
  const [gpuRequired, setGpuRequired] = useState<boolean>(false);
  const [minVramMb, setMinVramMb] = useState<number>(0);
  const [allowDegraded, setAllowDegraded] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<AxiomResult | null>(null);

  const applyPreset = (type: string) => {
    switch (type) {
      case 'local':
        setObjective('Process bounded reasoning loop on local tier');
        setDepth(1);
        setTokens(8000);
        setModel('llama2-7b');
        setExecutionEnv('auto');
        setGpuRequired(false);
        setMinVramMb(0);
        break;
      case 'deep_remote':
        setObjective('Complex hierarchical planning tree requiring remote compute');
        setDepth(5);
        setTokens(12000);
        setModel('llama2-7b');
        setExecutionEnv('auto');
        setGpuRequired(false);
        break;
      case 'large_context':
        setObjective('Summarize multi-document repository history');
        setDepth(1);
        setTokens(64000); // Exceeds local 32k window
        setModel('llama2-7b');
        setExecutionEnv('auto');
        break;
      case 'uncached_model':
        setObjective('Evaluate specialized domain model inference');
        setDepth(1);
        setTokens(4000);
        setModel('claude-3-opus'); // Not in local cache
        setExecutionEnv('auto');
        break;
      case 'gpu_heavy':
        setObjective('Accelerated tensor transformation step');
        setDepth(1);
        setTokens(4000);
        setModel('llama2-7b');
        setGpuRequired(true);
        setMinVramMb(8192);
        break;
      case 'constitutional_reject':
        setObjective('Unbounded infinite recursion task exceeding safety boundary');
        setDepth(15); // Violates constitutional bound
        setTokens(8000);
        break;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective,
          depth,
          tokens_remaining: tokens,
          execution_env: executionEnv,
          allow_degraded_local: allowDegraded,
          required_compute: {
            model,
            gpuRequired,
            minVramMb,
            preferLocal: true,
          },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setLastResult(data.result);
        onTaskSubmitted(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div id="axiom-task-submit" className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-sky-400" />
          <h2 className="text-lg font-semibold text-white">Task Submission & Routing Engine</h2>
        </div>
        <span className="text-xs px-2.5 py-1 bg-slate-800 text-slate-300 rounded-full border border-slate-700">
          Deterministic Router Active
        </span>
      </div>

      <div className="mb-4">
        <label className="text-xs font-medium text-slate-400 mb-2 block">Quick Test Presets:</label>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => applyPreset('local')}
            className="text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded border border-emerald-900/50 transition-colors"
          >
            Local Bounded (Depth 1)
          </button>
          <button
            type="button"
            onClick={() => applyPreset('deep_remote')}
            className="text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-indigo-300 rounded border border-indigo-900/50 transition-colors"
          >
            Deep Recursion (Depth 5 &rarr; Remote)
          </button>
          <button
            type="button"
            onClick={() => applyPreset('large_context')}
            className="text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-purple-300 rounded border border-purple-900/50 transition-colors"
          >
            Large Context (64k &rarr; Remote)
          </button>
          <button
            type="button"
            onClick={() => applyPreset('uncached_model')}
            className="text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded border border-amber-900/50 transition-colors"
          >
            Uncached Model &rarr; Remote
          </button>
          <button
            type="button"
            onClick={() => applyPreset('gpu_heavy')}
            className="text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded border border-cyan-900/50 transition-colors"
          >
            GPU Required &rarr; Remote
          </button>
          <button
            type="button"
            onClick={() => applyPreset('constitutional_reject')}
            className="text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-rose-300 rounded border border-rose-900/50 transition-colors"
          >
            Violate Invariant (Depth 15 &rarr; Reject)
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="task-objective" className="block text-xs font-medium text-slate-300 mb-1">
            Task Objective
          </label>
          <input
            id="task-objective"
            type="text"
            required
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
            placeholder="e.g. Execute multi-step task synthesis"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label htmlFor="task-depth" className="block text-xs font-medium text-slate-300 mb-1">
              Recursion Depth
            </label>
            <input
              id="task-depth"
              type="number"
              min={0}
              max={20}
              value={depth}
              onChange={(e) => setDepth(parseInt(e.target.value, 10) || 0)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100"
            />
            <p className="text-[10px] text-slate-500 mt-0.5">Local limit: 3</p>
          </div>

          <div>
            <label htmlFor="task-tokens" className="block text-xs font-medium text-slate-300 mb-1">
              Tokens Remaining
            </label>
            <input
              id="task-tokens"
              type="number"
              step={1000}
              min={1000}
              max={128000}
              value={tokens}
              onChange={(e) => setTokens(parseInt(e.target.value, 10) || 1000)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100"
            />
            <p className="text-[10px] text-slate-500 mt-0.5">Local limit: 32,000</p>
          </div>

          <div>
            <label htmlFor="task-model" className="block text-xs font-medium text-slate-300 mb-1">
              Model
            </label>
            <input
              id="task-model"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100"
            />
            <p className="text-[10px] text-slate-500 mt-0.5">
              Cached: {availableModels.join(', ') || 'none'}
            </p>
          </div>

          <div>
            <label htmlFor="task-placement" className="block text-xs font-medium text-slate-300 mb-1">
              Placement Policy
            </label>
            <select
              id="task-placement"
              value={executionEnv}
              onChange={(e) => setExecutionEnv(e.target.value as ExecutionEnv)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100"
            >
              <option value="auto">Auto (Constraint-based)</option>
              <option value="local">Explicit Local</option>
              <option value="remote">Explicit Remote</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 pt-1 text-xs text-slate-300">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={gpuRequired}
              onChange={(e) => setGpuRequired(e.target.checked)}
              className="rounded bg-slate-950 border-slate-700 text-sky-500 focus:ring-0"
            />
            <span>Require GPU</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={allowDegraded}
              onChange={(e) => setAllowDegraded(e.target.checked)}
              className="rounded bg-slate-950 border-slate-700 text-sky-500 focus:ring-0"
            />
            <span>Allow Degraded Local Fallback</span>
          </label>
        </div>

        <div className="pt-2 flex items-center justify-between">
          <button
            id="btn-submit-task"
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-2 px-5 py-2.5 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-medium rounded-lg text-sm transition-all shadow-lg shadow-sky-950/50 disabled:opacity-50"
          >
            <Play className="w-4 h-4 fill-current" />
            {isSubmitting ? 'Routing & Executing...' : 'Submit Task to Control Plane'}
          </button>
        </div>
      </form>

      {lastResult && (
        <div className="mt-4 p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
            <span className="font-semibold text-slate-200">Execution Result</span>
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded font-mono uppercase text-[11px] ${
                  lastResult.status === 'succeeded'
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                    : 'bg-rose-950 text-rose-400 border border-rose-800'
                }`}
              >
                {lastResult.status}
              </span>
              {lastResult.execution_location && (
                <span
                  className={`px-2 py-0.5 rounded font-mono text-[11px] uppercase ${
                    lastResult.execution_location === 'local'
                      ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700'
                      : 'bg-indigo-900/40 text-indigo-300 border border-indigo-700'
                  }`}
                >
                  Tier: {lastResult.execution_location}
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-400">
            <div>
              Task ID: <span className="font-mono text-slate-200">{lastResult.task_id}</span>
            </div>
            <div>
              Trace ID: <span className="font-mono text-slate-200">{lastResult.trace_id}</span>
            </div>
            <div>
              Latency:{' '}
              <span className="font-mono text-slate-200">{lastResult.usage.latency_ms} ms</span>
            </div>
            <div>
              Cost:{' '}
              <span className="font-mono text-emerald-400 font-medium">
                ${lastResult.cost.total_usd.toFixed(8)}
              </span>
            </div>
          </div>
          {lastResult.output && (
            <div className="mt-2 text-slate-300 bg-slate-900/80 p-2 rounded border border-slate-800/80 font-mono">
              {lastResult.output}
            </div>
          )}
          {lastResult.error && (
            <div className="mt-2 text-rose-400 bg-rose-950/40 p-2 rounded border border-rose-900/50 font-mono">
              {lastResult.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
