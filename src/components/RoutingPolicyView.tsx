import React, { useState } from 'react';
import { Sliders, Activity, Zap, Play, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';
import { HealthReport, LocalCapabilities, RoutingPolicy } from '../types';

interface RoutingPolicyViewProps {
  health: HealthReport | null;
  policy: RoutingPolicy;
  capabilities: LocalCapabilities;
  onUpdateConfig: (caps: Partial<LocalCapabilities>, pol: Partial<RoutingPolicy>) => void;
  onToggleRemote: () => void;
  onToggleLocal: () => void;
  onResetCircuit: () => void;
}

export const RoutingPolicyView: React.FC<RoutingPolicyViewProps> = ({
  health,
  policy,
  capabilities,
  onUpdateConfig,
  onToggleRemote,
  onToggleLocal,
  onResetCircuit,
}) => {
  const [maxDepth, setMaxDepth] = useState(policy.local_max_depth);
  const [frameBudget, setFrameBudget] = useState(policy.local_frame_budget_ms);
  const [contextWindow, setContextWindow] = useState(capabilities.local_context_window);
  const [gpuAvailable, setGpuAvailable] = useState(capabilities.gpu_available);
  const [freeVramMb, setFreeVramMb] = useState(capabilities.free_vram_mb);

  // Simulation state
  const [simCount, setSimCount] = useState(25);
  const [simRemoteEvery, setSimRemoteEvery] = useState(5);
  const [simLoading, setSimLoading] = useState(false);
  const [simReport, setSimReport] = useState<any>(null);

  const handleSavePolicy = () => {
    onUpdateConfig(
      {
        local_context_window: contextWindow,
        gpu_available: gpuAvailable,
        free_vram_mb: freeVramMb,
      },
      {
        local_max_depth: maxDepth,
        local_frame_budget_ms: frameBudget,
      }
    );
  };

  const handleRunSimulation = async () => {
    setSimLoading(true);
    try {
      const res = await fetch('/api/simulate-load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: simCount, remote_every: simRemoteEvery }),
      });
      const data = await res.json();
      setSimReport(data);
    } catch (err) {
      console.error(err);
    } finally {
      setSimLoading(false);
    }
  };

  return (
    <div id="axiom-routing-policy" className="space-y-6">
      {/* Tier Health & Circuit Breaker */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-semibold text-white">Execution Tier Liveness & Circuit Breaker</h2>
          </div>
          <span className="text-xs text-slate-400 font-mono">Profile: Hybrid Zero-Infra</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300">Local Tier Status</span>
              {capabilities.local_healthy ? (
                <span className="text-xs text-emerald-400 flex items-center gap-1 font-mono">
                  <CheckCircle className="w-3.5 h-3.5" /> Healthy
                </span>
              ) : (
                <span className="text-xs text-rose-400 flex items-center gap-1 font-mono">
                  <AlertCircle className="w-3.5 h-3.5" /> Degraded
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Low-latency edge/container execution tier for bounded tasks.
            </p>
            <button
              onClick={onToggleLocal}
              className="w-full text-xs py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 transition-colors"
            >
              Toggle Local Liveness
            </button>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300">Remote Tier Status</span>
              {health?.remote_healthy ? (
                <span className="text-xs text-indigo-400 flex items-center gap-1 font-mono">
                  <CheckCircle className="w-3.5 h-3.5" /> Available
                </span>
              ) : (
                <span className="text-xs text-rose-400 flex items-center gap-1 font-mono">
                  <AlertCircle className="w-3.5 h-3.5" /> Offline
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Kubernetes cluster & high-concurrency cloud worker pool.
            </p>
            <button
              onClick={onToggleRemote}
              className="w-full text-xs py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 transition-colors"
            >
              Toggle Remote Liveness
            </button>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300">Remote Circuit Breaker</span>
              {health?.remote_circuit_open ? (
                <span className="text-xs text-rose-400 flex items-center gap-1 font-mono font-bold">
                  <AlertCircle className="w-3.5 h-3.5" /> OPEN (Tripped)
                </span>
              ) : (
                <span className="text-xs text-emerald-400 flex items-center gap-1 font-mono">
                  <CheckCircle className="w-3.5 h-3.5" /> CLOSED (Ready)
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Threshold: {policy.remote_circuit_failure_threshold} fails, cooldown:{' '}
              {policy.remote_circuit_reset_seconds}s.
            </p>
            <button
              onClick={onResetCircuit}
              className="w-full text-xs py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 transition-colors"
            >
              Reset Circuit Breaker
            </button>
          </div>
        </div>
      </div>

      {/* Threshold Configuration */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
        <div className="flex items-center gap-2 mb-4">
          <Sliders className="w-5 h-5 text-sky-400" />
          <h2 className="text-lg font-semibold text-white">Local Constraint Boundaries</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block text-slate-300 font-medium mb-1">
              Local Max Recursion Depth
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={maxDepth}
              onChange={(e) => setMaxDepth(parseInt(e.target.value, 10) || 1)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100"
            />
            <p className="text-[11px] text-slate-500 mt-1">Tasks exceeding this depth route remote.</p>
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">
              Local Frame Budget (ms)
            </label>
            <input
              type="number"
              step={5}
              min={10}
              max={500}
              value={frameBudget}
              onChange={(e) => setFrameBudget(parseFloat(e.target.value) || 50)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100"
            />
            <p className="text-[11px] text-slate-500 mt-1">Target frame responsiveness target.</p>
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">
              Local Context Window (Tokens)
            </label>
            <input
              type="number"
              step={4000}
              min={4000}
              max={128000}
              value={contextWindow}
              onChange={(e) => setContextWindow(parseInt(e.target.value, 10) || 32000)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100"
            />
            <p className="text-[11px] text-slate-500 mt-1">Tasks requiring larger context route remote.</p>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
            <input
              type="checkbox"
              checked={gpuAvailable}
              onChange={(e) => setGpuAvailable(e.target.checked)}
              className="rounded bg-slate-950 border-slate-700 text-sky-500"
            />
            <span>Simulate Local GPU Hardware Available</span>
          </label>

          <button
            onClick={handleSavePolicy}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            Apply Policy Boundaries
          </button>
        </div>
      </div>

      {/* Synthetic Workload Benchmarking */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-white">Synthetic Load Simulator</h2>
          </div>
          <span className="text-xs text-slate-400">Concurrent Batch Evaluation</span>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Simulates the test harness in <code className="text-sky-300 font-mono">scripts/simulate-load.py</code>,
          concurrently submitting a mixed workload of local and remote tasks to measure routing latency distribution.
        </p>

        <div className="flex flex-wrap items-center gap-4 mb-4">
          <div className="flex items-center gap-2 text-xs">
            <label className="text-slate-300">Task Count:</label>
            <input
              type="number"
              min={5}
              max={100}
              value={simCount}
              onChange={(e) => setSimCount(parseInt(e.target.value, 10) || 20)}
              className="w-20 bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-slate-100 text-center"
            />
          </div>

          <div className="flex items-center gap-2 text-xs">
            <label className="text-slate-300">Route Remote Every N Tasks:</label>
            <input
              type="number"
              min={1}
              max={20}
              value={simRemoteEvery}
              onChange={(e) => setSimRemoteEvery(parseInt(e.target.value, 10) || 5)}
              className="w-20 bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-slate-100 text-center"
            />
          </div>

          <button
            onClick={handleRunSimulation}
            disabled={simLoading}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-medium text-xs rounded transition-colors"
          >
            {simLoading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Running...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" /> Run Simulation
              </>
            )}
          </button>
        </div>

        {simReport && (
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-xs font-mono">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 pb-3 border-b border-slate-800">
              <div>
                <span className="text-slate-500 block text-[10px]">Total Workload:</span>
                <span className="text-slate-200 font-bold">{simReport.workload_count} tasks</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Local Tasks:</span>
                <span className="text-emerald-400 font-bold">{simReport.local_count}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Remote Tasks:</span>
                <span className="text-indigo-400 font-bold">{simReport.remote_count}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Wall Clock Time:</span>
                <span className="text-sky-300 font-bold">{simReport.wall_clock_ms} ms</span>
              </div>
            </div>
            <div className="flex items-center gap-6 text-slate-300">
              <span>Latency p50: <span className="text-slate-100 font-bold">{simReport.latency_ms.p50} ms</span></span>
              <span>Latency p95: <span className="text-slate-100 font-bold">{simReport.latency_ms.p95} ms</span></span>
              <span>Max Latency: <span className="text-slate-100 font-bold">{simReport.latency_ms.max} ms</span></span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
