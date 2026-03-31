"""Core advising logic for generating automated email responses."""
from __future__ import annotations

import re
from typing import Dict, List, Optional, Protocol

import numpy as np

from .knowledge_base import KnowledgeBase
from .composers import EmailComposer, TemplateEmailComposer
from .embeddings import SentenceEmbedder
from .models import (
    AdvisorReference,
    AdvisorResponse,
    ConfidenceSettings,
    KnowledgeArticle,
    RankedMatch,
)
from .metadata import MetadataExtractor


class _TemplateContext(dict):
    """Mapping used to safely format response templates."""

    def __init__(self, defaults: Dict[str, str], overrides: Optional[Dict[str, str]] = None):
        super().__init__(defaults)
        self._defaults = dict(defaults)
        self._override_keys = set(overrides or {})
        if overrides:
            super().update(overrides)
        self.used_default_keys: set[str] = set()
        self.missing_keys: set[str] = set()

    def __getitem__(self, key: str) -> str:  # type: ignore[override]
        try:
            value = super().__getitem__(key)
        except KeyError:
            self.missing_keys.add(key)
            return f"{{{key}}}"
        else:
            if key in self._defaults and key not in self._override_keys:
                self.used_default_keys.add(key)
            return value


class ReferenceRetriever(Protocol):
    """Protocol for retrieving supporting documents for a response."""

    def retrieve(
        self,
        query: str,
        article: Optional[KnowledgeArticle] = None,
        limit: int = 3,
    ) -> List[AdvisorReference]:  # pragma: no cover - protocol definition
        ...


