"""Personal / sensitive email guardrails.

Detects student emails that contain personal or sensitive topics
(mental health, financial hardship, family emergencies, etc.)
and flags them so they are NEVER auto-sent.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Sequence


@dataclass(frozen=True)
class GuardrailResult:
    """Result of running the personal-email guardrail check."""

    is_personal: bool
    matched_keywords: List[str] = field(default_factory=list)
    matched_phrases: List[str] = field(default_factory=list)

    @property
    def reasons(self) -> List[str]:
        parts: List[str] = []
        if self.matched_keywords:
            parts.append(
                f"Sensitive keywords detected: {', '.join(self.matched_keywords)}"
            )
        if self.matched_phrases:
            parts.append(
                f"Sensitive phrases detected: {', '.join(self.matched_phrases)}"
            )
        return parts


# ── Default keyword & phrase lists ──────────────────────────────────────

DEFAULT_KEYWORDS: List[str] = [
    # Mental health
    "anxiety",
    "depression",
    "depressed",
    "stressed",
    "overwhelmed",
    "therapy",
    "counseling",
    "counselor",
    "suicidal",
    "suicide",
    "mental health",
    "panic attack",
    "eating disorder",
    # Medical / health
    "hospitalized",
    "hospitalization",
    "medical leave",
    "illness",
    "disability",
    "accommodation",
    # Financial
    "financial aid",
    "hardship",
    "can't afford",
    "tuition help",
    "financial hardship",
    # Family / personal emergencies
    "family emergency",
    "bereavement",
    "death in family",
    "grief",
    "domestic violence",
    "restraining order",
    "homelessness",
    "homeless",
    "abuse",
    # Discrimination / safety
    "harassment",
    "discrimination",
    "title ix",
    "assault",
    "crisis",
    # Academic distress (personal framing)
    "dropping out",
    "failing",
    "academic probation",
    "suspension",
]

DEFAULT_PHRASES: List[str] = [
    "i don't know what to do",
    "i need help urgently",
    "i'm struggling",
    "i am struggling",
    "i can't cope",
    "i cant cope",
    "please help me",
    "i feel hopeless",
    "i'm in crisis",
    "i am in crisis",
    "i have nowhere to turn",
    "i feel like giving up",
    "i can't take it anymore",
    "i cant take it anymore",
    "i need someone to talk to",
    "i'm not okay",
    "i am not okay",
    "i don't feel safe",
    "i dont feel safe",
]


class PersonalEmailDetector:
    """Scans email text for personal / sensitive content.

    Parameters
    ----------
    keywords : list of str, optional
        Single words or short terms to match.  Defaults to DEFAULT_KEYWORDS.
    phrases : list of str, optional
        Longer multi-word phrases to match.  Defaults to DEFAULT_PHRASES.
    """

    def __init__(
        self,
        keywords: Sequence[str] | None = None,
        phrases: Sequence[str] | None = None,
    ) -> None:
        self.keywords = list(keywords or DEFAULT_KEYWORDS)
        self.phrases = list(phrases or DEFAULT_PHRASES)

        # Pre-compile regex patterns for efficient matching
        # Keywords use word-boundary matching so "class" won't match "classification"
        self._keyword_patterns = [
            (kw, re.compile(r"\b" + re.escape(kw.lower()) + r"\b"))
            for kw in self.keywords
        ]
        # Phrases are matched as-is (already multi-word)
        self._phrase_patterns = [
            (ph, re.compile(re.escape(ph.lower())))
            for ph in self.phrases
        ]

    def check(self, text: str) -> GuardrailResult:
        """Check *text* for personal / sensitive content.

        Returns a ``GuardrailResult`` with ``is_personal=True`` when at
        least one keyword **or** phrase is detected.
        """
        lower_text = text.lower()
        matched_keywords: List[str] = []
        matched_phrases: List[str] = []

        for kw, pattern in self._keyword_patterns:
            if pattern.search(lower_text):
                matched_keywords.append(kw)

        for ph, pattern in self._phrase_patterns:
            if pattern.search(lower_text):
                matched_phrases.append(ph)

        is_personal = bool(matched_keywords or matched_phrases)
        return GuardrailResult(
            is_personal=is_personal,
            matched_keywords=matched_keywords,
            matched_phrases=matched_phrases,
        )


__all__ = [
    "DEFAULT_KEYWORDS",
    "DEFAULT_PHRASES",
    "GuardrailResult",
    "PersonalEmailDetector",
]