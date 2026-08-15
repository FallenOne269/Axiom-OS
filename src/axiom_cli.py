"""Compatibility command entry point for `python -m axiom_cli`."""

from axiom.cli import main

if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
