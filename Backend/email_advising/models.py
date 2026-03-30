"""Core data models for the Email Advising System."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Iterable, Iterator, List, Optional, Sequence


@dataclass(frozen=True)
class KnowledgeArticle:
    """Represents a reusable advising response template."""

    id: str
    subject: str
    categories: Sequence[str]
    utterances: Sequence[str]
    response_template: str
    follow_up_questions: Sequence[str] = field(default_factory=tuple)
    metadata: Dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class ReferenceDocument:
    """Structured representation of a supporting knowledge document."""

    id: str
    title: str
    content: str
    url: Optional[str] = None
    tags: Sequence[str] = field(default_factory=tuple)


@dataclass(frozen=True)
class AdvisorReference:
    """Reference returned to support an automated response."""

    document_id: str
    title: str
    snippet: str
    url: Optional[str]
    score: float


@dataclass(frozen=True)
class RankedMatch:
    """A ranked match between a query and a knowledge base article."""

    article_id: str
    subject: str
    confidence: float


@dataclass(frozen=True)
class ConfidenceSettings:
    """Confidence thresholds that govern automated responses."""

    auto_send_threshold: float = 0.95
    review_threshold: float = 0.55
    ambiguity_gap: float = 0.08

    def __post_init__(self) -> None:  # type: ignore[override]
        if not (0.0 <= self.review_threshold <= 1.0):
            raise ValueError("review_threshold must be between 0 and 1")
        if not (0.0 <= self.auto_send_threshold <= 1.0):
            raise ValueError("auto_send_threshold must be between 0 and 1")
        if not (0.0 <= self.ambiguity_gap <= 1.0):
            raise ValueError("ambiguity_gap must be between 0 and 1")
        if self.auto_send_threshold < self.review_threshold:
            raise ValueError(
                "auto_send_threshold must be greater than or equal to review_threshold"
            )


@dataclass
class AdvisorResponse:
    """The result of processing a student question."""

    subject: str
    body: str
    auto_send: bool
    confidence: float
    decision: str
    article_id: Optional[str] = None
    follow_up_questions: List[str] = field(default_factory=list)
    reasons: List[str] = field(default_factory=list)
    ranked_matches: List[RankedMatch] = field(default_factory=list)
    references: List[AdvisorReference] = field(default_factory=list)


class KnowledgeBase:
    """Collection of knowledge base articles."""

    def __init__(self, articles: Iterable[KnowledgeArticle]):
        self._articles: List[KnowledgeArticle] = list(articles)
        if not self._articles:
            raise ValueError("KnowledgeBase requires at least one article")
        seen_ids: set[str] = set()
        for article in self._articles:
            if article.id in seen_ids:
                raise ValueError(f"Duplicate article id detected: {article.id}")
            seen_ids.add(article.id)
        self._by_id = {article.id: article for article in self._articles}

    def __iter__(self) -> Iterator[KnowledgeArticle]:
        return iter(self._articles)

    def __len__(self) -> int:
        return len(self._articles)

    def __getitem__(self, article_id: str) -> KnowledgeArticle:
        return self._by_id[article_id]

    def get(self, article_id: str) -> Optional[KnowledgeArticle]:
        return self._by_id.get(article_id)

    @property
    def articles(self) -> Sequence[KnowledgeArticle]:
        return tuple(self._articles)


class ReferenceCorpus:
    """Collection of documents used for retrieval augmented generation."""

    def __init__(self, documents: Iterable[ReferenceDocument]):
        self._documents: List[ReferenceDocument] = list(documents)
        if not self._documents:
            raise ValueError("ReferenceCorpus requires at least one document")
        seen_ids: set[str] = set()
        for document in self._documents:
            if document.id in seen_ids:
                raise ValueError(f"Duplicate reference id detected: {document.id}")
            seen_ids.add(document.id)
        self._by_id = {document.id: document for document in self._documents}

    def __iter__(self) -> Iterator[ReferenceDocument]:
        return iter(self._documents)

    def __len__(self) -> int:
        return len(self._documents)

    def __getitem__(self, document_id: str) -> ReferenceDocument:
        return self._by_id[document_id]

    def get(self, document_id: str) -> Optional[ReferenceDocument]:
        return self._by_id.get(document_id)

    @property
    def documents(self) -> Sequence[ReferenceDocument]:
        return tuple(self._documents)
