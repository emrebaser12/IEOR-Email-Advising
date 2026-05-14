"""Metadata extraction helpers for enriching advisor responses."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, List


_TERM_RE = re.compile(r"\b(Spring|Summer|Fall|Winter)\s*(20\d{2})\b", re.IGNORECASE)
_MONTHS = {
    "jan": "January",
    "january": "January",
    "feb": "February",
    "february": "February",
    "mar": "March",
    "march": "March",
    "apr": "April",
    "april": "April",
    "may": "May",
    "jun": "June",
    "june": "June",
    "jul": "July",
    "july": "July",
    "aug": "August",
    "august": "August",
    "sep": "September",
    "sept": "September",
    "september": "September",
    "oct": "October",
    "october": "October",
    "nov": "November",
    "november": "November",
    "dec": "December",
    "december": "December",
}
_MONTH_DAY_RE = re.compile(
    r"\b(" + "|".join(_MONTHS.keys()) + r")\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b",
    re.IGNORECASE,
)
_NUMERIC_DATE_RE = re.compile(
    r"\b(0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])(?:[/-](20\d{2}))?\b"
)
_NAME_RE = re.compile(
    r"\b(?:my\s+name\s+is|this\s+is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b",
    re.IGNORECASE,
)
_WITHDRAW_KEYWORDS = {"withdraw", "withdrawal", "drop", "dropped", "remove", "removed"}
_REGISTRATION_KEYWORDS = {"register", "registration", "enroll", "enrollment", "add"}


@dataclass(frozen=True)
class MetadataFact:
    """Represents a metadata value inferred from the student's message."""

    key: str
    value: str
    reason: str


class MetadataExtractor:
    """Extract structured metadata from free-form student emails."""

    def __init__(self, *, context_window: int = 48) -> None:
        self.context_window = context_window

    def extract(self, text: str) -> List[MetadataFact]:
        facts: List[MetadataFact] = []
        lower_text = text.lower()
        facts.extend(self._extract_term(text))
        facts.extend(self._extract_dates(text, lower_text))
        facts.extend(self._extract_name(text))
        return facts

    def _extract_term(self, text: str) -> Iterable[MetadataFact]:
        for match in _TERM_RE.finditer(text):
            term = f"{match.group(1).title()} {match.group(2)}"
            reason = f"Detected academic term '{term}' from student email."
            yield MetadataFact("term", term, reason)

    def _extract_name(self, text: str) -> Iterable[MetadataFact]:
        for match in _NAME_RE.finditer(text):
            raw_name = match.group(1)
            cleaned = " ".join(part.capitalize() for part in raw_name.split())
            if len(cleaned) < 2:
                continue
            reason = f"Captured student name '{cleaned}' from greeting."
            yield MetadataFact("student_name", cleaned, reason)

    def _extract_dates(self, text: str, lower_text: str) -> Iterable[MetadataFact]:
        for match in _MONTH_DAY_RE.finditer(text):
            month_key = match.group(1).lower().rstrip(".")
            day = match.group(2)
            month = _MONTHS.get(month_key[:3])
            if not month:
                continue
            value = f"{month} {int(day)}"
            yield from self._yield_deadline_fact(lower_text, match.start(), match.end(), value)
        for match in _NUMERIC_DATE_RE.finditer(text):
            month = int(match.group(1))
            day = int(match.group(2))
            year = match.group(3)
            if 1 <= month <= 12 and 1 <= day <= 31:
                month_name = list(_MONTHS.values())[month - 1]
                value = f"{month_name} {day}" if not year else f"{month_name} {day}, {year}"
                yield from self._yield_deadline_fact(lower_text, match.start(), match.end(), value)

    def _yield_deadline_fact(
        self,
        lower_text: str,
        start: int,
        end: int,
        value: str,
    ) -> Iterable[MetadataFact]:
        window = self._extract_window(lower_text, start, end)
        tokens = set(re.findall(r"[a-z]+", window))
        if _WITHDRAW_KEYWORDS & tokens:
            reason = f"Identified withdrawal deadline '{value}' in message context."
            yield MetadataFact("withdrawal_deadline", value, reason)
        if _REGISTRATION_KEYWORDS & tokens:
            reason = f"Identified registration deadline '{value}' in message context."
            yield MetadataFact("registration_deadline", value, reason)
        if "deadline" in window and not (_WITHDRAW_KEYWORDS & tokens or _REGISTRATION_KEYWORDS & tokens):
            reason = f"Detected deadline reference '{value}'."
            yield MetadataFact("deadline", value, reason)

    def _extract_window(self, lower_text: str, start: int, end: int) -> str:
        begin = max(0, start - self.context_window)
        finish = min(len(lower_text), end + self.context_window)
        return lower_text[begin:finish]


__all__ = ["MetadataExtractor", "MetadataFact"]
