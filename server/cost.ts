import { AxiomResult, CostBreakdown, ExecutionLocation, Usage } from './types.js';

export interface CostRates {
  local_compute_per_second_usd: number;
  remote_compute_per_second_usd: number;
  input_token_per_million_usd: number;
  output_token_per_million_usd: number;
  egress_gib_usd: number;
}

export const defaultCostRates: CostRates = {
  local_compute_per_second_usd: 0.0001,
  remote_compute_per_second_usd: 0.0005,
  input_token_per_million_usd: 1.5,
  output_token_per_million_usd: 2.0,
  egress_gib_usd: 0.09,
};

export function roundMoney(value: number): number {
  return Math.round(value * 100000000) / 100000000;
}

export class CostCalculator {
  rates: CostRates;

  constructor(rates?: Partial<CostRates>) {
    this.rates = { ...defaultCostRates, ...(rates || {}) };
  }

  calculate(usage: Usage, location: ExecutionLocation): CostBreakdown {
    const runtimeSeconds = usage.latency_ms / 1000;
    const local =
      location === 'local' ? runtimeSeconds * this.rates.local_compute_per_second_usd : 0;
    const remote =
      location === 'remote' ? runtimeSeconds * this.rates.remote_compute_per_second_usd : 0;
    const tokens =
      (usage.prompt_tokens / 1000000) * this.rates.input_token_per_million_usd +
      (usage.completion_tokens / 1000000) * this.rates.output_token_per_million_usd;
    const network = (usage.egress_bytes / (1024 * 1024 * 1024)) * this.rates.egress_gib_usd;

    return {
      local_compute_usd: roundMoney(local),
      remote_compute_usd: roundMoney(remote),
      token_usd: roundMoney(tokens),
      network_usd: roundMoney(network),
      total_usd: roundMoney(local + remote + tokens + network),
      currency: 'USD',
    };
  }
}

export class CostLedger {
  private results: AxiomResult[] = [];

  record(result: AxiomResult): void {
    this.results.push(result);
  }

  getAll(): AxiomResult[] {
    return [...this.results];
  }

  breakdown(traceId?: string): {
    task_count: number;
    local_compute_usd: number;
    remote_compute_usd: number;
    token_usd: number;
    network_usd: number;
    total_usd: number;
  } {
    const selected = traceId
      ? this.results.filter((r) => r.trace_id === traceId)
      : this.results;

    let local = 0;
    let remote = 0;
    let tokens = 0;
    let network = 0;
    let total = 0;

    for (const res of selected) {
      local += res.cost.local_compute_usd;
      remote += res.cost.remote_compute_usd;
      tokens += res.cost.token_usd;
      network += res.cost.network_usd;
      total += res.cost.total_usd;
    }

    return {
      task_count: selected.length,
      local_compute_usd: roundMoney(local),
      remote_compute_usd: roundMoney(remote),
      token_usd: roundMoney(tokens),
      network_usd: roundMoney(network),
      total_usd: roundMoney(total),
    };
  }
}
