"""Helpers for working with the advising knowledge base."""
from __future__ import annotations

import json
from pathlib import Path
from typing import List

from .models import KnowledgeArticle, KnowledgeBase


_DEFAULT_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "knowledge_base.json"


def load_knowledge_base(path: Path | str | None = None) -> KnowledgeBase:
    """Load knowledge base articles from disk."""

    data_path = Path(path) if path else _DEFAULT_DATA_PATH
    if not data_path.exists():
        raise FileNotFoundError(f"Knowledge base file not found: {data_path}")
    with data_path.open("r", encoding="utf-8") as source:
        payload = json.load(source)
    articles: List[KnowledgeArticle] = []
    for entry in payload:
        articles.append(
            KnowledgeArticle(
                id=entry["id"],
                subject=entry["subject"],
                categories=entry.get("categories", []),
                utterances=entry.get("utterances", []),
                response_template=entry["response_template"],
                follow_up_questions=entry.get("follow_up_questions", []),
                metadata=entry.get("metadata", {}),
            )
        )
    return KnowledgeBase(articles)


__all__ = ["load_knowledge_base", "KnowledgeBase", "KnowledgeArticle"]
