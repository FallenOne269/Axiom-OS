import React, { useState } from 'react';
import { Shield, CheckCircle, FileText, Code2, AlertTriangle, Copy, Check } from 'lucide-react';
import { AxiomTask } from '../types';

interface ConstitutionalKernelViewProps {
  tasks: { task: AxiomTask }[];
}

const INVARIANTS_INFO = [
  { name: 'identity', desc: 'Every task execution maintains an immutable, globally unique trace_id and task_id.' },
  { name: 'provenance', desc: 'Lineage traces back to actor and parent state digest.' },
  { name: 'authority', desc: 'Only validated callers with proper authority (execute, propose, ratify) may mutate state.' },
  { name: 'integrity', desc: 'Canonical serialization and cryptographic SHA-256 digests prevent payload tampering.' },
  { name: 'epistemic_honesty', desc: 'No hallucinated or unverified status updates; execution errors are preserved.' },
  { name: 'independent_evaluation', desc: 'Evaluator and proposer must be strictly independent entities.' },
  { name: 'reversibility', desc: 'Consequential mutations must be structurally reversible.' },
  { name: 'observability', desc: 'Every state transition is recorded as an immutable, sanitized audit span.' },
  { name: 'boundedness', desc: 'Explicit, unyielding caps on recursion depth and token allocations.' },
  { name: 'external_ratification', desc: 'AXIOM cannot ratify its own constitution; mutations require external authority.' },
];

