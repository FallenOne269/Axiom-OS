import React, { useState, useEffect } from 'react';
import {
  Shield,
  Layers,
  GitCommit,
  Sliders,
  DollarSign,
  Activity,
  Server,
  Cpu,
  RefreshCw,
} from 'lucide-react';
import {
  AxiomTask,
  AxiomResult,
  HealthReport,
  LocalCapabilities,
  RoutingPolicy,
} from './types';
import { TaskSubmitForm } from './components/TaskSubmitForm';
import { TaskHistoryView } from './components/TaskHistoryView';
import { TraceViewer } from './components/TraceViewer';
import { RoutingPolicyView } from './components/RoutingPolicyView';
import { ConstitutionalKernelView } from './components/ConstitutionalKernelView';
import { CostAnalysisView } from './components/CostAnalysisView';

type Tab = 'runner' | 'traces' | 'policy' | 'constitution' | 'costs';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('runner');
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [tasks, setTasks] = useState<{ task: AxiomTask; result?: AxiomResult }[]>([]);
  const [traces, setTraces] = useState<string[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string>('');
  const [capabilities, setCapabilities] = useState<LocalCapabilities>({
    available_models: ['llama2-7b', 'mistral-7b'],
    gpu_available: false,
    free_vram_mb: 0,
    local_context_window: 32000,
    max_serialized_state_bytes: 4000000,
    predicted_frame_ms: 5.0,
    local_healthy: true,
  });
  const [policy, setPolicy] = useState<RoutingPolicy>({
    local_max_depth: 3,
    local_frame_budget_ms: 50.0,
    remote_submit_budget_ms: 200.0,
    remote_circuit_failure_threshold: 3,
    remote_circuit_reset_seconds: 30.0,
  });

  const fetchData = async () => {
    try {
      const [hRes, tRes, trRes, cfgRes] = await Promise.all([
        fetch('/api/health').then((r) => r.json()),
        fetch('/api/tasks').then((r) => r.json()),
        fetch('/api/traces').then((r) => r.json()),
        fetch('/api/config').then((r) => r.json()),
      ]);

      setHealth(hRes);
      setTasks(tRes);
      setTraces(trRes);
      if (trRes.length > 0 && !selectedTraceId) {
        setSelectedTraceId(trRes[0]);
      }
      if (cfgRes.capabilities) setCapabilities(cfgRes.capabilities);
      if (cfgRes.policy) setPolicy(cfgRes.policy);
    } catch (err) {
      console.error('Error fetching data:', err);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleTaskSubmitted = (data: { task: AxiomTask; result: AxiomResult }) => {
    setTasks((prev) => [data, ...prev]);
    if (!traces.includes(data.task.trace_id)) {
      setTraces((prev) => [data.task.trace_id, ...prev]);
    }
    setSelectedTraceId(data.task.trace_id);
    fetchData();
  };

  const handleToggleRemote = async () => {
    await fetch('/api/health/toggle-remote', { method: 'POST' });
    fetchData();
  };

  const handleToggleLocal = async () => {
    await fetch('/api/health/toggle-local', { method: 'POST' });
    fetchData();
  };

  const handleResetCircuit = async () => {
    await fetch('/api/health/reset-circuit', { method: 'POST' });
    fetchData();
  };

  const handleUpdateConfig = async (
    caps: Partial<LocalCapabilities>,
    pol: Partial<RoutingPolicy>
  ) => {
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilities: caps, policy: pol }),
    });
    fetchData();
  };

  const handleSelectTrace = (traceId: string) => {
    setSelectedTraceId(traceId);
    setActiveTab('traces');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sky-600 flex items-center justify-center shadow-lg shadow-sky-600/30">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-white tracking-wide">AXIOM OS</h1>
                <span className="text-[10px] px-1.5 py-0.5 bg-sky-950 text-sky-400 border border-sky-800 rounded font-mono">
                  v0.1.0-hybrid
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Hybrid Agent-Execution Control Plane
              </p>
            </div>
          </div>

          {/* Quick System Telemetry */}
          <div className="flex items-center gap-3 text-xs font-mono">
            <div className="hidden md:flex items-center gap-2 px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-400">Local Tier:</span>
              <span className={capabilities.local_healthy ? 'text-emerald-400 font-bold' : 'text-rose-400'}>
                {capabilities.local_healthy ? 'HEALTHY' : 'DEGRADED'}
              </span>
            </div>

            <div className="hidden md:flex items-center gap-2 px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg">
              <Server className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-slate-400">Remote Tier:</span>
              <span className={health?.remote_healthy ? 'text-indigo-400 font-bold' : 'text-rose-400'}>
                {health?.remote_healthy ? 'AVAILABLE' : 'OFFLINE'}
              </span>
            </div>

            <div className="flex items-center gap-2 px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg">
              <Activity className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-slate-400">Breaker:</span>
              <span className={health?.remote_circuit_open ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                {health?.remote_circuit_open ? 'TRIPPED' : 'CLOSED'}
              </span>
            </div>

            <button
              onClick={fetchData}
              title="Refresh status"
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Navigation Sub-header */}
      <nav className="bg-slate-900/60 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-1 overflow-x-auto py-2">
            <button
              id="nav-runner"
              onClick={() => setActiveTab('runner')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'runner'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Layers className="w-4 h-4" />
              Task Runner & Execution
            </button>

            <button
              id="nav-traces"
              onClick={() => setActiveTab('traces')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'traces'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <GitCommit className="w-4 h-4" />
              Trace Spine & Audit Ledger
              {traces.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 bg-sky-950 text-sky-200 rounded-full font-mono">
                  {traces.length}
                </span>
              )}
            </button>

            <button
              id="nav-policy"
              onClick={() => setActiveTab('policy')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'policy'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Sliders className="w-4 h-4" />
              Routing Policy & Resilience
            </button>

            <button
              id="nav-constitution"
              onClick={() => setActiveTab('constitution')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'constitution'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Shield className="w-4 h-4" />
              Constitutional Kernel & Replay
            </button>

            <button
              id="nav-costs"
              onClick={() => setActiveTab('costs')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'costs'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <DollarSign className="w-4 h-4" />
              Cost Attribution
            </button>
          </div>
        </div>
      </nav>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {activeTab === 'runner' && (
          <div className="space-y-6">
            <TaskSubmitForm
              onTaskSubmitted={handleTaskSubmitted}
              availableModels={capabilities.available_models}
            />
            <TaskHistoryView tasks={tasks} onSelectTrace={handleSelectTrace} />
          </div>
        )}

        {activeTab === 'traces' && (
          <TraceViewer
            selectedTraceId={selectedTraceId}
            traces={traces}
            onSelectTrace={setSelectedTraceId}
          />
        )}

        {activeTab === 'policy' && (
          <RoutingPolicyView
            health={health}
            policy={policy}
            capabilities={capabilities}
            onUpdateConfig={handleUpdateConfig}
            onToggleRemote={handleToggleRemote}
            onToggleLocal={handleToggleLocal}
            onResetCircuit={handleResetCircuit}
          />
        )}

        {activeTab === 'constitution' && (
          <ConstitutionalKernelView tasks={tasks} />
        )}

        {activeTab === 'costs' && <CostAnalysisView />}
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 border-t border-slate-800 py-4 text-center text-xs text-slate-500 font-mono">
        AXIOM OS Control Plane &bull; Deterministic Hybrid Task Routing &bull; Trace Continuity Spine &bull; Port 3000
      </footer>
    </div>
  );
}
