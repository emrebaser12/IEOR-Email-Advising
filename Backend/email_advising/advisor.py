"""Core advising logic for generating automated email responses."""
from __future__ import annotations

import re
from typing import Dict, List, Optional, Protocol

from .knowledge_base import KnowledgeBase
from .composers import EmailComposer, TemplateEmailComposer
from .models import (
    AdvisorReference,
    AdvisorResponse,
    ConfidenceSettings,
    KnowledgeArticle,
    RankedMatch,
)
from .similarity import TfIdfVectorizer
from .metadata import MetadataExtractor
from .text_processing import augment_tokens, tokenize


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
        self._known_metadata_keys: set[str] = set(self.metadata_defaults.keys())
        documents = []
        self._article_token_sets: List[set[str]] = []
        self._category_token_sets: List[set[str]] = []
        self._utterance_token_sets: List[List[List[str]]] = []
        self._domain_vocabulary: set[str] = set()
        for article in self.knowledge_base:
            tokens = tokenize(
                " ".join(
                    list(article.utterances)
                    + list(article.categories)
                    + [article.subject]
                )
            )
            augmented_tokens = augment_tokens(tokens)
            documents.append(augmented_tokens)
            self._article_token_sets.append(set(augmented_tokens))
            self._domain_vocabulary.update(augmented_tokens)
            self._utterance_token_sets.append([tokenize(utterance) for utterance in article.utterances])
            category_tokens = augment_tokens(tokenize(" ".join(article.categories)))
            self._category_token_sets.append(set(category_tokens))
            self._known_metadata_keys.update(article.metadata.keys())
        self.vectorizer = TfIdfVectorizer(documents)

    def rank_articles(self, query: str) -> List[RankedMatch]:
        """Rank knowledge base articles by relevance and confidence.
        
        Uses Jaccard similarity on raw tokens to measure how well the query 
        matches known utterances, then applies explicit confidence thresholds.
        """
        raw_query_tokens = tokenize(query)
        query_tokens = augment_tokens(raw_query_tokens)
        sentence_tokens = [
            tokenize(segment)
            for segment in re.split(r"[.!?]+", query)
            if segment.strip()
        ]
        if not sentence_tokens:
            sentence_tokens = [raw_query_tokens]
        query_token_sets: List[set[str]] = []
        augmented_query_sets: List[set[str]] = []
        for tokens in sentence_tokens:
            if not tokens:
                continue
            qset = set(tokens)
            if not qset:
                continue
            query_token_sets.append(qset)
            augmented_query_sets.append(set(augment_tokens(tokens)))
        if not query_token_sets:
            base_set = set(raw_query_tokens)
            query_token_sets = [base_set]
            augmented_query_sets = [set(augment_tokens(raw_query_tokens))]
        
        # TF-IDF gives us semantic similarity using augmented tokens.
        # Consider the full email and each sentence, taking the max similarity per article.
        scores = self.vectorizer.similarities(query_tokens)
        sentence_augmented = [augment_tokens(tokens) for tokens in sentence_tokens if tokens]
        for tokens in sentence_augmented:
            sent_scores = self.vectorizer.similarities(tokens)
            scores = [max(base, sent) for base, sent in zip(scores, sent_scores)]

        ranked: List[RankedMatch] = []
        
        for idx, (article, tfidf_score) in enumerate(zip(self.knowledge_base.articles, scores)):
            utterance_token_lists = self._utterance_token_sets[idx]
            utterance_augmented_sets = [
                set(augment_tokens(ut)) if ut else set() for ut in utterance_token_lists
            ]
            
            # Check for exact token match (user query exactly matches an utterance)
            exact_match = any(
                ut == sentence
                for ut in utterance_token_lists
                for sentence in sentence_tokens
                if ut and sentence
            )
            
            # Calculate best Jaccard similarity with any utterance using RAW tokens only
            # This measures phrase/pattern matching without semantic augmentation
            best_utterance_similarity = 0.0
            best_query_coverage = 0.0
            best_utterance_coverage = 0.0
            for qset, aug_qset in zip(query_token_sets, augmented_query_sets):
                for utterance_tokens, utter_aug in zip(utterance_token_lists, utterance_augmented_sets):
                    if not utterance_tokens:
                        continue
                    utterance_set = set(utterance_tokens)
                    union_raw = len(qset | utterance_set)
                    if union_raw:
                        intersection_raw = len(qset & utterance_set)
                        jaccard_raw = intersection_raw / union_raw
                        best_utterance_similarity = max(best_utterance_similarity, jaccard_raw)
                        if len(qset) > 0:
                            query_cov = intersection_raw / len(qset)
                            best_query_coverage = max(best_query_coverage, query_cov)
                        if len(utterance_set) > 0:
                            utt_cov = intersection_raw / len(utterance_set)
                            best_utterance_coverage = max(best_utterance_coverage, utt_cov)
                    if aug_qset and utter_aug:
                        union_aug = len(aug_qset | utter_aug)
                        if union_aug:
                            intersection_aug = len(aug_qset & utter_aug)
                            jaccard_aug = intersection_aug / union_aug
                            best_utterance_similarity = max(best_utterance_similarity, jaccard_aug)
                            if len(qset) > 0:
                                query_cov = min(intersection_aug, len(qset)) / len(qset)
                                best_query_coverage = max(best_query_coverage, query_cov)
                            if len(utterance_set) > 0:
                                utt_cov = min(intersection_aug, len(utterance_set)) / len(utterance_set)
                                best_utterance_coverage = max(best_utterance_coverage, utt_cov)
            
            # Compute additional overlaps for nuanced scoring
            article_tokens = self._article_token_sets[idx]
            category_tokens = self._category_token_sets[idx]
            article_overlap = 0.0
            category_overlap = 0.0
            for aug_qset in augmented_query_sets:
                if not aug_qset:
                    continue
                article_union = len(aug_qset | article_tokens)
                if article_union:
                    article_overlap = max(article_overlap, len(aug_qset & article_tokens) / article_union)
                category_union = len(aug_qset | category_tokens)
                if category_union:
                    category_overlap = max(
                        category_overlap, len(aug_qset & category_tokens) / category_union
                    )

            # Blend semantic (TF-IDF) and lexical overlaps. Prioritize the strongest signals
            if exact_match:
                confidence = 1.0
            else:
                coverage_signal = (best_query_coverage + best_utterance_coverage) / 2
                base_confidence = (
                    0.5 * best_utterance_similarity
                    + 0.2 * coverage_signal
                    + 0.2 * tfidf_score
                    + 0.1 * category_overlap
                )
                if coverage_signal < 0.15 and best_utterance_similarity < 0.2:
                    base_confidence *= 0.6
                confidence = min(max(base_confidence, 0.05), 0.97)
                if best_utterance_similarity >= 0.85:
                    confidence = max(confidence, 0.92)
                elif best_utterance_similarity >= 0.7:
                    confidence = max(confidence, 0.85)
                elif best_utterance_similarity >= 0.55 and coverage_signal >= 0.35:
                    confidence = max(confidence, 0.78)
                if coverage_signal >= 0.55 and category_overlap >= 0.1 and best_utterance_similarity >= 0.5:
                    confidence = max(confidence, 0.85)
            
            ranked.append(
                RankedMatch(article_id=article.id, subject=article.subject, confidence=confidence)
            )
        
        ranked.sort(key=lambda item: item.confidence, reverse=True)
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
        if (
            len(matches) > 1
            and matches[1].confidence >= self.confidence_settings.review_threshold
        ):
            gap = best_match.confidence - matches[1].confidence
            if gap < self.confidence_settings.ambiguity_gap:
                reasons.append(
                    "Multiple templates scored similarly high; routing to advisors for review."
                )
                reasons.extend(metadata_notes)
                return self._fallback_response(query, metadata, reasons, matches)
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
