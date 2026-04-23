"""Lightweight TF-IDF utilities for semantic matching."""
from __future__ import annotations

import math
from collections import Counter
from typing import Dict, List, Sequence

Vector = Dict[int, float]


def _normalize(vector: Vector) -> Vector:
    norm = math.sqrt(sum(weight * weight for weight in vector.values()))
    if norm == 0.0:
        return {}
    return {index: weight / norm for index, weight in vector.items()}


def cosine_similarity(lhs: Vector, rhs: Vector) -> float:
    """Return cosine similarity between two sparse vectors."""

    if not lhs or not rhs:
        return 0.0
    if len(lhs) > len(rhs):
        lhs, rhs = rhs, lhs
    score = 0.0
    for index, weight in lhs.items():
        score += weight * rhs.get(index, 0.0)
    return score


class TfIdfVectorizer:
    """Very small TF-IDF implementation tailored for this project."""

    def __init__(self, documents: Sequence[Sequence[str]]):
        if not documents:
            raise ValueError("TfIdfVectorizer requires at least one document")
        self.vocabulary: Dict[str, int] = {}
        self.idf: List[float] = []
        self.document_vectors: List[Vector] = []
        self._build(documents)

    def _build(self, documents: Sequence[Sequence[str]]) -> None:
        doc_freq: Counter[str] = Counter()
        raw_documents: List[Counter[str]] = []
        for tokens in documents:
            tf_counts = Counter(tokens)
            raw_documents.append(tf_counts)
            doc_freq.update(tf_counts.keys())
        self.vocabulary = {term: idx for idx, term in enumerate(sorted(doc_freq))}
        vocab_size = len(self.vocabulary)
        self.idf = [0.0] * vocab_size
        total_docs = len(documents)
        for term, idx in self.vocabulary.items():
            df = doc_freq[term]
            self.idf[idx] = math.log((1 + total_docs) / (1 + df)) + 1.0
        self.document_vectors = []
        for tf_counts in raw_documents:
            vector: Vector = {}
            for term, count in tf_counts.items():
                idx = self.vocabulary[term]
                weight = (1.0 + math.log(count)) * self.idf[idx]
                vector[idx] = weight
            self.document_vectors.append(_normalize(vector))

    def transform(self, tokens: Sequence[str]) -> Vector:
        tf_counts = Counter(tokens)
        vector: Vector = {}
        for term, count in tf_counts.items():
            idx = self.vocabulary.get(term)
            if idx is None:
                continue
            weight = (1.0 + math.log(count)) * self.idf[idx]
            vector[idx] = weight
        return _normalize(vector)

    def similarities(self, tokens: Sequence[str]) -> List[float]:
        query_vector = self.transform(tokens)
        return [cosine_similarity(query_vector, doc_vector) for doc_vector in self.document_vectors]


__all__ = ["TfIdfVectorizer", "cosine_similarity"]
