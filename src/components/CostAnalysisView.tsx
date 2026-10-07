import React, { useState, useEffect } from 'react';
import { DollarSign, Server, Globe, Cpu, ArrowUpRight, Check } from 'lucide-react';

export const CostAnalysisView: React.FC = () => {
  const [costData, setCostData] = useState<any>(null);
  const [rates, setRates] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const fetchCosts = () => {
    setLoading(true);
    Promise.all([
      fetch('/api/cost/breakdown').then((r) => r.json()),
      fetch('/api/config').then((r) => r.json()),
    ])
      .then(([cost, config]) => {
        setCostData(cost);
        setRates(config.rates);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchCosts();
  }, []);

  const handleUpdateRates = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rates) return;
    try {
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates }),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      fetchCosts();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div id="axiom-cost-analysis" className="space-y-6">
      {/* Cost Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400">Total Attributed Cost</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-800 flex items-center justify-center text-emerald-400">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-mono font-bold text-white mb-1">
            ${costData ? costData.total_usd.toFixed(6) : '0.000000'}
          </div>
          <span className="text-[11px] text-slate-500">
            Across {costData ? costData.task_count : 0} executed tasks
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400">Local Tier Compute</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-950/60 border border-emerald-800 flex items-center justify-center text-emerald-400">
              <Cpu className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-mono font-bold text-emerald-400 mb-1">
            ${costData ? costData.local_compute_usd.toFixed(6) : '0.000000'}
          </div>
          <span className="text-[11px] text-slate-500">
            Edge/container core-second rate
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400">Remote Cloud Compute</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-950/60 border border-indigo-800 flex items-center justify-center text-indigo-400">
              <Server className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-mono font-bold text-indigo-400 mb-1">
            ${costData ? costData.remote_compute_usd.toFixed(6) : '0.000000'}
          </div>
          <span className="text-[11px] text-slate-500">
            Kubernetes node core-second rate
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400">Tokens & Network Egress</span>
            <div className="w-8 h-8 rounded-lg bg-sky-950/60 border border-sky-800 flex items-center justify-center text-sky-400">
              <Globe className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-mono font-bold text-sky-400 mb-1">
            ${costData ? (costData.token_usd + costData.network_usd).toFixed(6) : '0.000000'}
          </div>
          <span className="text-[11px] text-slate-500">
            Prompt/completion tokens + egress
          </span>
        </div>
      </div>

      {/* Cost Rates Configuration */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-white">Configurable Attribution Rates</h3>
            <p className="text-xs text-slate-400">
              Rates are explicit environment and configuration inputs; values default to zero or known baselines to avoid hidden billing assumptions.
            </p>
          </div>
          <button
            onClick={fetchCosts}
            className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
          >
            Refresh Costs
          </button>
        </div>

        {rates && (
          <form onSubmit={handleUpdateRates} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Local Compute ($ / second)
                </label>
                <input
                  type="number"
                  step="0.00001"
                  value={rates.local_compute_per_second_usd}
                  onChange={(e) =>
                    setRates({
                      ...rates,
                      local_compute_per_second_usd: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Remote Compute ($ / second)
                </label>
                <input
                  type="number"
                  step="0.00001"
                  value={rates.remote_compute_per_second_usd}
                  onChange={(e) =>
                    setRates({
                      ...rates,
                      remote_compute_per_second_usd: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Input Tokens ($ / million)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={rates.input_token_per_million_usd}
                  onChange={(e) =>
                    setRates({
                      ...rates,
                      input_token_per_million_usd: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Output Tokens ($ / million)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={rates.output_token_per_million_usd}
                  onChange={(e) =>
                    setRates({
                      ...rates,
                      output_token_per_million_usd: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Egress Network ($ / GiB)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={rates.egress_gib_usd}
                  onChange={(e) =>
                    setRates({
                      ...rates,
                      egress_gib_usd: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono"
                />
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-3">
              {saveSuccess && (
                <span className="text-emerald-400 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Rates Saved
                </span>
              )}
              <button
                type="submit"
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-medium rounded-lg transition-colors"
              >
                Update Cost Attribution Rates
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
