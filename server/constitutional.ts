import crypto from 'crypto';

export type Authority = 'observe' | 'propose' | 'execute' | 'ratify' | 'constitutional';

export class InvariantViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantViolation';
  }
}

export interface ConstitutionalContext {
  trace_id: string;
  task_id: string;
  actor_id: string;
  authority: Authority;
  parent_state_hash: string;
  policy_version: string;
  mutation_id: string;
  external_ratification?: boolean;
  reversible?: boolean;
  evidence?: Record<string, any>;
}

export class AxiomKernel {
  readonly version = '1.0';
  readonly invariants = [
    'identity',
    'provenance',
    'authority',
    'integrity',
    'epistemic_honesty',
    'independent_evaluation',
    'reversibility',
    'observability',
    'boundedness',
    'external_ratification',
  ] as const;

  validate(context: ConstitutionalContext, requestedChange?: string | null): void {
    if (!context.trace_id || !context.task_id || !context.actor_id) {
      raiseInvariant('identity/provenance requires trace_id, task_id, and actor_id');
    }
    if (!context.parent_state_hash) {
      raiseInvariant('state mutation requires parent_state_hash');
    }
    if (!context.policy_version) {
      raiseInvariant('policy_version is required');
    }
    if (!context.mutation_id) {
      raiseInvariant('mutation_id is required');
    }
    if (context.reversible === false) {
      raiseInvariant('consequential mutations must be reversible');
    }

    if (requestedChange === 'constitution' && !context.external_ratification) {
      raiseInvariant(
        'constitutional changes require external ratification; AXIOM cannot ratify its own constitution'
      );
    }

    if (context.authority === 'constitutional' && !context.external_ratification) {
      raiseInvariant('constitutional authority requires external ratification');
    }
  }

  assertEvaluationIndependence(evaluatorId: string, proposerId: string): void {
    if (evaluatorId === proposerId) {
      raiseInvariant('proposer and evaluator must be independent');
    }
  }

  assertBudget(depth: number, maxDepth: number, tokens: number, maxTokens: number): void {
    if (depth < 0 || depth > maxDepth) {
      raiseInvariant(`recursion depth ${depth} exceeds constitutional bound ${maxDepth}`);
    }
    if (tokens < 0 || tokens > maxTokens) {
      raiseInvariant(`token budget ${tokens} exceeds constitutional bound ${maxTokens}`);
    }
  }
}

function raiseInvariant(message: string): never {
  throw new InvariantViolation(message);
}

export function digestConstitutionalContext(context: ConstitutionalContext): string {
  const sorted: Record<string, any> = {
    actor_id: context.actor_id,
    authority: context.authority,
    evidence: context.evidence || {},
    external_ratification: !!context.external_ratification,
    mutation_id: context.mutation_id,
    parent_state_hash: context.parent_state_hash,
    policy_version: context.policy_version,
    reversible: context.reversible !== false,
    task_id: context.task_id,
    trace_id: context.trace_id,
  };
  const json = JSON.stringify(sorted);
  return crypto.createHash('sha256').update(json).digest('hex');
}
