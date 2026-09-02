import React, { useState, useEffect } from 'react';
import { GitCommit, Clock, ShieldAlert, Cpu, CheckCircle2, ChevronRight, Hash } from 'lucide-react';
import { TraceEvent } from '../types';

interface TraceViewerProps {
  selectedTraceId?: string;
  traces: string[];
  onSelectTrace: (traceId: string) => void;
}

export const TraceViewer: React.FC<TraceViewerProps> = ({
  selectedTraceId,
  traces,
  onSelectTrace,
}) => {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<TraceEvent | null>(null);

  useEffect(() => {
    if (!selectedTraceId) return;
    setLoading(true);
    fetch(`/api/traces/${selectedTraceId}`)
      .then((res) => res.json())
      .then((data) => {
        setEvents(data);
        if (data.length > 0) {
          setSelectedEvent(data[data.length - 1]);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedTraceId]);

  return (
    <div id="axiom-trace-viewer" className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2">
          <GitCommit className="w-5 h-5 text-indigo-400" />
          <h2 className="text-lg font-semibold text-white">Trace Continuity & Audit Ledger</h2>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="trace-selector" className="text-xs text-slate-400">
            Active Trace:
          </label>
          <select
            id="trace-selector"
            value={selectedTraceId || ''}
            onChange={(e) => onSelectTrace(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {traces.length === 0 && <option value="">No traces recorded</option>}
            {traces.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-500 text-sm">Loading trace sequence...</div>
      ) : events.length === 0 ? (
        <div className="py-12 text-center text-slate-500 text-sm">
          Select or submit a task to view the execution trace spine.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Spans Timeline */}
          <div className="lg:col-span-1 space-y-2 border-r border-slate-800 pr-0 lg:pr-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Event Sequence ({events.length})
            </h3>
            <div className="space-y-2">
              {events.map((ev, index) => {
                const isSelected = selectedEvent?.event_id === ev.event_id;
                let badgeColor = 'bg-slate-800 text-slate-300 border-slate-700';
                if (ev.name.includes('constitution') || ev.name.includes('reject')) {
                  badgeColor = 'bg-rose-950/80 text-rose-300 border-rose-800';
                } else if (ev.name.includes('local')) {
                  badgeColor = 'bg-emerald-950/80 text-emerald-300 border-emerald-800';
                } else if (ev.name.includes('remote')) {
                  badgeColor = 'bg-indigo-950/80 text-indigo-300 border-indigo-800';
                } else if (ev.name === 'task.complete') {
                  badgeColor = 'bg-sky-950/80 text-sky-300 border-sky-800';
                }

                return (
                  <button
                    key={ev.event_id}
                    onClick={() => setSelectedEvent(ev)}
                    className={`w-full text-left p-3 rounded-lg border text-xs transition-all ${
                      isSelected
                        ? 'bg-slate-800 border-indigo-500 shadow-md ring-1 ring-indigo-500/50'
                        : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono font-semibold text-slate-200">{ev.name}</span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {ev.timestamp.slice(11, 23)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badgeColor}`}>
                        {ev.execution_location || 'control-plane'}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500 truncate">
                        span: {ev.span_id.slice(0, 8)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Span Details & Privacy Attribute Inspection */}
          <div className="lg:col-span-2">
            {selectedEvent ? (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 text-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div>
                    <h4 className="font-bold text-sm text-slate-100 font-mono">
                      {selectedEvent.name}
                    </h4>
                    <p className="text-slate-500 text-[11px] mt-0.5">
                      Event ID: <span className="font-mono">{selectedEvent.event_id}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400 font-mono">
                      Span ID: {selectedEvent.span_id}
                    </span>
                    {selectedEvent.parent_span_id && (
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                        Parent: {selectedEvent.parent_span_id}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Trace ID:</span>
                    <span className="font-mono text-slate-200">{selectedEvent.trace_id}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Task ID:</span>
                    <span className="font-mono text-slate-200">{selectedEvent.task_id}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Placement Tier:</span>
                    <span className="font-mono text-indigo-300">
                      {selectedEvent.execution_location || 'Control-Plane Router'}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">
                      Sanitized Audit Attributes (SHA-256 Hashed Privacy Boundary)
                    </span>
                    <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Redaction Verified
                    </span>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-60">
                    <pre>{JSON.stringify(selectedEvent.attributes, null, 2)}</pre>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    * Sensitive attributes (objectives, prompts, serialized states) are securely
                    digested via SHA-256 before ingestion into the permanent audit ledger.
                  </p>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-600 text-xs py-12">
                Select an event from the sequence to inspect details.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
