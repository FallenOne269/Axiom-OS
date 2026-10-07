import React from 'react';
import { History, CheckCircle2, XCircle, ArrowUpRight, Cpu, Server, Eye } from 'lucide-react';
import { AxiomTask, AxiomResult } from '../types';

interface TaskHistoryViewProps {
  tasks: { task: AxiomTask; result?: AxiomResult }[];
  onSelectTrace: (traceId: string) => void;
}

export const TaskHistoryView: React.FC<TaskHistoryViewProps> = ({ tasks, onSelectTrace }) => {
  return (
    <div id="axiom-task-history" className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-sky-400" />
          <h2 className="text-lg font-semibold text-white">Execution Ledger & History</h2>
        </div>
        <span className="text-xs text-slate-400 font-mono">
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} recorded
        </span>
      </div>

      {tasks.length === 0 ? (
        <div className="py-12 text-center text-slate-500 text-sm">
          No tasks recorded yet. Submit a task using the form above.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[11px]">
                <th className="pb-3 font-semibold">Status / Tier</th>
                <th className="pb-3 font-semibold">Task ID</th>
                <th className="pb-3 font-semibold">Objective</th>
                <th className="pb-3 font-semibold">Model / Depth</th>
                <th className="pb-3 font-semibold">Latency</th>
                <th className="pb-3 font-semibold">Cost</th>
                <th className="pb-3 font-semibold text-right">Trace Spine</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {tasks.map(({ task, result }) => {
                const status = result?.status || 'pending';
                const isSucceeded = status === 'succeeded';
                const isRejected = status === 'rejected';
                const location = result?.execution_location;

                return (
                  <tr key={task.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3">
                      <div className="flex items-center gap-1.5">
                        {isSucceeded ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : isRejected ? (
                          <XCircle className="w-4 h-4 text-rose-400" />
                        ) : (
                          <div className="w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
                        )}
                        <span
                          className={`text-[11px] font-bold uppercase ${
                            isSucceeded
                              ? 'text-emerald-400'
                              : isRejected
                              ? 'text-rose-400'
                              : 'text-amber-400'
                          }`}
                        >
                          {status}
                        </span>
                        {location && (
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded border uppercase ${
                              location === 'local'
                                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
                                : 'bg-indigo-950/60 text-indigo-300 border-indigo-800'
                            }`}
                          >
                            {location}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 text-slate-300">{task.id}</td>
                    <td className="py-3 font-sans text-slate-200 max-w-xs truncate">
                      {task.objective}
                    </td>
                    <td className="py-3 text-slate-400">
                      {task.required_compute.model} <span className="text-slate-600">|</span> d:
                      {task.depth}
                    </td>
                    <td className="py-3 text-slate-300">
                      {result?.usage.latency_ms !== undefined
                        ? `${result.usage.latency_ms} ms`
                        : '—'}
                    </td>
                    <td className="py-3 text-emerald-400 font-semibold">
                      {result?.cost.total_usd !== undefined
                        ? `$${result.cost.total_usd.toFixed(6)}`
                        : '—'}
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => onSelectTrace(task.trace_id)}
                        className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span className="text-[11px] font-mono">{task.trace_id.slice(0, 10)}...</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
