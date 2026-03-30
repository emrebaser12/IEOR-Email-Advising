"""Utilities for preprocessing student email text."""
from __future__ import annotations

import re
import unicodedata
from typing import Iterable, List, Sequence


_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "for",
    "from",
    "how",
    "i",
    "in",
    "is",
    "it",
    "my",
    "of",
    "on",
    "or",
    "so",
    "that",
    "the",
    "to",
    "we",
    "what",
    "when",
    "where",
    "which",
    "who",
    "will",
    "with",
    "you",
    "your",
}

_TOKEN_SYNONYMS = {
    "appointment": {"meeting", "advising", "schedule"},
    "appointments": {"meeting", "schedule"},
    "book": {"schedule", "appointment"},
    "cancel": {"withdraw", "drop"},
    "course": {"class"},
    "courses": {"classes"},
    "close": {"closes", "deadline", "end"},
    "closes": {"close", "deadline", "ends"},
    "closing": {"close", "deadline", "end"},
    "drop": {"withdraw", "withdrawal", "remove"},
    "dropping": {"withdraw", "withdrawal"},
    "enroll": {"register", "registration"},
    "enrolling": {"register", "registration"},
    "enrollment": {"register", "registration"},
    "deadline": {"close", "closing"},
    "financial": {"aid"},
    "meeting": {"appointment"},
    "register": {"enroll", "registration"},
    "registration": {"register", "enroll"},
    "remove": {"withdraw", "drop"},
    "schedule": {"appointment", "meeting"},
    "transcript": {"record", "records"},
    "withdraw": {"drop", "withdrawal"},
    "withdrawal": {"withdraw", "drop"},
}

_WORD_RE = re.compile(r"[^a-z0-9]+")


def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def normalize_text(text: str) -> str:
    """Return a normalized representation of *text*."""

    lowered = _strip_accents(text.lower())
    collapsed = _WORD_RE.sub(" ", lowered)
    return re.sub(r"\s+", " ", collapsed).strip()


def tokenize(text: str) -> List[str]:
    """Tokenize *text* into normalized word tokens."""

    normalized = normalize_text(text)
    if not normalized:
        return []
    return [token for token in normalized.split(" ") if token and token not in _STOPWORDS]


def augment_tokens(tokens: Sequence[str]) -> List[str]:
    """Augment *tokens* with domain-specific synonyms and bi-grams."""

    unique_tokens: List[str] = []
    seen: set[str] = set()
    for token in tokens:
        if token not in seen:
            seen.add(token)
            unique_tokens.append(token)
    for token in tokens:
        synonyms = _TOKEN_SYNONYMS.get(token, ())
        for synonym in synonyms:
            if synonym not in seen:
                seen.add(synonym)
                unique_tokens.append(synonym)
    for left, right in _iterate_bigrams(tokens):
        bigram = f"{left}_{right}"
        if bigram not in seen:
            seen.add(bigram)
            unique_tokens.append(bigram)
    return unique_tokens


def _iterate_bigrams(tokens: Sequence[str]) -> Iterable[tuple[str, str]]:
    for index in range(len(tokens) - 1):
        yield tokens[index], tokens[index + 1]


__all__ = ["augment_tokens", "normalize_text", "tokenize"]
