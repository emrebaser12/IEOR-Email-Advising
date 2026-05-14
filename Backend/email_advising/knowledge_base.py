"""Helpers for working with the advising knowledge base."""
from __future__ import annotations

import json
from pathlib import Path
from typing import List

from .models import KnowledgeArticle, KnowledgeBase


_DEFAULT_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "knowledge_base.json"
_SEMESTER_CONFIG_PATH = Path(__file__).resolve().parent.parent / "data" / "semester_config.json"


def _load_semester_substitutions() -> dict:
    """Load semester_config.json and flatten into a single substitution dict."""
    if not _SEMESTER_CONFIG_PATH.exists():
        return {}
    with _SEMESTER_CONFIG_PATH.open("r", encoding="utf-8") as f:
        config = json.load(f)
    subs = {}
    for section, values in config.items():
        if section.startswith("_"):
            continue
        if isinstance(values, dict):
            subs.update(values)
    return subs


def load_knowledge_base(path: Path | str | None = None) -> KnowledgeBase:
    """Load knowledge base articles from disk, substituting semester_config.json values."""

    data_path = Path(path) if path else _DEFAULT_DATA_PATH
    if not data_path.exists():
        raise FileNotFoundError(f"Knowledge base file not found: {data_path}")
    with data_path.open("r", encoding="utf-8") as source:
        payload = json.load(source)

    subs = _load_semester_substitutions()

    articles: List[KnowledgeArticle] = []
    for entry in payload:
        template = entry["response_template"]
        for key, value in subs.items():
            template = template.replace(f"{{{key}}}", value)
        articles.append(
            KnowledgeArticle(
                id=entry["id"],
                subject=entry["subject"],
                categories=entry.get("categories", []),
                utterances=entry.get("utterances", []),
                response_template=template,
                follow_up_questions=entry.get("follow_up_questions", []),
                metadata=entry.get("metadata", {}),
            )
        )
    return KnowledgeBase(articles)


__all__ = ["load_knowledge_base", "KnowledgeBase", "KnowledgeArticle"]
