"""Configuration persistence and safe local capability detection."""

from __future__ import annotations

from json import dumps, loads
from os import environ
from pathlib import Path
from shutil import which
from subprocess import DEVNULL, run

from .models import AxiomConfig, DeploymentMode, LocalCapabilities

DEFAULT_HOME = Path(environ.get("AXIOM_HOME", Path.home() / ".axiom"))


def config_path(home: str | Path = DEFAULT_HOME) -> Path:
    """Return the persisted configuration path for an AXIOM local profile."""
    return Path(home) / "AxiomConfig.json"


def detect_capabilities() -> LocalCapabilities:
    """Collect only local, read-only capability signals; never invoke model runtimes."""
    models = set()
    cache_root = Path(environ.get("AXIOM_MODEL_CACHE", Path.home() / ".cache" / "axiom" / "models"))
    if cache_root.exists():
        models = {entry.name for entry in cache_root.iterdir() if entry.is_dir() or entry.is_file()}
    gpu_available = False
    free_vram_mb = 0
    if which("nvidia-smi"):
        probe = run(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
            stdout=-1,
            stderr=DEVNULL,
            text=True,
            check=False,
            timeout=2,
        )
        values = [line.strip() for line in probe.stdout.splitlines() if line.strip().isdigit()]
        if values:
            gpu_available = True
            free_vram_mb = max(map(int, values))
    return LocalCapabilities(
        available_models=models,
        gpu_available=gpu_available,
        free_vram_mb=free_vram_mb,
        local_context_window=int(environ.get("AXIOM_LOCAL_CONTEXT_WINDOW", "32000")),
        max_serialized_state_bytes=int(environ.get("AXIOM_MAX_STATE_BYTES", "4000000")),
        predicted_frame_ms=float(environ.get("AXIOM_PREDICTED_FRAME_MS", "5")),
        local_healthy=True,
    )


def save_config(config: AxiomConfig, home: str | Path = DEFAULT_HOME) -> Path:
    """Persist profile configuration atomically as canonical JSON."""
    path = config_path(home)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(dumps(config.model_dump(mode="json"), indent=2, sort_keys=True) + "\n")
    temporary.replace(path)
    return path


def load_config(home: str | Path = DEFAULT_HOME) -> AxiomConfig:
    """Load a profile or create a safe simulation-compatible hybrid default."""
    path = config_path(home)
    if not path.exists():
        return AxiomConfig(mode=DeploymentMode.HYBRID, local_capabilities=detect_capabilities())
    return AxiomConfig.model_validate(loads(path.read_text(encoding="utf-8")))