export const ConstitutionalKernelView: React.FC<ConstitutionalKernelViewProps> = ({ tasks }) => {
  const [selectedTaskId, setSelectedTaskId] = useState<string>(tasks[0]?.task.id || '');
  const [verificationResult, setVerificationResult] = useState<any>(null);
  const [manifestData, setManifestData] = useState<any>(null);
  const [k8sManifest, setK8sManifest] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'kernel' | 'verify' | 'k8s'>('kernel');

  const handleVerify = async (taskId: string) => {
    if (!taskId) return;
    try {
      const res = await fetch(`/api/replays/${taskId}/verify`, { method: 'POST' });
      const data = await res.json();
      setVerificationResult(data);

      const replayRes = await fetch(`/api/replays/${taskId}?format=kubernetes`);
      const replayData = await replayRes.json();
      setManifestData(replayData.manifest);
      setK8sManifest(replayData.crd);
    } catch (err) {
      console.error(err);
    }
  };

  const copyK8s = () => {
    if (!k8sManifest) return;
    navigator.clipboard.writeText(JSON.stringify(k8sManifest, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div id="axiom-constitutional-kernel" className="space-y-6">
      {/* Header Tabs */}
      <div className="flex border-b border-slate-800 gap-4">
        <button
          onClick={() => setActiveTab('kernel')}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'kernel'
              ? 'border-sky-500 text-sky-400'
              : 'border-transparent text-slate-400 hover:text-slate-300'
          }`}
        >
          Constitutional Kernel & Invariants
        </button>
        <button
          onClick={() => {
            setActiveTab('verify');
            if (tasks.length > 0 && !verificationResult) {
              handleVerify(tasks[0].task.id);
            }
          }}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'verify'
              ? 'border-sky-500 text-sky-400'
              : 'border-transparent text-slate-400 hover:text-slate-300'
          }`}
        >
          Replay Verification Engine
        </button>
        <button
          onClick={() => {
            setActiveTab('k8s');
            if (tasks.length > 0 && !k8sManifest) {
              handleVerify(tasks[0].task.id);
            }
          }}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'k8s'
              ? 'border-sky-500 text-sky-400'
              : 'border-transparent text-slate-400 hover:text-slate-300'
          }`}
        >
          Kubernetes AxiomJob CRD Exporter
        </button>
      </div>

      {activeTab === 'kernel' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-emerald-400" />
              <h3 className="text-base font-semibold text-white">AXIOM Constitutional Invariants (v1.0)</h3>
            </div>
            <span className="text-xs px-2.5 py-1 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded-full font-mono">
              Immutable Boundary Enforced
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            The constitutional layer defines the non-self-modifiable boundary of the AXIOM OS control plane.
            Before any task envelope enters execution or routing, it must satisfy all 10 constitutional guarantees.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
            {INVARIANTS_INFO.map((inv, index) => (
              <div
                key={inv.name}
                className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 flex items-start gap-3"
              >
                <div className="w-6 h-6 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center text-[10px] font-mono font-bold text-sky-400 shrink-0 mt-0.5">
                  0{index + 1}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono font-bold text-slate-200 uppercase">
                      {inv.name}
                    </span>
                    <CheckCircle className="w-3 h-3 text-emerald-400" />
                  </div>
                  <p className="text-xs text-slate-400">{inv.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'verify' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-base font-semibold text-white">Cryptographic Digest & Replay Verifier</h3>
              <p className="text-xs text-slate-400">
                Validates task identity and result digest against exported reproducibility contracts.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={selectedTaskId}
                onChange={(e) => {
                  setSelectedTaskId(e.target.value);
                  handleVerify(e.target.value);
                }}
                className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
              >
                {tasks.map((t) => (
                  <option key={t.task.id} value={t.task.id}>
                    {t.task.id} ({t.task.objective.slice(0, 24)}...)
                  </option>
                ))}
              </select>
              <button
                onClick={() => handleVerify(selectedTaskId)}
                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg"
              >
                Verify
              </button>
            </div>
          </div>

          {verificationResult ? (
            <div className="space-y-4">
              <div
                className={`p-4 rounded-lg border text-xs ${
                  verificationResult.verified
                    ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-sm mb-1">
                  {verificationResult.verified ? (
                    <>
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                      Cryptographic Replay Contract Verified
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4 text-rose-400" />
                      Replay Digest Mismatch
                    </>
                  )}
                </div>
                <p className="text-slate-300 text-xs">
                  Canonical SHA-256 digests confirm zero task mutation and deterministic output reproducibility across transport boundaries.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                <div className="bg-slate-950 border border-slate-800 p-4 rounded-lg">
                  <span className="text-slate-500 block text-[10px]">Task Digest Status</span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-slate-200 font-bold">
                      {verificationResult.task_digest_matches ? 'MATCH (Verified)' : 'MISMATCH'}
                    </span>
                  </div>
                  {manifestData && (
                    <p className="text-[11px] text-slate-400 mt-2 truncate">
                      Digest: {manifestData.task_digest}
                    </p>
                  )}
                </div>

                <div className="bg-slate-950 border border-slate-800 p-4 rounded-lg">
                  <span className="text-slate-500 block text-[10px]">Result Digest Status</span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-slate-200 font-bold">
                      {verificationResult.result_digest_matches ? 'MATCH (Reproducible)' : 'MISMATCH'}
                    </span>
                  </div>
                  {manifestData && (
                    <p className="text-[11px] text-slate-400 mt-2 truncate">
                      Expected: {manifestData.expected_result_digest || 'None recorded'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-slate-500 text-xs">
              Select a task to execute cryptographic verification.
            </div>
          )}
        </div>
      )}

      {activeTab === 'k8s' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-base font-semibold text-white">Kubernetes Custom Resource Export</h3>
              <p className="text-xs text-slate-400">
                Canonical <code className="text-sky-400 font-mono">AxiomJob</code> resource specification for remote cluster deployment.
              </p>
            </div>
            <button
              onClick={copyK8s}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy Resource YAML'}
            </button>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 font-mono text-xs text-slate-300 overflow-x-auto max-h-96">
            <pre>{k8sManifest ? JSON.stringify(k8sManifest, null, 2) : 'Select a task to export resource manifest.'}</pre>
          </div>
        </div>
      )}
    </div>
  );
};
