"""Compatibility exports for the AXIOM hybrid client API."""

from axiom.hybrid_client import (
    AxiomClient,
    HmacEnvelopeSigner,
    HttpRemoteTransport,
    InProcessRemoteTransport,
    RemoteCompletion,
    SignedTaskEnvelope,
    envelope_as_kubernetes_annotations,
)

__all__ = [
    "AxiomClient",
    "HmacEnvelopeSigner",
    "HttpRemoteTransport",
    "InProcessRemoteTransport",
    "RemoteCompletion",
    "SignedTaskEnvelope",
    "envelope_as_kubernetes_annotations",
]
