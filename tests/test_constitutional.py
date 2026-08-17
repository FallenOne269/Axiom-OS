import pytest

from axiom.constitutional import Authority, AxiomKernel, ConstitutionalContext, InvariantViolation


def context(**overrides):
    values = {
        "trace_id": "tr_test",
        "task_id": "task_test",
        "actor_id": "agent_a",
        "authority": Authority.PROPOSE,
        "parent_state_hash": "abc123",
        "policy_version": "1.0",
        "mutation_id": "mut_test",
        "external_ratification": False,
        "reversible": True,
    }
    values.update(overrides)
    return ConstitutionalContext(**values)


def test_valid_mutation_passes():
    AxiomKernel().validate(context())


def test_missing_lineage_is_rejected():
    with pytest.raises(InvariantViolation):
        AxiomKernel().validate(context(parent_state_hash=""))


def test_non_reversible_mutation_is_rejected():
    with pytest.raises(InvariantViolation):
        AxiomKernel().validate(context(reversible=False))


def test_self_ratified_constitution_is_rejected():
    with pytest.raises(InvariantViolation):
        AxiomKernel().validate(context(), requested_change="constitution")


def test_external_constitutional_ratification_is_allowed():
    AxiomKernel().validate(
        context(authority=Authority.CONSTITUTIONAL, external_ratification=True),
        requested_change="constitution",
    )


def test_proposer_cannot_be_sole_evaluator():
    with pytest.raises(InvariantViolation):
        AxiomKernel().assert_evaluation_independence("agent_a", "agent_a")


def test_budget_is_bounded():
    kernel = AxiomKernel()
    kernel.assert_budget(depth=3, max_depth=3, tokens=100, max_tokens=100)
    with pytest.raises(InvariantViolation):
        kernel.assert_budget(depth=4, max_depth=3, tokens=100, max_tokens=100)


def test_context_digest_is_deterministic():
    assert context().digest() == context().digest()
