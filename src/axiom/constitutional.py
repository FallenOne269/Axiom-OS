"""Constitutional invariants for AXIOM OS.

The constitutional layer is intentionally small and dependency-light.  It
validates mutations before execution and records the authority/evidence
needed to audit a consequential state transition.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from hashlib import sha256
import json
from typing import Any, Mapping


class InvariantViolation(ValueError):
    """Raised when a constitutional invariant is violated."""


class Authority(str, Enum):
    OBSERVE = "observe"
    PROPOSE = "propose"
    EXECUTE = "execute"
    RATIFY = "ratify"
    CONSTITUTIONAL = "constitutional"


@dataclass(frozen=True)
class ConstitutionalContext:
    """Immutable context attached to a consequential mutation."""

    trace_id: str
    task_id: str
    actor_id: str
    authority: Authority
    parent_state_hash: str
    policy_version: str
    mutation_id: str
    external_ratification: bool = False
    reversible: bool = True
    evidence: Mapping[str, Any] = field(default_factory=dict)

    def canonical_dict(self) -> dict[str, Any]:
        return {
            "trace_id": self.trace_id,
            "task_id": self.task_id,
            "actor_id": self.actor_id,
            "authority": self.authority.value,
            "parent_state_hash": self.parent_state_hash,
            "policy_version": self.policy_version,
            "mutation_id": self.mutation_id,
            "external_ratification": self.external_ratification,
            "reversible": self.reversible,
            "evidence": dict(self.evidence),
        }

    def digest(self) -> str:
        payload = json.dumps(self.canonical_dict(), sort_keys=True, separators=(",", ":"))
        return sha256(payload.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class AxiomKernel:
    """The non-self-modifiable constitutional boundary of AXIOM OS."""

    version: str = "1.0"
    invariants: tuple[str, ...] = (
        "identity",
        "provenance",
        "authority",
        "integrity",
        "epistemic_honesty",
        "independent_evaluation",
        "reversibility",
        "observability",
        "boundedness",
        "external_ratification",
    )

    def validate(self, context: ConstitutionalContext, *, requested_change: str | None = None) -> None:
        if not context.trace_id or not context.task_id or not context.actor_id:
            raise InvariantViolation("identity/provenance requires trace_id, task_id, and actor_id")
        if not context.parent_state_hash:
            raise InvariantViolation("state mutation requires parent_state_hash")
        if not context.policy_version:
            raise InvariantViolation("policy_version is required")
        if not context.mutation_id:
            raise InvariantViolation("mutation_id is required")
        if not context.reversible:
            raise InvariantViolation("consequential mutations must be reversible")

        if requested_change == "constitution" and not context.external_ratification:
            raise InvariantViolation(
                "constitutional changes require external ratification; AXIOM cannot ratify its own constitution"
            )

        if context.authority == Authority.CONSTITUTIONAL and not context.external_ratification:
            raise InvariantViolation("constitutional authority requires external ratification")

    def assert_evaluation_independence(self, evaluator_id: str, proposer_id: str) -> None:
        if evaluator_id == proposer_id:
            raise InvariantViolation("proposer and evaluator must be independent")

    def assert_budget(self, *, depth: int, max_depth: int, tokens: int, max_tokens: int) -> None:
        if depth < 0 or depth > max_depth:
            raise InvariantViolation(f"recursion depth {depth} exceeds constitutional bound {max_depth}")
        if tokens < 0 or tokens > max_tokens:
            raise InvariantViolation(f"token budget {tokens} exceeds constitutional bound {max_tokens}")


__all__ = ["Authority", "AxiomKernel", "ConstitutionalContext", "InvariantViolation"]
