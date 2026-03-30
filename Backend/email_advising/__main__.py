"""Module entry point for `python -m email_advising`."""
from __future__ import annotations

from .cli import main

if __name__ == "__main__":  # pragma: no cover - thin wrapper
    raise SystemExit(main())