class EmailAdvisor:
    """Email advising engine that selects templates and produces responses."""

    def __init__(
        self,
        knowledge_base: KnowledgeBase,
        confidence_settings: Optional[ConfidenceSettings] = None,
        metadata_defaults: Optional[Dict[str, str]] = None,
        retriever: Optional[ReferenceRetriever] = None,
        composer: Optional[EmailComposer] = None,
        reference_limit: int = 3,
        metadata_extractor: Optional[MetadataExtractor] = None,
        embedding_model: Optional[SentenceEmbedder] = None,
    ) -> None:
        self.knowledge_base = knowledge_base
        self.confidence_settings = confidence_settings or ConfidenceSettings()
        self.metadata_defaults = {
            "student_name": "there",
            "term": "the upcoming term",
            "registration_deadline": "the published registration deadline",
            "withdrawal_deadline": "the posted withdrawal deadline",
            "financial_aid_phone": "(555) 123-4567",
            "financial_aid_email": "finaid@university.edu",
        }
        if metadata_defaults:
            self.metadata_defaults.update(metadata_defaults)
        self.retriever = retriever
        self.reference_limit = max(reference_limit, 0)
        self.email_composer = composer or TemplateEmailComposer()
        self.metadata_extractor = metadata_extractor or MetadataExtractor()
        self.embedding_model = embedding_model
        self._known_metadata_keys: set[str] = set(self.metadata_defaults.keys())
        for article in self.knowledge_base:
            self._known_metadata_keys.update(article.metadata.keys())

        # Pre-compute utterance embeddings once at startup
        self._utterance_embeddings: Optional[np.ndarray] = None
        self._utterance_article_indices: List[int] = []
        if self.embedding_model is not None:
            all_utterances: List[str] = []
            for idx, article in enumerate(self.knowledge_base):
                for utterance in article.utterances:
                    all_utterances.append(utterance)
                    self._utterance_article_indices.append(idx)
            if all_utterances:
                self._utterance_embeddings = self.embedding_model.encode(all_utterances)

    def rank_articles(self, query: str) -> List[RankedMatch]:
        """Rank knowledge base articles by relevance.

        Confidence is the best cosine similarity between any query segment and
        any utterance in the article, as scored by the sentence embedding model.
        Segments are split on sentence boundaries and paragraph breaks so that
        greetings and sign-offs do not dilute the actual question.
        """
        segments = [s.strip() for s in re.split(r"[.!?]+|\n\n+", query) if s.strip()]
        if not segments:
            segments = [query]

        segment_embeddings = self.embedding_model.encode(segments)

        num_articles = len(self.knowledge_base.articles)
        confidence_scores: List[float] = [0.0] * num_articles

        for seg_emb in segment_embeddings:
            utt_sims = self.embedding_model.similarities(seg_emb, self._utterance_embeddings)
            for utter_idx, art_idx in enumerate(self._utterance_article_indices):
                sim = float(utt_sims[utter_idx])
                if sim > confidence_scores[art_idx]:
                    confidence_scores[art_idx] = sim

        ranked = [
            RankedMatch(article_id=article.id, subject=article.subject, confidence=confidence_scores[idx])
            for idx, article in enumerate(self.knowledge_base.articles)
        ]
        ranked.sort(key=lambda m: m.confidence, reverse=True)
        return ranked

    def process_query(self, query: str, metadata: Optional[Dict[str, str]] = None) -> AdvisorResponse:
        metadata = dict(metadata or {})
        metadata_notes: List[str] = []
        if self.metadata_extractor:
            for fact in self.metadata_extractor.extract(query):
                if fact.key not in self._known_metadata_keys:
                    continue
                if metadata.get(fact.key):
                    continue
                metadata[fact.key] = fact.value
                metadata_notes.append(fact.reason)
        matches = self.rank_articles(query)
        reasons: List[str] = []
        if not matches:
            reasons.extend(metadata_notes)
            return self._fallback_response(query, metadata, reasons)
        best_match = matches[0]
        reasons.append(
            f"Top match '{best_match.subject}' scored {best_match.confidence:.2f}."
        )
        force_review = False
        if (
            len(matches) > 1
            and matches[1].confidence >= self.confidence_settings.review_threshold
        ):
            gap = best_match.confidence - matches[1].confidence
            if gap < self.confidence_settings.ambiguity_gap:
                force_review = True
                reasons.append(
                    "Multiple templates scored similarly high; flagged for advisor review."
                )
        if best_match.confidence < self.confidence_settings.review_threshold:
            reasons.append(
                "No article exceeded the review confidence threshold; escalating to advising team."
            )
            reasons.extend(metadata_notes)
            return self._fallback_response(query, metadata, reasons, matches)
        article = self.knowledge_base.get(best_match.article_id)
        if article is None:
            reasons.append("Matched article could not be found in the knowledge base.")
            reasons.extend(metadata_notes)
            return self._fallback_response(query, metadata, reasons, matches)
        response, context = self._render_article(article, metadata)
        references = self._get_references(query, article, reasons)
        subject, body = self.email_composer.compose(
            article=article,
            base_subject=response["subject"],
            base_body=response["body"],
            query=query,
            metadata=dict(context),
            references=references,
        )
        auto_send = (
            best_match.confidence >= self.confidence_settings.auto_send_threshold
            and not context.missing_keys
            and not force_review
        )
        decision = "auto_send" if auto_send else "needs_review"
        if not auto_send:
            if best_match.confidence < self.confidence_settings.auto_send_threshold:
                reasons.append(
                    "Confidence below the auto-send threshold; sending draft for review."
                )
            if context.missing_keys:
                missing = ", ".join(sorted(context.missing_keys))
                reasons.append(
                    f"Template placeholders missing values: {missing}. Advisor review required."
                )
        if context.used_default_keys:
            defaults_used = ", ".join(sorted(context.used_default_keys))
            reasons.append(
                f"Default values used for: {defaults_used}. Update metadata if more specific details are available."
            )
        reasons.extend(metadata_notes)
        return AdvisorResponse(
            subject=subject,
            body=body,
            auto_send=auto_send,
            confidence=best_match.confidence,
            decision=decision,
            article_id=article.id,
            follow_up_questions=list(article.follow_up_questions),
            reasons=reasons,
            ranked_matches=matches,
            references=references,
        )

    def _render_article(
        self, article: KnowledgeArticle, metadata: Dict[str, str]
    ) -> tuple[Dict[str, str], _TemplateContext]:
        context = _TemplateContext(self.metadata_defaults | article.metadata, metadata)
        subject = article.subject.format_map(context)
        body = article.response_template.format_map(context)
        return {"subject": subject, "body": body}, context

    def _fallback_response(
        self,
        query: str,
        metadata: Dict[str, str],
        reasons: List[str],
        matches: Optional[List[RankedMatch]] = None,
    ) -> AdvisorResponse:
        context = _TemplateContext(self.metadata_defaults, metadata)
        subject = "Advising team follow-up required"
        body = (
            "Hello {student_name},\n\n"
            "Thanks for contacting the advising office. Your question has been routed to an advisor "
            "for a personal response. We will review the details and get back to you within one business day."
            "\n\nBest,\nAcademic Advising Team"
        ).format_map(context)
        if not reasons:
            reasons.append("Unable to determine an appropriate template.")
        references = self._get_references(query, None, reasons)
        return AdvisorResponse(
            subject=subject,
            body=body,
            auto_send=False,
            confidence=matches[0].confidence if matches else 0.0,
            decision="needs_review",
            article_id=None,
            follow_up_questions=[],
            reasons=reasons,
            ranked_matches=matches or [],
            references=references,
        )

    def _get_references(
        self,
        query: str,
        article: Optional[KnowledgeArticle],
        reasons: List[str],
    ) -> List[AdvisorReference]:
        if not self.retriever or self.reference_limit <= 0:
            return []
        try:
            return self.retriever.retrieve(
                query=query,
                article=article,
                limit=self.reference_limit,
            )
        except Exception as exc:  # pragma: no cover - defensive programming
            reasons.append(f"Reference retrieval failed: {exc}")
            return []


__all__ = ["EmailAdvisor"]
